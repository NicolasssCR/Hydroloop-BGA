// Módulo 2 · Cada factura escaneada (historial)
const mongoose = require('mongoose');

const facturaSchema = new mongoose.Schema({
  usuario:   { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true, index: true },
  // Información del usuario impresa en la factura
  nombre: String, dir: String, municipio: String, estrato: String,
  periodo:   { type: String, default: '' },     // p. ej. "ABRIL/2026"
  // Resumen de consumo (m³)
  actual:    { type: Number, required: true, min: 0 },
  anterior:  { type: Number, default: null },
  promedio:  { type: Number, required: true, min: 0 },
  dias:      { type: Number, default: 30 },
  // Tarifas locales ($ COP)
  valorM3:      { type: Number, required: true, min: 0 },
  fijo:         { type: Number, default: 0 },
  consumoCobro: { type: Number, default: 0 },
  otros:        { type: Number, default: 0 },
  total:        { type: Number, required: true, min: 0 },
  textoOCR:     { type: String, select: false }   // texto crudo leído (para revisar errores)
}, { timestamps: true });

module.exports = mongoose.model('Factura', facturaSchema);
