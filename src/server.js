// Hydroloop BGA · Arranque: conecta a MongoDB y levanta el servidor
require('dotenv').config();
const mongoose = require('mongoose');

for (const k of ['MONGODB_URI', 'JWT_SECRET', 'DEVICE_KEY'])
  if (!process.env[k]) { console.error(`Falta ${k} en el archivo .env (mira .env.example)`); process.exit(1); }

const app = require('./app');
const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log(`Hydroloop BGA listo en http://localhost:${PORT}`)))
  .catch(e => { console.error('No se pudo conectar a MongoDB:', e.message); process.exit(1); });
