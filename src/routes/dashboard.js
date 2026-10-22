// Módulo 3 · Predicción & Control
// Junta la última factura (tarifas), el historial y las lecturas del sensor de los últimos 7 días,
// y calcula la proyección de la próxima factura y la alerta de consumo anómalo.
const router = require('express').Router();
const Factura = require('../models/Factura');
const Lectura = require('../models/Lectura');
const LecturaMedidor = require('../models/LecturaMedidor');
const requiereSesion = require('../middleware/auth');

const UMBRAL_ALERTA = 15;                  // % por encima de lo habitual que dispara la alerta
const ZONA = 'America/Bogota';
const LETRAS = { Mon: 'L', Tue: 'M', Wed: 'M', Thu: 'J', Fri: 'V', Sat: 'S', Sun: 'D' };
const claveDia = d => d.toLocaleDateString('en-CA', { timeZone: ZONA });                 // "2026-10-20"
const letraDia = d => LETRAS[d.toLocaleDateString('en-US', { timeZone: ZONA, weekday: 'short' })];

router.get('/', requiereSesion, async (req, res, next) => {
  try {
    const historial = await Factura.find({ usuario: req.usuarioId }).sort({ createdAt: -1 }).limit(12);
    const factura = historial[0];
    if (!factura) return res.json({ factura: null, historial: [] });

    // Consumo habitual: promedio de los m³ de las facturas guardadas (si hay 2 o más);
    // si solo hay una, el "promedio histórico" impreso en ella.
    const habitual = historial.length >= 2
      ? historial.reduce((s, f) => s + f.actual, 0) / historial.length
      : factura.promedio;

    // Litros por día de los últimos 7 días (hoy incluido), en hora de Colombia
    const hoy = new Date();
    const dias = [...Array(7)].map((_, i) => new Date(hoy.getTime() - (6 - i) * 86400000));
    const lecturas = await Lectura.find({ usuario: req.usuarioId, fecha: { $gte: new Date(hoy.getTime() - 8 * 86400000) } });
    // Si lo más reciente es una simulación se muestra la simulación;
    // si no, los datos reales (medidor con ESP32-CAM y/o caudalímetro)
    const ultima = lecturas.reduce((a, l) => (!a || l.fecha > a.fecha ? l : a), null);
    const fuente = !ultima ? null : ultima.origen === 'simulado' ? 'simulado' : 'real';
    const esDeFuente = l => (l.origen === 'simulado') === (fuente === 'simulado');
    const porDia = {};
    lecturas.filter(esDeFuente).forEach(l => { const k = claveDia(l.fecha); porDia[k] = (porDia[k] || 0) + l.litros; });
    const semana = dias.map(d => ({ dia: letraDia(d), fecha: claveDia(d), litros: Math.round(porDia[claveDia(d)] || 0) }));
    const conDatos = semana.filter(d => d.litros > 0);

    let calculo = null, alerta = null;
    if (conDatos.length) {
      const promDia = conDatos.reduce((s, d) => s + d.litros, 0) / conDatos.length;   // litros/día medidos
      const proyM3 = promDia * 30 / 1000;                                             // m³ proyectados al mes
      const facturaEst = factura.fijo + proyM3 * factura.valorM3 + factura.otros;     // fijo + consumo + otros
      const maxFactura = factura.fijo + factura.otros + habitual * 1.8 * factura.valorM3; // tope del velocímetro
      const pct = (proyM3 / habitual - 1) * 100;
      calculo = { promDia, proyM3, facturaEst, fraccion: Math.min(facturaEst / maxFactura, 1), pct };
      alerta = pct > UMBRAL_ALERTA
        ? { activa: true, titulo: '¡ALERTA!', mensaje: `Tu consumo actual está ${Math.round(pct)}% por encima de lo habitual. Revisa si hay fugas o desperdicios.` }
        : { activa: false, titulo: 'Todo en orden', mensaje: `Tu consumo está dentro de lo habitual (${pct >= 0 ? '+' : ''}${Math.round(pct)}%).` };
    }

    const ultimaMedidor = await LecturaMedidor.findOne({ usuario: req.usuarioId }).sort({ fecha: -1 });
    res.json({
      medidor: ultimaMedidor ? { valor: ultimaMedidor.valor, fecha: ultimaMedidor.fecha, origen: ultimaMedidor.origen } : null,
      factura, umbral: UMBRAL_ALERTA, habitual: Math.round(habitual * 10) / 10,
      historial: historial.map(f => ({ id: f._id, periodo: f.periodo, actual: f.actual, total: f.total, fecha: f.createdAt })),
      semana, fuente, calculo, alerta
    });
  } catch (e) { next(e); }
});

module.exports = router;
