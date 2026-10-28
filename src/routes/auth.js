// Módulo 1 · Registro, inicio de sesión y perfil
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const requiereSesion = require('../middleware/auth');

const firmar = u => jwt.sign({ sub: u._id.toString() }, process.env.JWT_SECRET, { expiresIn: '30d' });
const correoValido = c => typeof c === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
// Una ESP32-CAM envía sus fotos a UNA sola cuenta: la última que escribió su serial.
// Las fotos y lecturas que ya tenía cada cuenta se quedan en esa cuenta.
const liberarSerial = (serial, menosId) => serial
  ? Usuario.updateMany({ dispositivo: serial, ...(menosId ? { _id: { $ne: menosId } } : {}) }, { dispositivo: null })
  : null;

// POST /api/auth/registro  { nombre, correo, clave, estrato, dir, municipio, dispositivo? }
router.post('/registro', async (req, res, next) => {
  try {
    const { nombre, correo, clave, estrato, dir, municipio, dispositivo } = req.body || {};
    if (!nombre || !correoValido(correo) || !clave || clave.length < 4)
      return res.status(400).json({ error: 'Revisa el nombre, un correo válido y una contraseña de mínimo 4 caracteres.' });
    if (await Usuario.exists({ correo: correo.toLowerCase() }))
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
    if (dispositivo) await liberarSerial(String(dispositivo).trim());
    const u = await Usuario.create({
      nombre, correo, claveHash: await bcrypt.hash(clave, 10),
      estrato: String(estrato || '3'), dir: dir || '', municipio: municipio || 'Bucaramanga',
      dispositivo: dispositivo ? String(dispositivo).trim() : null
    });
    res.status(201).json({ token: firmar(u), usuario: u.publico() });
  } catch (e) { next(e); }
});

// POST /api/auth/login  { correo, clave }
router.post('/login', async (req, res, next) => {
  try {
    const { correo, clave } = req.body || {};
    const u = correoValido(correo) && await Usuario.findOne({ correo: correo.toLowerCase() });
    if (!u || !(await bcrypt.compare(clave || '', u.claveHash)))
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    res.json({ token: firmar(u), usuario: u.publico() });
  } catch (e) { next(e); }
});

// GET /api/auth/yo  → perfil del usuario con sesión
router.get('/yo', requiereSesion, async (req, res, next) => {
  try {
    const u = await Usuario.findById(req.usuarioId);
    if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ usuario: u.publico() });
  } catch (e) { next(e); }
});

// PUT /api/auth/yo  { nombre, estrato, dir, municipio, dispositivo }  → configurar perfil
router.put('/yo', requiereSesion, async (req, res, next) => {
  try {
    const campos = ['nombre', 'estrato', 'dir', 'municipio', 'dispositivo'];
    const cambios = Object.fromEntries(campos.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
    if (cambios.dispositivo !== undefined) {
      cambios.dispositivo = cambios.dispositivo ? String(cambios.dispositivo).trim() : null;
      await liberarSerial(cambios.dispositivo, req.usuarioId);      // si otra cuenta la tenía, pasa a esta
    }
    const u = await Usuario.findByIdAndUpdate(req.usuarioId, cambios, { new: true });
    res.json({ usuario: u.publico() });
  } catch (e) { next(e); }
});

module.exports = router;