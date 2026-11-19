const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../src/app');

function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-test-'));
  const dbPath = path.join(tmpDir, 'pm.db');
  const { server, db, io } = createApp({ dbPath });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            io.close();
            server.close(() => {
              db.close();
              fs.rmSync(tmpDir, { recursive: true, force: true });
              done();
            });
          })
      });
    });
  });
}

async function req(baseUrl, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Project Management Tool: projects, assignments, comments, and real-time WebSocket notifications', async () => {
  const srv = await startTestServer();
  let sock1;
  let sock2;

  try {
    const u1 = await req(srv.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Dana White', username: 'dana_w', email: 'dana@test.dev', password: 'Password123!' }
    });
    assert.equal(u1.status, 201);

    const u2 = await req(srv.baseUrl, '/api/auth/register', {
      method: 'POST',
      body: { name: 'Leo Chen', username: 'leo_c', email: 'leo@test.dev', password: 'Password123!' }
    });
    assert.equal(u2.status, 201);

    // Connect Socket.IO clients for both users
    sock1 = ioClient(srv.baseUrl, { auth: { token: u1.data.token } });
    sock2 = ioClient(srv.baseUrl, { auth: { token: u2.data.token } });

    await Promise.all([
      new Promise((r) => sock1.on('connect', r)),
      new Promise((r) => sock2.on('connect', r))
    ]);

    const notifPromise = new Promise((resolve) => {
      sock2.once('notification:new', resolve);
    });

    // User 1 creates a group project inviting user 2
    const projRes = await req(srv.baseUrl, '/api/projects', {
      method: 'POST',
      token: u1.data.token,
      body: {
        name: 'Q1 Engineering Sprint',
        description: 'Core architecture milestones',
        members: ['leo_c']
      }
    });
    assert.equal(projRes.status, 201);
    const projectId = projRes.data.project.id;

    // User 2 gets real-time invitation notification
    const inviteNotif = await notifPromise;
    assert.ok(inviteNotif.message.includes('Q1 Engineering Sprint'));

    // Both join project room
    sock1.emit('project:join', projectId);
    sock2.emit('project:join', projectId);
    await new Promise((r) => setTimeout(r, 80));

    // Fetch board columns
    const boardRes = await req(srv.baseUrl, `/api/projects/${projectId}`, { token: u1.data.token });
    assert.equal(boardRes.status, 200);
    assert.equal(boardRes.data.columns.length, 5);
    assert.equal(boardRes.data.members.length, 2);

    const todoCol = boardRes.data.columns[1];
    const doneCol = boardRes.data.columns[4];

    // Listen for real-time task:created on sock2
    const taskCreatedPromise = new Promise((resolve) => {
      sock2.once('task:created', resolve);
    });

    const createTaskRes = await req(srv.baseUrl, `/api/projects/${projectId}/tasks`, {
      method: 'POST',
      token: u1.data.token,
      body: {
        title: 'Build WebSocket event bus',
        description: 'Deliver instant Kanban card sync',
        column_id: todoCol.id,
        priority: 'high',
        assignee_id: u2.data.user.id
      }
    });
    assert.equal(createTaskRes.status, 201);

    const wsCreated = await taskCreatedPromise;
    assert.equal(wsCreated.task.title, 'Build WebSocket event bus');

    // Move task across column & verify update broadcast
    const taskMovedPromise = new Promise((resolve) => {
      sock1.once('task:updated', resolve);
    });
    const moveRes = await req(srv.baseUrl, `/api/tasks/${createTaskRes.data.task.id}`, {
      method: 'PATCH',
      token: u2.data.token,
      body: { column_id: doneCol.id }
    });
    assert.equal(moveRes.status, 200);
    const wsMoved = await taskMovedPromise;
    assert.equal(wsMoved.task.column_id, doneCol.id);

    // Comment inside task & verify real-time comment broadcast
    const commentPromise = new Promise((resolve) => {
      sock1.once('comment:created', resolve);
    });
    const cmtRes = await req(srv.baseUrl, `/api/tasks/${createTaskRes.data.task.id}/comments`, {
      method: 'POST',
      token: u2.data.token,
      body: { content: 'Moved card to Done after verifying latency!' }
    });
    assert.equal(cmtRes.status, 201);
    const wsComment = await commentPromise;
    assert.equal(wsComment.comment.content, 'Moved card to Done after verifying latency!');
  } finally {
    sock1?.disconnect();
    sock2?.disconnect();
    await srv.close();
  }
});
