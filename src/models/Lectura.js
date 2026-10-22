// Módulo 3 · Lecturas del sensor (hardware ESP32 + caudalímetro)
const mongoose = require('mongoose');

const lecturaSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  fecha:   { type: Date, required: true, default: Date.now },
  litros:  { type: Number, required: true, min: 0 },     // litros medidos en ese envío
  origen:  { type: String, enum: ['sensor', 'medidor', 'simulado'], default: 'sensor' }   // medidor = calculado de las lecturas de la ESP32-CAM
});
lecturaSchema.index({ usuario: 1, fecha: -1 });

module.exports = mongoose.model('Lectura', lecturaSchema);
