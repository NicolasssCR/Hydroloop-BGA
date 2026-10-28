// Módulo 3 · Datos del hardware
//  Fase 1 (ESP32-CAM en el medidor), cualquiera de estas tres formas:
//  - POST /api/lecturas/foto           la cámara envía la FOTO y el servidor lee los dígitos (OCR)
//  - POST /api/lecturas/medidor        el dispositivo envía la LECTURA ya convertida en número (m³)
//  - POST /api/lecturas/medidor/manual el usuario escribe la lectura en la app
//  Otros:
//  - POST /api/lecturas/sensor         litros directos (caudalímetro)
//  - POST /api/lecturas/simular        semana simulada (para demostraciones)
const express = require('express');
const router = express.Router();
const Lectura = require('../models/Lectura');
const Usuario = require('../models/Usuario');
const Factura = require('../models/Factura');
const LecturaMedidor = require('../models/LecturaMedidor');
const FotoMedidor = require('../models/FotoMedidor');
const requiereSesion = require('../middleware/auth');
const { registrarLectura, elegirCandidato, leerFotoMedidor, ErrorLectura } = require('../medidor');

// El dispositivo se identifica con su serial (vinculado al perfil del usuario) y la clave DEVICE_KEY
async function usuarioDelDispositivo(req) {
  if (req.headers['x-device-key'] !== process.env.DEVICE_KEY) throw new ErrorLectura(401, 'Clave de dispositivo inválida.');
  const dispositivo = String(req.query.dispositivo || (req.body && req.body.dispositivo) || '').trim();
  if (!dispositivo) throw new ErrorLectura(400, 'Falta el serial del dispositivo ("dispositivo").');
  const u = await Usuario.findOne({ dispositivo });
  if (!u) throw new ErrorLectura(404, `El dispositivo ${dispositivo} no está vinculado a ningún usuario. Escríbelo en la app (Dashboard → Medidor).`);
  return u;
}
const responderError = (res, next) => e => e instanceof ErrorLectura ? res.status(e.status).json({ error: e.message }) : next(e);
const resumen = r => ({
  ok: true, lectura: r.lectura.valor, fecha: r.lectura.fecha, litros: Math.round(r.litros),
  mensaje: r.primera ? 'Primera lectura guardada: desde la próxima se calcula el consumo.'
         : r.reinicio ? `Lectura guardada. Es menor que la anterior (${r.previa.valor} m³), así que se toma como nuevo punto de partida.`
                      : `Consumo desde la lectura anterior: ${Math.round(r.litros)} L.`
});

// POST /api/lecturas/medidor     (dispositivo que ya convierte la foto en número)
// Cabecera x-device-key   Cuerpo: { "dispositivo": "ESP32-001", "lectura": 1393.712 }
router.post('/medidor', async (req, res, next) => {
  try {
    const u = await usuarioDelDispositivo(req);
    res.status(201).json(resumen(await registrarLectura(u._id, req.body && req.body.lectura, 'dispositivo')));
  } catch (e) { responderError(res, next)(e); }
});

// POST /api/lecturas/foto?dispositivo=ESP32-001&enteros=5&decimales=3&recorte=0.2,0.35,0.6,0.15&rotar=90&espejo=1
// Cabeceras: x-device-key, Content-Type: image/jpeg     Cuerpo: la foto JPEG
//   rotar  = 0, 90, 180 o 270 (grados, sentido del reloj) si la cámara quedó de lado
//   espejo = 1 si la imagen sale invertida como en un espejo
//   El recorte se aplica sobre la foto YA enderezada (la que se ve en la app).
router.post('/foto', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '3mb' }), async (req, res, next) => {
  try {
    const u = await usuarioDelDispositivo(req);
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new ErrorLectura(400, 'Envía la foto JPEG en el cuerpo (Content-Type: image/jpeg).');
    const enteros = Math.min(Math.max(parseInt(req.query.enteros) || 5, 1), 9);
    const decimales = Math.min(Math.max(parseInt(req.query.decimales ?? 3) || 0, 0), 4);
    const recorte = req.query.recorte ? String(req.query.recorte).split(',') : null;
    const rotar = [90, 180, 270].includes(Number(req.query.rotar)) ? Number(req.query.rotar) : 0;
    const espejo = req.query.espejo === '1';
    let jpeg = req.body;
    if (rotar || espejo) {                         // enderezar antes de leer (y guardar derecha)
      const sharp = require('sharp');            // dos pasos: sharp aplica el espejo antes que el giro
      if (rotar) jpeg = await sharp(jpeg).rotate(rotar).jpeg({ quality: 92 }).toBuffer();
      if (espejo) jpeg = await sharp(jpeg).flop().jpeg({ quality: 92 }).toBuffer();
    }
    const ocr = await leerFotoMedidor(jpeg, { recorte, enteros, decimales });
    const foto = { usuario: u._id, jpeg, texto: ocr.texto, valor: ocr.valor };
    if (ocr.valor == null) {
      await FotoMedidor.create({ ...foto, estado: 'no-leida', mensaje: `No se leyeron los ${enteros + decimales} dígitos del medidor. Revisa la foto o escribe la lectura a mano.` });
      return res.status(422).json({ error: 'No se pudieron leer los dígitos del medidor.', leido: ocr.texto });
    }
    ocr.valor = await elegirCandidato(u._id, ocr.candidatos);      // la que cuadra con la lectura anterior
    foto.valor = ocr.valor;
    try {
      const r = await registrarLectura(u._id, ocr.valor, 'camara');
      await FotoMedidor.create({ ...foto, estado: 'ok', mensaje: resumen(r).mensaje });
      res.status(201).json({ ...resumen(r), leido: ocr.texto });
    } catch (e) {
      if (!(e instanceof ErrorLectura)) throw e;
      await FotoMedidor.create({ ...foto, estado: 'dudosa', mensaje: e.message });
      res.status(e.status).json({ error: e.message, leido: ocr.texto });
    }
  } catch (e) { responderError(res, next)(e); }
});

// POST /api/lecturas/medidor/manual   { "lectura": 1393.712 }   (el usuario lee el medidor y lo escribe)
router.post('/medidor/manual', requiereSesion, async (req, res, next) => {
  try {
    res.status(201).json(resumen(await registrarLectura(req.usuarioId, req.body && req.body.lectura, 'manual')));
  } catch (e) { responderError(res, next)(e); }
});

// GET /api/lecturas/medidor   → últimas lecturas y estado de la última foto
router.get('/medidor', requiereSesion, async (req, res, next) => {
  try {
    const lecturas = await LecturaMedidor.find({ usuario: req.usuarioId }).sort({ fecha: -1 }).limit(10);
    const foto = await FotoMedidor.findOne({ usuario: req.usuarioId }).sort({ fecha: -1 });
    res.json({
      lecturas: lecturas.map(l => ({ valor: l.valor, fecha: l.fecha, origen: l.origen, litros: Math.round(l.litros) })),
      foto: foto ? { id: foto._id, fecha: foto.fecha, estado: foto.estado, valor: foto.valor, texto: foto.texto, mensaje: foto.mensaje } : null
    });
  } catch (e) { next(e); }
});

// DELETE /api/lecturas/medidor  → borra lecturas, consumo calculado y fotos del medidor (empezar de cero)
router.delete('/medidor', requiereSesion, async (req, res, next) => {
  try {
    await LecturaMedidor.deleteMany({ usuario: req.usuarioId });
    await Lectura.deleteMany({ usuario: req.usuarioId, origen: 'medidor' });
    await FotoMedidor.deleteMany({ usuario: req.usuarioId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/lecturas/medidor/fotos  → historial de fotos del usuario que inició sesión (sin la imagen)
router.get('/medidor/fotos', requiereSesion, async (req, res, next) => {
  try {
    const fotos = await FotoMedidor.find({ usuario: req.usuarioId }).sort({ fecha: -1 }).limit(Number(req.query.limite) || 30);
    res.json({ fotos: fotos.map(f => ({ id: f._id, fecha: f.fecha, estado: f.estado, valor: f.valor, mensaje: f.mensaje })) });
  } catch (e) { next(e); }
});

// GET /api/lecturas/medidor/foto       → la última foto (JPEG)
// GET /api/lecturas/medidor/foto/:id   → una foto del historial (solo si es del mismo usuario)
router.get(['/medidor/foto', '/medidor/foto/:id'], requiereSesion, async (req, res, next) => {
  try {
    const filtro = { usuario: req.usuarioId };
    if (req.params.id) {
      if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(404).json({ error: 'Foto no encontrada.' });
      filtro._id = req.params.id;
    }
    const foto = await FotoMedidor.findOne(filtro).sort({ fecha: -1 }).select('+jpeg');
    if (!foto) return res.status(404).json({ error: 'Aún no hay fotos del medidor.' });
    res.type('image/jpeg').send(foto.jpeg);
  } catch (e) { next(e); }
});

// POST /api/lecturas/sensor
// Cabecera: x-device-key: <DEVICE_KEY>   Cuerpo: { "dispositivo": "ESP32-001", "litros": 12.5 }
router.post('/sensor', async (req, res, next) => {
  try {
    if (req.headers['x-device-key'] !== process.env.DEVICE_KEY)
      return res.status(401).json({ error: 'Clave de dispositivo inválida.' });
    const { dispositivo, litros } = req.body || {};
    const l = Number(litros);
    if (!dispositivo || !Number.isFinite(l) || l < 0)
      return res.status(400).json({ error: 'Envía "dispositivo" y "litros" (un número positivo).' });
    const u = await Usuario.findOne({ dispositivo });
    if (!u) return res.status(404).json({ error: 'Ese dispositivo no está vinculado a ningún usuario.' });
    await Lectura.create({ usuario: u._id, litros: l, origen: 'sensor' });
    await Lectura.deleteMany({ usuario: u._id, origen: 'simulado' });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/lecturas/simular  { factor }   (1 = normal, 1.5 = fuga)
// Borra las lecturas simuladas anteriores y crea 7 días alrededor del promedio de la última factura.
router.post('/simular', requiereSesion, async (req, res, next) => {
  try {
    const f = await Factura.findOne({ usuario: req.usuarioId }).sort({ createdAt: -1 });
    if (!f) return res.status(400).json({ error: 'Primero escanea una factura.' });
    const factor = Number(req.body?.factor) || (0.85 + Math.random() * 0.45);
    const base = f.promedio * 1000 / 30;                       // litros por día habituales
    await Lectura.deleteMany({ usuario: req.usuarioId, origen: 'simulado' });
    const hoy = new Date();
    const docs = [...Array(7)].map((_, i) => ({
      usuario: req.usuarioId, origen: 'simulado',
      fecha: new Date(hoy.getTime() - (6 - i) * 86400000),
      litros: Math.round(base * factor * (0.7 + Math.random() * 0.6))
    }));
    await Lectura.insertMany(docs);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;