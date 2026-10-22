// Fase 1 · Fotos que envía la ESP32-CAM (se guardan las últimas para revisar qué leyó el OCR)
const mongoose = require('mongoose');

const fotoMedidorSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  fecha:   { type: Date, required: true, default: Date.now },
  jpeg:    { type: Buffer, required: true, select: false },
  texto:   { type: String, default: '' },                      // lo que leyó el OCR
  valor:   { type: Number, default: null },                    // lectura interpretada (m³)
  estado:  { type: String, enum: ['ok', 'no-leida', 'dudosa'], required: true },
  mensaje: { type: String, default: '' }
});
fotoMedidorSchema.index({ usuario: 1, fecha: -1 });

module.exports = mongoose.model('FotoMedidor', fotoMedidorSchema);
