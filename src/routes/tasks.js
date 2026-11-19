const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createNotification } = require('../services/notify');
const { hydrateTask, isProjectMember } = require('./projects');

function createTasksRouter(db, io) {
  const router = express.Router();
  router.use(requireAuth);

  router.post('/projects/:projectId/tasks', (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!isProjectMember(db, projectId, req.user.id)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const priority = ['low', 'medium', 'high', 'urgent'].includes(req.body?.priority)
      ? req.body.priority
      : 'medium';
    const dueDate = req.body?.due_date ? String(req.body.due_date).slice(0, 20) : null;
    const assigneeId = req.body?.assignee_id ? Number(req.body.assignee_id) : null;

    if (title.length < 2 || title.length > 140) {
      return res.status(400).json({ error: 'Task title must be between 2 and 140 characters.' });
    }

    let columnId = Number(req.body?.column_id);
    if (!columnId) {
      const firstCol = db
        .prepare('SELECT id FROM columns WHERE project_id = ? ORDER BY position ASC, id ASC LIMIT 1')
        .get(projectId);
      if (!firstCol) return res.status(400).json({ error: 'Project has no columns.' });
      columnId = firstCol.id;
    } else {
      const validCol = db
        .prepare('SELECT id FROM columns WHERE id = ? AND project_id = ?')
        .get(columnId, projectId);
      if (!validCol) return res.status(400).json({ error: 'Column does not belong to this project.' });
    }

    if (assigneeId && !isProjectMember(db, projectId, assigneeId)) {
      return res.status(400).json({ error: 'Assignee must be a member of the project.' });
    }

    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max_pos FROM tasks WHERE column_id = ?')
      .get(columnId).max_pos;

    const insert = db
      .prepare(
        `INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, assignee_id, creator_id, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectId,
        columnId,
        title,
        description.slice(0, 2000),
        priority,
        dueDate,
        assigneeId,
        req.user.id,
        maxPos + 1
      );

    const task = hydrateTask(db, Number(insert.lastInsertRowid));
    io?.to(`project:${projectId}`).emit('task:created', { projectId, task });

    if (assigneeId) {
      createNotification(db, io, {
        userId: assigneeId,
        actorId: req.user.id,
        projectId,
        taskId: task.id,
        message: `${req.user.name} assigned you task "${task.title}"`
      });
    }

    return res.status(201).json({ task });
  });

  router.patch('/tasks/:id', (req, res) => {
    const taskId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found.' });

    if (!isProjectMember(db, existing.project_id, req.user.id)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
    const description =
      req.body?.description !== undefined ? String(req.body.description).trim() : existing.description;
    const priority = ['low', 'medium', 'high', 'urgent'].includes(req.body?.priority)
      ? req.body.priority
      : existing.priority;
    const dueDate =
      req.body?.due_date !== undefined
        ? req.body.due_date
          ? String(req.body.due_date).slice(0, 20)
          : null
        : existing.due_date;

    let columnId = existing.column_id;
    if (req.body?.column_id !== undefined) {
      columnId = Number(req.body.column_id);
      const validCol = db
        .prepare('SELECT id FROM columns WHERE id = ? AND project_id = ?')
        .get(columnId, existing.project_id);
      if (!validCol) {
        return res.status(400).json({ error: 'Invalid target column for this project.' });
      }
    }

    let assigneeId = existing.assignee_id;
    if (req.body?.assignee_id !== undefined) {
      assigneeId = req.body.assignee_id ? Number(req.body.assignee_id) : null;
      if (assigneeId && !isProjectMember(db, existing.project_id, assigneeId)) {
        return res.status(400).json({ error: 'Assignee must be a project member.' });
      }
    }

    const position =
      req.body?.position !== undefined && Number.isInteger(Number(req.body.position))
        ? Number(req.body.position)
        : existing.position;

    if (title.length < 2 || title.length > 140) {
      return res.status(400).json({ error: 'Task title must be between 2 and 140 characters.' });
    }

    db.prepare(
      `UPDATE tasks
       SET title = ?, description = ?, priority = ?, due_date = ?, column_id = ?, assignee_id = ?, position = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(title, description.slice(0, 2000), priority, dueDate, columnId, assigneeId, position, taskId);

    const task = hydrateTask(db, taskId);
    io?.to(`project:${existing.project_id}`).emit('task:updated', {
      projectId: existing.project_id,
      task
    });

    if (assigneeId && assigneeId !== existing.assignee_id) {
      createNotification(db, io, {
        userId: assigneeId,
        actorId: req.user.id,
        projectId: existing.project_id,
        taskId: task.id,
        message: `${req.user.name} assigned you task "${task.title}"`
      });
    }

    return res.json({ task });
  });

  router.delete('/tasks/:id', (req, res) => {
    const taskId = Number(req.params.id);
    const existing = db.prepare('SELECT id, project_id FROM tasks WHERE id = ?').get(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found.' });
    if (!isProjectMember(db, existing.project_id, req.user.id)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
    io?.to(`project:${existing.project_id}`).emit('task:deleted', {
      projectId: existing.project_id,
      taskId
    });
    return res.json({ deleted: true, taskId });
  });

  router.get('/tasks/:id/comments', (req, res) => {
    const taskId = Number(req.params.id);
    const existing = db.prepare('SELECT id, project_id FROM tasks WHERE id = ?').get(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found.' });
    if (!isProjectMember(db, existing.project_id, req.user.id)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const comments = db
      .prepare(
        `SELECT tc.*, u.name AS author_name, u.username AS author_username, u.avatar_color AS author_color
         FROM task_comments tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.task_id = ?
         ORDER BY tc.id ASC`
      )
      .all(taskId);
    return res.json({ comments });
  });

  router.post('/tasks/:id/comments', (req, res) => {
    const taskId = Number(req.params.id);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (!isProjectMember(db, task.project_id, req.user.id)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const content = String(req.body?.content || '').trim();
    if (content.length < 1 || content.length > 800) {
      return res.status(400).json({ error: 'Comment must be between 1 and 800 characters.' });
    }

    const insert = db
      .prepare('INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)')
      .run(taskId, req.user.id, content);

    const comment = db
      .prepare(
        `SELECT tc.*, u.name AS author_name, u.username AS author_username, u.avatar_color AS author_color
         FROM task_comments tc
         JOIN users u ON u.id = tc.user_id
         WHERE tc.id = ?`
      )
      .get(Number(insert.lastInsertRowid));

    io?.to(`project:${task.project_id}`).emit('comment:created', {
      projectId: task.project_id,
      taskId,
      comment
    });

    const recipientIds = new Set([task.assignee_id, task.creator_id].filter(Boolean));
    for (const uid of recipientIds) {
      createNotification(db, io, {
        userId: uid,
        actorId: req.user.id,
        projectId: task.project_id,
        taskId,
        message: `${req.user.name} commented on "${task.title}"`
      });
    }

    return res.status(201).json({ comment });
  });

  return router;
}

module.exports = { createTasksRouter };
