const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

function createDatabase(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'pm.db');
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(resolvedPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (resolvedPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role_title TEXT NOT NULL DEFAULT 'Team Member',
      avatar_color TEXT NOT NULL DEFAULT '#2563eb',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#2563eb',
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      due_date TEXT,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project_col ON tasks(project_id, column_id, position);
    CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id, id ASC);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, id DESC);
  `);

  seedInitialData(db);
  return db;
}

function seedInitialData(db) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const hash = bcrypt.hashSync('DemoPass123!', 10);
  const insertUser = db.prepare(
    'INSERT INTO users (name, username, email, password_hash, role_title, avatar_color) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const alexId = Number(insertUser.run('Alex Rivera', 'alex', 'alex@taskflow.dev', hash, 'Tech Lead', '#2563eb').lastInsertRowid);
  const mayaId = Number(insertUser.run('Maya Lin', 'maya', 'maya@taskflow.dev', hash, 'Product Designer', '#db2777').lastInsertRowid);
  const liamId = Number(insertUser.run('Liam OConnor', 'liam', 'liam@taskflow.dev', hash, 'Backend Engineer', '#059669').lastInsertRowid);
  const priyaId = Number(insertUser.run('Priya Nair', 'priya', 'priya@taskflow.dev', hash, 'QA Engineer', '#7c3aed').lastInsertRowid);

  const insertProject = db.prepare(
    'INSERT INTO projects (name, description, color, owner_id) VALUES (?, ?, ?, ?)'
  );
  const proj1 = Number(
    insertProject.run(
      'Platform Launch v2',
      'Cross-functional sprint board for Q4 product release, UI polish, and API hardening.',
      '#2563eb',
      alexId
    ).lastInsertRowid
  );
  const proj2 = Number(
    insertProject.run(
      'Mobile Onboarding Revamp',
      'Streamlining signup, social auth, and push notification pipelines.',
      '#7c3aed',
      mayaId
    ).lastInsertRowid
  );

  const insertMember = db.prepare(
    'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
  );
  insertMember.run(proj1, alexId, 'owner');
  insertMember.run(proj1, mayaId, 'member');
  insertMember.run(proj1, liamId, 'member');
  insertMember.run(proj1, priyaId, 'member');

  insertMember.run(proj2, mayaId, 'owner');
  insertMember.run(proj2, alexId, 'member');
  insertMember.run(proj2, liamId, 'member');

  const insertCol = db.prepare('INSERT INTO columns (project_id, title, position) VALUES (?, ?, ?)');
  const cBacklog = Number(insertCol.run(proj1, 'Backlog', 0).lastInsertRowid);
  const cTodo = Number(insertCol.run(proj1, 'To Do', 1).lastInsertRowid);
  const cProg = Number(insertCol.run(proj1, 'In Progress', 2).lastInsertRowid);
  const cReview = Number(insertCol.run(proj1, 'Review', 3).lastInsertRowid);
  const cDone = Number(insertCol.run(proj1, 'Done', 4).lastInsertRowid);

  const c2Todo = Number(insertCol.run(proj2, 'To Do', 0).lastInsertRowid);
  const c2Prog = Number(insertCol.run(proj2, 'In Progress', 1).lastInsertRowid);
  const c2Done = Number(insertCol.run(proj2, 'Done', 2).lastInsertRowid);

  const insertTask = db.prepare(`
    INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, assignee_id, creator_id, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const t1 = Number(
    insertTask.run(
      proj1,
      cProg,
      'Implement WebSocket board synchronization',
      'Broadcast task moves, assignments, and comments to active project members via Socket.IO rooms.',
      'high',
      '2026-11-28',
      alexId,
      alexId,
      0
    ).lastInsertRowid
  );
  const t2 = Number(
    insertTask.run(
      proj1,
      cTodo,
      'Design Kanban card priority & due-date badges',
      'Ensure high contrast in light workspace theme and responsive wrapping on narrow columns.',
      'medium',
      '2026-11-25',
      mayaId,
      alexId,
      0
    ).lastInsertRowid
  );
  insertTask.run(
    proj1,
    cReview,
    'Add role checks for project member invites',
    'Verify invited collaborators exist and prevent duplicate memberships cleanly.',
    'urgent',
    '2026-11-22',
    liamId,
    alexId,
    0
  );
  insertTask.run(
    proj1,
    cBacklog,
    'Export sprint summary CSV report',
    'Allow project owners to export completed cards and cycle times.',
    'low',
    null,
    priyaId,
    mayaId,
    0
  );
  insertTask.run(
    proj1,
    cDone,
    'Set up SQLite WAL schema & foreign keys',
    'Ensure cascading cleanup on project deletion and indexed queries.',
    'high',
    '2026-11-18',
    liamId,
    alexId,
    0
  );

  insertTask.run(
    proj2,
    c2Todo,
    'Prototype 2-step welcome carousel',
    'Reduce onboarding friction with skip option and interactive preview.',
    'medium',
    '2026-12-01',
    mayaId,
    mayaId,
    0
  );
  insertTask.run(
    proj2,
    c2Prog,
    'Benchmark JWT refresh latency',
    'Verify cold-start token verification stays under 5ms.',
    'high',
    '2026-11-26',
    alexId,
    mayaId,
    0
  );
  insertTask.run(
    proj2,
    c2Done,
    'Audit contrast on primary action buttons',
    'WCAG AA compliance verified across desktop and tablet.',
    'low',
    '2026-11-15',
    mayaId,
    mayaId,
    0
  );

  const insertComment = db.prepare(
    'INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)'
  );
  insertComment.run(t1, liamId, 'Room authorization middleware is hooked up and checking membership on join.');
  insertComment.run(t1, mayaId, 'Nice! Tested dragging across two windows and the card moved instantaneously.');
  insertComment.run(t2, alexId, 'Looks super clean — let us use amber for high and rose for urgent.');
}

module.exports = { createDatabase };
