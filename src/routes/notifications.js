const express = require('express');
const { requireAuth } = require('../middleware/auth');

function createNotificationsRouter(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    const notifications = db
      .prepare(
        `SELECT n.*, u.name AS actor_name, u.username AS actor_username, u.avatar_color AS actor_avatar_color
         FROM notifications n
         JOIN users u ON u.id = n.actor_id
         WHERE n.user_id = ?
         ORDER BY n.id DESC
         LIMIT 40`
      )
      .all(req.user.id);

    const unread_count = notifications.filter((n) => !n.is_read).length;
    return res.json({ notifications, unread_count });
  });

  router.post('/read', (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    return res.json({ ok: true });
  });

  return router;
}

module.exports = { createNotificationsRouter };
