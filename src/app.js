const http = require('node:http');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { createDatabase } = require('./db/database');
const { verifyToken } = require('./middleware/auth');
const { createAuthRouter } = require('./routes/auth');
const { createProjectsRouter, isProjectMember } = require('./routes/projects');
const { createTasksRouter } = require('./routes/tasks');
const { createNotificationsRouter } = require('./routes/notifications');

function createApp(options = {}) {
  const db = options.db || createDatabase(options.dbPath);
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = verifyToken(token);
      return next();
    } catch {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    socket.on('project:join', (projectId) => {
      const pid = Number(projectId);
      if (!pid || !isProjectMember(db, pid, socket.user.id)) return;
      for (const room of socket.rooms) {
        if (room.startsWith('project:')) socket.leave(room);
      }
      socket.join(`project:${pid}`);
    });
  });

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'taskflow-pm', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/projects', createProjectsRouter(db, io).router);
  app.use('/api', createTasksRouter(db, io));
  app.use('/api/notifications', createNotificationsRouter(db));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return { app, server, io, db };
}

module.exports = { createApp };
