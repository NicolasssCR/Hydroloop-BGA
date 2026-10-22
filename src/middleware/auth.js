// Verifica el token de sesión (JWT) que la app envía en "Authorization: Bearer <token>"
const jwt = require('jsonwebtoken');

module.exports = function requiereSesion(req, res, next) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return res.status(401).json({ error: 'Inicia sesión primero.' });
  try {
    req.usuarioId = jwt.verify(token, process.env.JWT_SECRET).sub;
    next();
  } catch {
    res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
  }
};
