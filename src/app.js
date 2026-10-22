// Hydroloop BGA · Aplicación Express (rutas del API + app web)
const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());                                   // permite que la app móvil (Capacitor) llame al API
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/facturas', require('./routes/facturas'));
app.use('/api/lecturas', require('./routes/lecturas'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.get('/api/salud', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.use(express.static(path.join(__dirname, '..', 'public')));   // la app web (public/index.html)

app.use((err, req, res, next) => {               // errores no controlados
  console.error(err);
  if (err.name === 'CastError') return res.status(400).json({ error: 'Identificador inválido.' });
  res.status(500).json({ error: 'Error del servidor.' });
});

module.exports = app;
