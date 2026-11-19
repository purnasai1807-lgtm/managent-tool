function createNotification(db, io, { userId, actorId, projectId = null, taskId = null, message }) {
  if (!userId || userId === actorId) return null;

  const insert = db
    .prepare(
      'INSERT INTO notifications (user_id, actor_id, project_id, task_id, message) VALUES (?, ?, ?, ?, ?)'
    )
    .run(userId, actorId, projectId, taskId, message);

  const notification = db
    .prepare(
      `SELECT n.*, u.name AS actor_name, u.username AS actor_username, u.avatar_color AS actor_avatar_color
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       WHERE n.id = ?`
    )
    .get(Number(insert.lastInsertRowid));

  if (io && notification) {
    io.to(`user:${userId}`).emit('notification:new', notification);
  }
  return notification;
}

module.exports = { createNotification };
