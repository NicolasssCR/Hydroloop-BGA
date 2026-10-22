// Módulo 2 · Historial de facturas escaneadas
const router = require('express').Router();
const Factura = require('../models/Factura');
const requiereSesion = require('../middleware/auth');

router.use(requiereSesion);

const NUMERICOS = ['actual', 'anterior', 'promedio', 'dias', 'valorM3', 'fijo', 'consumoCobro', 'otros', 'total'];
const TEXTO = ['nombre', 'dir', 'municipio', 'estrato', 'periodo'];

function limpiar(body) {
  const f = {};
  TEXTO.forEach(k => { if (body[k] != null) f[k] = String(body[k]).slice(0, 200); });
  NUMERICOS.forEach(k => { const n = Number(body[k]); if (body[k] != null && body[k] !== '' && Number.isFinite(n)) f[k] = n; });
  if (typeof body.textoOCR === 'string') f.textoOCR = body.textoOCR.slice(0, 20000);
  return f;
}

// POST /api/facturas  → guarda una factura escaneada (y corregida por el usuario)
router.post('/', async (req, res, next) => {
  try {
    const datos = limpiar(req.body || {});
    if (!(datos.promedio > 0) || !(datos.valorM3 > 0) || !(datos.total > 0) || !(datos.actual >= 0))
      return res.status(400).json({ error: 'Faltan el consumo, el promedio, el valor por m³ o el total.' });
    // "Consumo anterior" = consumo de la factura anterior guardada, si existe
    if (datos.anterior == null) {
      const previa = await Factura.findOne({ usuario: req.usuarioId }).sort({ createdAt: -1 });
      if (previa) datos.anterior = previa.actual;
    }
    const f = await Factura.create({ ...datos, usuario: req.usuarioId });
    res.status(201).json({ factura: f });
  } catch (e) { next(e); }
});

// GET /api/facturas  → historial (más reciente primero)
router.get('/', async (req, res, next) => {
  try {
    res.json({ facturas: await Factura.find({ usuario: req.usuarioId }).sort({ createdAt: -1 }).limit(24) });
  } catch (e) { next(e); }
});

// DELETE /api/facturas/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const r = await Factura.deleteOne({ _id: req.params.id, usuario: req.usuarioId });
    if (!r.deletedCount) return res.status(404).json({ error: 'Factura no encontrada.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
