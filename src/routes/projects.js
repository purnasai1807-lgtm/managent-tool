const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('../services/notify');

function isProjectMember(db, projectId, userId) {
  return db
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId);
}

function hydrateTask(db, taskId) {
  return db
    .prepare(
      `SELECT
        t.*,
        a.name AS assignee_name,
        a.username AS assignee_username,
        a.avatar_color AS assignee_color,
        c.name AS creator_name,
        (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comments_count
      FROM tasks t
      LEFT JOIN users a ON a.id = t.assignee_id
      JOIN users c ON c.id = t.creator_id
      WHERE t.id = ?`
    )
    .get(taskId);
}

function createProjectsRouter(db, io) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const projects = db
      .prepare(
        `SELECT
          p.*,
          pm.role AS my_role,
          (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = ?
        ORDER BY p.id DESC`
      )
      .all(req.user.id);

    return res.json({ projects });
  });

  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const color = /^#[0-9a-fA-F]{6}$/.test(req.body?.color || '') ? req.body.color : '#2563eb';
    const memberIdentifiers = Array.isArray(req.body?.members) ? req.body.members : [];

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: 'Project name must be between 2 and 80 characters.' });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      const insertProj = db
        .prepare('INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)')
        .run(name, description.slice(0, 400), color, req.user.id);
      const projectId = Number(insertProj.lastInsertRowid);

      const addMember = db.prepare(
        'INSERT OR IGNORE INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
      );
      addMember.run(projectId, req.user.id, 'owner');

      const invitedIds = [];
      for (const rawIdent of memberIdentifiers) {
        const ident = String(rawIdent || '').trim().toLowerCase();
        if (!ident) continue;
        const found = db
          .prepare('SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(username) = ? OR id = ?')
          .get(ident, ident, Number(ident) || -1);
        if (found && found.id !== req.user.id) {
          addMember.run(projectId, found.id, 'member');
          invitedIds.push(found.id);
        }
      }

      const defaultColumns = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'];
      const insertCol = db.prepare(
        'INSERT INTO columns (project_id, title, position) VALUES (?, ?, ?)'
      );
      defaultColumns.forEach((title, idx) => insertCol.run(projectId, title, idx));

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      db.exec('COMMIT');

      for (const uid of invitedIds) {
        createNotification(db, io, {
          userId: uid,
          actorId: req.user.id,
          projectId,
          message: `${req.user.name} added you to project "${name}"`
        });
      }

      return res.status(201).json({ project });
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  });

  router.get('/:id', (req, res) => {
    const projectId = Number(req.params.id);
    const membership = isProjectMember(db, projectId, req.user.id);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied or project not found.' });
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.username, u.email, u.role_title, u.avatar_color, pm.role AS project_role
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = ?
         ORDER BY CASE WHEN pm.role = 'owner' THEN 0 ELSE 1 END, u.name ASC`
      )
      .all(projectId);

    const columns = db
      .prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position ASC, id ASC')
      .all(projectId);

    const tasks = db
      .prepare(
        `SELECT
          t.*,
          a.name AS assignee_name,
          a.username AS assignee_username,
          a.avatar_color AS assignee_color,
          c.name AS creator_name,
          (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comments_count
        FROM tasks t
        LEFT JOIN users a ON a.id = t.assignee_id
        JOIN users c ON c.id = t.creator_id
        WHERE t.project_id = ?
        ORDER BY t.position ASC, t.id ASC`
      )
      .all(projectId);

    return res.json({ project, my_role: membership.role, members, columns, tasks });
  });

  router.post('/:id/members', (req, res) => {
    const projectId = Number(req.params.id);
    const membership = isProjectMember(db, projectId, req.user.id);
    if (!membership) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const identifier = String(req.body?.identifier || req.body?.email || '').trim().toLowerCase();
    if (!identifier) {
      return res.status(400).json({ error: 'Username or email is required.' });
    }

    const target = db
      .prepare('SELECT id, name, username, email, role_title, avatar_color FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?')
      .get(identifier, identifier);
    if (!target) {
      return res.status(404).json({ error: 'No user found with that username or email.' });
    }

    const existing = isProjectMember(db, projectId, target.id);
    if (existing) {
      return res.status(409).json({ error: `${target.name} is already a member of this project.` });
    }

    db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(
      projectId,
      target.id,
      'member'
    );

    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
    const member = { ...target, project_role: 'member' };

    io?.to(`project:${projectId}`).emit('member:added', { projectId, member });
    createNotification(db, io, {
      userId: target.id,
      actorId: req.user.id,
      projectId,
      message: `${req.user.name} invited you to "${project?.name || 'a project'}"`
    });

    return res.status(201).json({ member });
  });

  router.post('/:id/columns', (req, res) => {
    const projectId = Number(req.params.id);
    if (!isProjectMember(db, projectId, req.user.id)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const title = String(req.body?.title || '').trim();
    if (title.length < 1 || title.length > 40) {
      return res.status(400).json({ error: 'Column title must be between 1 and 40 characters.' });
    }

    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM columns WHERE project_id = ?')
      .get(projectId).max_pos;

    const insert = db
      .prepare('INSERT INTO columns (project_id, title, position) VALUES (?, ?, ?)')
      .run(projectId, title, maxPos + 1);

    const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(Number(insert.lastInsertRowid));
    io?.to(`project:${projectId}`).emit('column:created', { projectId, column });
    return res.status(201).json({ column });
  });

  router.delete('/:id', (req, res) => {
    const projectId = Number(req.params.id);
    const membership = isProjectMember(db, projectId, req.user.id);
    if (!membership || membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only the project owner can delete this project.' });
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    io?.to(`project:${projectId}`).emit('project:deleted', { projectId });
    return res.json({ deleted: true, projectId });
  });

  return { router, hydrateTask, isProjectMember };
}

module.exports = { createProjectsRouter, hydrateTask, isProjectMember };
