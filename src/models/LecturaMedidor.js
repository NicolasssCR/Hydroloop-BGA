// Fase 1 · Cada lectura del medidor de agua (el número que marca, en m³)
// La envía la ESP32-CAM (foto o número) o la escribe el usuario en la app.
const mongoose = require('mongoose');

const lecturaMedidorSchema = new mongoose.Schema({
  usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
  fecha:   { type: Date, required: true, default: Date.now },
  valor:   { type: Number, required: true, min: 0 },          // lectura del medidor en m³, p. ej. 1393.712
  origen:  { type: String, enum: ['camara', 'dispositivo', 'manual'], required: true },
  litros:  { type: Number, default: 0 }                        // consumo desde la lectura anterior
});
lecturaMedidorSchema.index({ usuario: 1, fecha: -1 });

module.exports = mongoose.model('LecturaMedidor', lecturaMedidorSchema);
