// Módulo 1 · Perfil del usuario
const mongoose = require('mongoose');

const usuarioSchema = new mongoose.Schema({
  nombre:     { type: String, required: true, trim: true },
  correo:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  claveHash:  { type: String, required: true },          // nunca se guarda la contraseña en texto
  estrato:    { type: String, default: '3' },
  dir:        { type: String, default: '' },
  municipio:  { type: String, default: 'Bucaramanga' },
  dispositivo:{ type: String, default: null, index: true } // serial del ESP32 que mide su consumo
}, { timestamps: true });

// Lo que se envía a la app (sin la contraseña)
usuarioSchema.methods.publico = function () {
  const { _id, nombre, correo, estrato, dir, municipio, dispositivo } = this;
  return { id: _id, nombre, correo, estrato, dir, municipio, dispositivo };
};

module.exports = mongoose.model('Usuario', usuarioSchema);
