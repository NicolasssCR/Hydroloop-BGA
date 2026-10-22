// Fase 1 · Lógica del medidor de agua
//  registrarLectura(): guarda la lectura (m³) y convierte la diferencia con la anterior en
//                      litros por día (colección "lecturas", que usa el dashboard).
//  leerFotoMedidor():  OCR de los dígitos del medidor en la foto de la ESP32-CAM.
const LecturaMedidor = require('./models/LecturaMedidor');
const Lectura = require('./models/Lectura');

const DIA = 86400000;
const OFFSET_BOGOTA = -5 * 3600000;               // Colombia no tiene horario de verano
const MAX_M3_DIA = 3;                              // más de 3 m³ (3.000 L) en un día: lectura dudosa

class ErrorLectura extends Error {
  constructor(status, mensaje) { super(mensaje); this.status = status; }
}

// Reparte los litros entre los días (hora de Colombia) que hay entre dos lecturas,
// en proporción al tiempo de cada día. Devuelve [{ fecha, litros }].
function repartirPorDia(desde, hasta, litros) {
  const t0 = desde.getTime(), t1 = hasta.getTime(), total = t1 - t0;
  if (total <= 0) return [{ fecha: hasta, litros }];
  const partes = [];
  let ini = t0;
  while (ini < t1 && partes.length < 62) {
    const local = ini + OFFSET_BOGOTA;
    const finDia = Math.floor(local / DIA) * DIA + DIA - OFFSET_BOGOTA;   // medianoche siguiente (Bogotá)
    const fin = Math.min(finDia, t1);
    partes.push({ fecha: new Date((ini + fin) / 2), litros: litros * (fin - ini) / total });
    ini = fin;
  }
  return partes;
}

// Entre varias lecturas posibles (OCR), elige la que tiene sentido con la lectura anterior
async function elegirCandidato(usuarioId, candidatos, cuando = new Date()) {
  const previa = await LecturaMedidor.findOne({ usuario: usuarioId }).sort({ fecha: -1 });
  if (!previa) return candidatos[0];
  const dias = Math.max((cuando - previa.fecha) / DIA, 1);
  const plausibles = candidatos.filter(v => v >= previa.valor - 0.0005 && v - previa.valor <= MAX_M3_DIA * dias);
  return plausibles.length ? plausibles.sort((a, b) => (a - previa.valor) - (b - previa.valor))[0] : candidatos[0];
}

async function registrarLectura(usuarioId, valor, origen, cuando = new Date()) {
  valor = Number(valor);
  if (!Number.isFinite(valor) || valor < 0 || valor > 9999999)
    throw new ErrorLectura(400, 'La lectura debe ser un número en m³ (por ejemplo 1393.712).');
  valor = Math.round(valor * 1000) / 1000;

  const previa = await LecturaMedidor.findOne({ usuario: usuarioId }).sort({ fecha: -1 });
  let litros = 0;
  if (previa) {
    const diff = valor - previa.valor;
    if (diff < -0.0005)
      throw new ErrorLectura(422, `La lectura (${valor} m³) es menor que la anterior (${previa.valor} m³). El medidor solo sube: revisa la foto o el número.`);
    const dias = Math.max((cuando - previa.fecha) / DIA, 1 / 24);
    if (diff > MAX_M3_DIA * Math.max(dias, 1))
      throw new ErrorLectura(422, `Consumo dudoso: ${diff.toFixed(3)} m³ en ${(dias * 24).toFixed(1)} horas. Revisa la lectura.`);
    litros = Math.max(0, diff) * 1000;
  }
  const lectura = await LecturaMedidor.create({ usuario: usuarioId, fecha: cuando, valor, origen, litros });
  await Lectura.deleteMany({ usuario: usuarioId, origen: 'simulado' });   // llegan datos reales: fuera la simulación
  if (previa && litros > 0) {
    const partes = repartirPorDia(previa.fecha, cuando, litros);
    await Lectura.insertMany(partes.map(p => ({ usuario: usuarioId, fecha: p.fecha, litros: p.litros, origen: 'medidor' })));
  }
  return { lectura, previa, litros, primera: !previa };
}

// ---------------------------------------------------------------- OCR de la foto
// Tamaño de una imagen JPEG (lee el marcador SOF)
function tamanoJpeg(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m))
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

let trabajador = null;
function motorOCR() {
  if (!trabajador) {
    const { createWorker } = require('tesseract.js');
    trabajador = createWorker('eng', 1, process.env.TESSDATA_PATH ? { langPath: process.env.TESSDATA_PATH, cacheMethod: 'none' } : {})
      .then(async w => {
        await w.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7', user_defined_dpi: '300' }); // una línea de dígitos
        return w;
      })
      .catch(e => { trabajador = null; throw e; });
  }
  return trabajador;
}

// ---- preparación de la imagen: los medidores mezclan dígitos negros (m³) sobre blanco y
//      blancos sobre rojo (litros). Se deja cada dígito oscuro sobre fondo claro.
function otsu(px) {
  const hist = new Array(256).fill(0); px.forEach(v => hist[v]++);
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, mejor = 0, umbral = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = px.length - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > mejor) { mejor = v; umbral = t; }
  }
  return umbral;
}
function manchas(bin, W, H) {
  const etiqueta = new Int32Array(W * H), cajas = [];
  for (let k = 0; k < bin.length; k++) {
    if (!bin[k] || etiqueta[k]) continue;
    const id = cajas.length + 1, pila = [k]; etiqueta[k] = id;
    let minX = W, maxX = 0, minY = H, maxY = 0, n = 0;
    while (pila.length) {
      const q = pila.pop(), x = q % W, y = (q / W) | 0; n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && bin[q - 1] && !etiqueta[q - 1]) { etiqueta[q - 1] = id; pila.push(q - 1); }
      if (x < W - 1 && bin[q + 1] && !etiqueta[q + 1]) { etiqueta[q + 1] = id; pila.push(q + 1); }
      if (y > 0 && bin[q - W] && !etiqueta[q - W]) { etiqueta[q - W] = id; pila.push(q - W); }
      if (y < H - 1 && bin[q + W] && !etiqueta[q + W]) { etiqueta[q + W] = id; pila.push(q + W); }
    }
    cajas.push({ id, minX, maxX, minY, maxY, n, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return { etiqueta, cajas };
}
function abrir(bin, W, H) {                        // erosión + dilatación 3x3: corta uniones finas con el marco
  const er = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let ok = 1; for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!bin[(y + dy) * W + x + dx]) { ok = 0; break; }
    er[y * W + x] = ok;
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let v = 0; for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) if (er[(y + dy) * W + x + dx]) { v = 1; break; }
    out[y * W + x] = v;
  }
  return out;
}
async function digitosSueltos(sharp, gris, W, H, total) {
  // promedio local con imagen integral
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let fila = 0; for (let x = 0; x < W; x++) { fila += gris[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + fila; } }
  const R = Math.max(8, Math.round(H * 0.22)), C = 12;
  const oscuro = new Uint8Array(W * H), claro = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - R), x1 = Math.min(W, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(H, y + R + 1);
    const m = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    const v = gris[y * W + x];
    if (v < m - C) oscuro[y * W + x] = 1; else if (v > m + C) claro[y * W + x] = 1;
  }
  let cand = [];
  for (const bin of [oscuro, claro]) {
    const b = abrir(bin, W, H), { etiqueta, cajas } = manchas(b, W, H);
    for (const c of cajas) {
      const asp = c.w / c.h, llen = c.n / (c.w * c.h);
      if (c.h >= H * 0.3 && c.h <= H * 0.95 && asp >= 0.15 && asp <= 1.0 && llen > 0.12 && llen < 0.6)
        cand.push({ ...c, b, etiqueta, cajas });
    }
  }
  // quitar duplicados que se solapan (queda la más grande)
  cand.sort((a, b) => b.n - a.n);
  const elegidos = [];
  for (const c of cand) {
    const solapa = elegidos.some(e => Math.min(e.maxX, c.maxX) - Math.max(e.minX, c.minX) > 0.4 * Math.min(e.w, c.w));
    if (!solapa) elegidos.push(c);
  }
  // altura parecida entre dígitos: se queda con los más cercanos a la altura típica
  if (elegidos.length > total) {
    const alturas = elegidos.map(e => e.h).sort((a, b) => a - b), med = alturas[alturas.length >> 1];
    elegidos.sort((a, b) => Math.abs(a.h - med) - Math.abs(b.h - med));
    elegidos.length = total;
  }
  elegidos.sort((a, b) => a.minX - b.minX);
  const out = [];
  for (const d of elegidos) {
    const dentro = new Set(d.cajas.filter(c => c.minX >= d.minX && c.maxX <= d.maxX && c.minY >= d.minY && c.maxY <= d.maxY).map(c => c.id));
    const px = new Uint8Array(d.w * d.h).fill(255);
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++)
      if (dentro.has(d.etiqueta[(d.minY + y) * W + d.minX + x])) px[y * d.w + x] = 0;
    out.push(await sharp(Buffer.from(px), { raw: { width: d.w, height: d.h, channels: 1 } })
      .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 255, g: 255, b: 255 } }).png().toBuffer());
  }
  while (out.length < total) out.push(null);       // faltan dígitos: la lectura se rechaza
  return out;
}

async function variantes(jpeg, rect, digitos) {
  const sharp = require('sharp');
  let img = sharp(jpeg).rotate();
  if (rect) img = img.extract(rect);
  const ALTO = 200;
  const { data, info } = await img.resize({ height: ALTO }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, gris = Uint8Array.from(data);
  const png = px => sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 1 } })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 255, g: 255, b: 255 } }).png().toBuffer();

  // A) por segmentos: la tira se divide en tantas columnas como dígitos; las columnas oscuras se invierten
  const seg = Uint8Array.from(gris), medio = otsu(gris);
  for (let s = 0; s < digitos; s++) {
    const x0 = Math.floor(s * W / digitos), x1 = Math.floor((s + 1) * W / digitos);
    let suma = 0, n = 0;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) { suma += gris[y * W + x]; n++; }
    if (suma / n < medio) for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) seg[y * W + x] = 255 - seg[y * W + x];
  }
  const t = otsu(seg);
  for (let k = 0; k < seg.length; k++) seg[k] = seg[k] < t ? 0 : 255;
  for (let x = 0; x < W; x++) {                    // borra líneas verticales (bordes de las ventanitas)
    let negros = 0; for (let y = 0; y < H; y++) if (!seg[y * W + x]) negros++;
    if (negros > H * 0.8) for (let y = 0; y < H; y++) seg[y * W + x] = 255;
  }
  for (let y = 0; y < H; y++) {                    // y líneas horizontales (marco)
    let negros = 0; for (let x = 0; x < W; x++) if (!seg[y * W + x]) negros++;
    if (negros > W * 0.6) for (let x = 0; x < W; x++) seg[y * W + x] = 255;
  }
  // Cada dígito por separado: umbral adaptativo (compara cada píxel con su vecindario) en las dos
  // polaridades -oscuro sobre claro y claro sobre oscuro-, se buscan manchas con forma de dígito
  // y se ordenan de izquierda a derecha.
  const porForma = await digitosSueltos(sharp, gris, W, H, digitos);
  const porColumna = [];                            // columnas iguales sobre la tira normalizada
  for (let s = 0; s < digitos; s++) {
    const x0 = Math.floor(s * W / digitos), x1 = Math.floor((s + 1) * W / digitos);
    let minX = x1, maxX = x0 - 1, minY = H, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) if (!seg[y * W + x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < minX || maxY - minY < H * 0.25) { porColumna.push(null); continue; }
    const w = maxX - minX + 1, hh = maxY - minY + 1, px = new Uint8Array(w * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) px[y * w + x] = seg[(minY + y) * W + minX + x];
    porColumna.push(await sharp(Buffer.from(px), { raw: { width: w, height: hh, channels: 1 } })
      .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 255, g: 255, b: 255 } }).png().toBuffer());
  }
  const inv = gris.map(v => 255 - v);
  return { grupos: [porColumna, porForma], tiras: [await png(seg), await png(gris), await png(inv)] };
}

/**
 * Lee los dígitos del medidor.
 * opciones.recorte  = [x, y, ancho, alto] en fracciones de la imagen (0 a 1) donde están los números
 * opciones.enteros  = cuántos dígitos negros (m³) tiene el medidor (normalmente 5)
 * opciones.decimales= cuántos dígitos rojos (fracción de m³) se leen (0 a 3)
 */
async function leerFotoMedidor(jpeg, { recorte, enteros = 5, decimales = 3 } = {}) {
  const tam = tamanoJpeg(jpeg);
  if (!tam) throw new ErrorLectura(400, 'La foto debe ser JPEG.');
  let rect = null;
  if (recorte) {
    const [x, y, w, h] = recorte.map(Number);
    if ([x, y, w, h].every(v => Number.isFinite(v) && v >= 0 && v <= 1) && w > 0 && h > 0)
      rect = { left: Math.round(x * tam.ancho), top: Math.round(y * tam.alto),
               width: Math.max(1, Math.round(Math.min(w, 1 - x) * tam.ancho)), height: Math.max(1, Math.round(Math.min(h, 1 - y) * tam.alto)) };
  }
  const total = enteros + decimales;
  const w = await motorOCR();
  const v = await variantes(jpeg, rect, total);
  const leidos = [];                                // todas las lecturas completas que salgan
  await w.setParameters({ tessedit_pageseg_mode: '10' });       // un carácter
  for (const grupo of v.grupos) {
    let uno = '';
    for (const img of grupo) {
      const t = img ? ((await w.recognize(img)).data.text || '').replace(/\D/g, '') : '';
      uno += t.length === 1 ? t : '?';
    }
    if (process.env.DEBUG_OCR) console.log('  [ocr] dígito a dígito:', uno);
    if (/^\d+$/.test(uno) && uno.length === total) leidos.push(uno);
  }
  await w.setParameters({ tessedit_pageseg_mode: '7' });        // una línea
  for (const img of v.tiras) {
    const texto = ((await w.recognize(img)).data.text || '').trim();
    const d = (texto.replace(/\s+/g, '').match(/\d+/g) || []).sort((a, b) => b.length - a.length)[0] || '';
    if (process.env.DEBUG_OCR) console.log('  [ocr] tira:', d);
    if (d.length === total) leidos.push(d);
  }
  const candidatos = [...new Set(leidos)].map(d => Number(d) / 10 ** decimales);
  // el más repetido primero
  const votos = d => leidos.filter(x => Number(x) / 10 ** decimales === d).length;
  candidatos.sort((a, b) => votos(b) - votos(a));
  const valor = candidatos.length ? candidatos[0] : null;
  const mejor = { texto: leidos.join(' / '), digitos: leidos[0] || '' };
  return { ...mejor, valor, candidatos, tam };
}

module.exports = { registrarLectura, elegirCandidato, leerFotoMedidor, repartirPorDia, tamanoJpeg, ErrorLectura };
