const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return process.env.JWT_SECRET || 'taskflow-dev-secret-change-in-prod';
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      name: user.name
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  const payload = jwt.verify(token, getJwtSecret());
  return {
    id: Number(payload.sub),
    username: payload.username,
    email: payload.email,
    name: payload.name
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }
}

module.exports = { signToken, verifyToken, requireAuth };
