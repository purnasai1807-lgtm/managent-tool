const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, requireAuth } = require('../middleware/auth');

const AVATAR_COLORS = ['#2563eb', '#db2777', '#059669', '#7c3aed', '#ea580c', '#0891b2'];

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    role_title: row.role_title,
    avatar_color: row.avatar_color,
    created_at: row.created_at
  };
}

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/register', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const username = String(req.body?.username || '').trim().toLowerCase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const roleTitle = String(req.body?.role_title || 'Team Member').trim().slice(0, 40);

    if (name.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: 'Username must be 3–24 characters using letters, numbers, or underscores.'
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const exists = db
      .prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    if (exists) {
      return res.status(409).json({
        error: exists.username === username ? 'Username already taken.' : 'Email already registered.'
      });
    }

    const color = AVATAR_COLORS[username.length % AVATAR_COLORS.length];
    const hash = bcrypt.hashSync(password, 10);
    const insert = db
      .prepare(
        'INSERT INTO users (name, username, email, password_hash, role_title, avatar_color) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(name, username, email, hash, roleTitle || 'Team Member', color);

    const user = sanitizeUser(
      db.prepare('SELECT * FROM users WHERE id = ?').get(Number(insert.lastInsertRowid))
    );
    return res.status(201).json({ user, token: signToken(user) });
  });

  router.post('/login', (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/username and password are required.' });
    }

    const row = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?')
      .get(identifier, identifier);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = sanitizeUser(row);
    return res.json({ user, token: signToken(user) });
  });

  router.get('/me', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: sanitizeUser(row) });
  });

  router.get('/users', requireAuth, (_req, res) => {
    const users = db
      .prepare('SELECT id, name, username, email, role_title, avatar_color FROM users ORDER BY name ASC')
      .all();
    return res.json({ users });
  });

  return router;
}

module.exports = { createAuthRouter, sanitizeUser };
