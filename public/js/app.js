(async () => {
  const TOKEN_KEY = 'taskflow_token';

  const state = {
    user: null,
    projects: [],
    allUsers: [],
    activeProjectId: null,
    board: null,
    notifications: [],
    activeTaskId: null,
    socket: null,
    filters: { q: '', assigneeId: '', priority: '' }
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function initials(name) {
    return (name || 'U')
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || '')
      .join('');
  }

  function showToast(msg, isError = false) {
    let wrap = document.getElementById('toast-container');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-container';
      wrap.className = 'toast-container';
      document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = `toast${isError ? ' error' : ''}`;
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  function openModal(id) {
    document.getElementById('modal-backdrop').classList.add('open');
    document.getElementById(id).classList.add('open');
  }

  function closeModals() {
    document.getElementById('modal-backdrop').classList.remove('open');
    document.querySelectorAll('.modal').forEach((m) => m.classList.remove('open'));
  }

  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || typeof io !== 'function') return;

    const socket = io({ auth: { token } });
    const statusPill = document.getElementById('ws-status');

    socket.on('connect', () => {
      statusPill.textContent = 'Live Sync Connected';
      statusPill.classList.remove('offline');
      if (state.activeProjectId) {
        socket.emit('project:join', state.activeProjectId);
      }
    });

    socket.on('disconnect', () => {
      statusPill.textContent = 'Reconnecting...';
      statusPill.classList.add('offline');
    });

    socket.on('task:created', ({ projectId, task }) => {
      if (projectId !== state.activeProjectId || !state.board) return;
      if (!state.board.tasks.some((t) => t.id === task.id)) {
        state.board.tasks.push(task);
        renderBoard();
      }
    });

    socket.on('task:updated', ({ projectId, task }) => {
      if (projectId !== state.activeProjectId || !state.board) return;
      const idx = state.board.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) state.board.tasks[idx] = task;
      else state.board.tasks.push(task);
      renderBoard();
    });

    socket.on('task:deleted', ({ projectId, taskId }) => {
      if (projectId !== state.activeProjectId || !state.board) return;
      state.board.tasks = state.board.tasks.filter((t) => t.id !== taskId);
      if (state.activeTaskId === taskId) closeModals();
      renderBoard();
    });

    socket.on('column:created', ({ projectId, column }) => {
      if (projectId !== state.activeProjectId || !state.board) return;
      if (!state.board.columns.some((c) => c.id === column.id)) {
        state.board.columns.push(column);
        renderBoard();
      }
    });

    socket.on('member:added', ({ projectId, member }) => {
      if (projectId !== state.activeProjectId || !state.board) return;
      if (!state.board.members.some((m) => m.id === member.id)) {
        state.board.members.push(member);
        renderProjectHeader();
      }
    });

    socket.on('comment:created', ({ projectId, taskId, comment }) => {
      if (projectId !== state.activeProjectId || !state.board) return;
      const task = state.board.tasks.find((t) => t.id === taskId);
      if (task) {
        task.comments_count = Number(task.comments_count || 0) + 1;
        renderBoard();
      }
      if (state.activeTaskId === taskId) {
        appendCommentToModal(comment);
      }
    });

    socket.on('notification:new', (notif) => {
      state.notifications.unshift(notif);
      renderNotifications();
      showToast(notif.message);
    });

    state.socket = socket;
  }

  function renderNotifications() {
    const list = document.getElementById('notifications-list');
    const unread = state.notifications.filter((n) => !n.is_read).length;
    document.getElementById('unread-count').textContent = String(unread);

    if (!state.notifications.length) {
      list.innerHTML = `<div style="font-size:0.8rem;color:#94a3b8;">No notifications yet.</div>`;
      return;
    }

    list.innerHTML = state.notifications
      .slice(0, 15)
      .map(
        (n) => `
      <div class="notif-item${n.is_read ? '' : ' unread'}">
        <div>${escapeHtml(n.message)}</div>
        <small style="color:#94a3b8;">${new Date(n.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
      </div>`
      )
      .join('');
  }

  function renderProjectsList() {
    const list = document.getElementById('project-list');
    if (!state.projects.length) {
      list.innerHTML = `<div style="font-size:0.82rem;color:#94a3b8;">Create a project to begin.</div>`;
      return;
    }
    list.innerHTML = state.projects
      .map(
        (p) => `
      <button type="button" class="project-btn${p.id === state.activeProjectId ? ' active' : ''}" data-select-project="${p.id}">
        <span class="project-dot" style="background:${escapeHtml(p.color)}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</span>
      </button>`
      )
      .join('');
  }

  function renderProjectHeader() {
    if (!state.board) return;
    document.getElementById('project-title').textContent = state.board.project.name;
    document.getElementById('project-desc').textContent = state.board.project.description || '';

    document.getElementById('member-avatars').innerHTML = state.board.members
      .map(
        (m) => `
      <div class="avatar" title="${escapeHtml(m.name)} (@${escapeHtml(m.username)})" style="background:${escapeHtml(m.avatar_color)}">
        ${escapeHtml(initials(m.name))}
      </div>`
      )
      .join('');

    const filterAssignee = document.getElementById('filter-assignee');
    const prev = filterAssignee.value;
    filterAssignee.innerHTML =
      `<option value="">All Assignees</option>` +
      state.board.members
        .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
        .join('');
    filterAssignee.value = prev;
  }

  function matchesFilters(task) {
    if (state.filters.q) {
      const q = state.filters.q.toLowerCase();
      const hay = `${task.title} ${task.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state.filters.assigneeId && String(task.assignee_id || '') !== state.filters.assigneeId) {
      return false;
    }
    if (state.filters.priority && task.priority !== state.filters.priority) {
      return false;
    }
    return true;
  }

  function renderBoard() {
    const boardEl = document.getElementById('kanban-board');
    if (!state.board) {
      boardEl.innerHTML = `<p style="color:var(--ink-muted);">Select or create a group project to see its Kanban board.</p>`;
      return;
    }

    const columns = state.board.columns;
    const tasks = state.board.tasks.filter(matchesFilters);

    boardEl.innerHTML = columns
      .map((col) => {
        const colTasks = tasks.filter((t) => t.column_id === col.id);
        return `
        <section class="column" data-column-id="${col.id}">
          <div class="column-head">
            <span>${escapeHtml(col.title)}</span>
            <span class="col-count">${colTasks.length}</span>
          </div>
          <div class="task-list" data-drop-col="${col.id}">
            ${colTasks
              .map(
                (t) => `
              <article class="task-card" draggable="true" data-task-id="${t.id}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">
                  <span class="priority-badge priority-${escapeHtml(t.priority)}">${escapeHtml(t.priority)}</span>
                  ${t.due_date ? `<small style="color:var(--ink-subtle);">Due ${escapeHtml(t.due_date)}</small>` : ''}
                </div>
                <h3 class="task-title">${escapeHtml(t.title)}</h3>
                <div class="task-foot">
                  <span>💬 ${t.comments_count || 0}</span>
                  ${
                    t.assignee_name
                      ? `<div style="display:flex;align-items:center;gap:0.35rem;">
                           <div class="avatar" style="width:22px;height:22px;font-size:0.65rem;background:${escapeHtml(t.assignee_color)}">${escapeHtml(initials(t.assignee_name))}</div>
                           <span>${escapeHtml(t.assignee_name.split(' ')[0])}</span>
                         </div>`
                      : `<span>Unassigned</span>`
                  }
                </div>
              </article>`
              )
              .join('')}
          </div>
          <button type="button" class="btn btn-outline btn-sm" data-quick-add-col="${col.id}">+ Add Card</button>
        </section>`;
      })
      .join('');
  }

  async function selectProject(projectId) {
    state.activeProjectId = projectId;
    renderProjectsList();
    state.board = await api(`/api/projects/${projectId}`);
    renderProjectHeader();
    renderBoard();
    if (state.socket?.connected) {
      state.socket.emit('project:join', projectId);
    }
  }

  async function loadWorkspace() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('workspace-screen').style.display = 'grid';

    document.getElementById('me-name').textContent = state.user.name;
    document.getElementById('me-role').textContent = state.user.role_title || 'Member';
    const meAvatar = document.getElementById('me-avatar');
    meAvatar.textContent = initials(state.user.name);
    meAvatar.style.background = state.user.avatar_color;

    const [{ projects }, { users }, { notifications }] = await Promise.all([
      api('/api/projects'),
      api('/api/auth/users'),
      api('/api/notifications')
    ]);

    state.projects = projects;
    state.allUsers = users;
    state.notifications = notifications;
    renderNotifications();
    renderProjectsList();

    connectSocket();

    if (projects.length) {
      await selectProject(projects[0].id);
    } else {
      state.board = null;
      renderBoard();
    }
  }

  function appendCommentToModal(comment) {
    const box = document.getElementById('task-comments-list');
    if (box.dataset.empty === 'true') {
      box.innerHTML = '';
      box.dataset.empty = 'false';
    }
    const existing = box.querySelector(`[data-comment-id="${comment.id}"]`);
    if (existing) return;
    const div = document.createElement('div');
    div.className = 'comment-item';
    div.dataset.commentId = String(comment.id);
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;">
        <strong>${escapeHtml(comment.author_name)}</strong>
        <small style="color:var(--ink-subtle);">${new Date(comment.created_at + 'Z').toLocaleString()}</small>
      </div>
      <div>${escapeHtml(comment.content)}</div>
    `;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  async function openTaskDetail(taskId) {
    const task = state.board?.tasks.find((t) => t.id === taskId);
    if (!task) return;
    state.activeTaskId = taskId;

    document.getElementById('et-title').value = task.title;
    document.getElementById('et-desc').value = task.description || '';
    document.getElementById('et-priority').value = task.priority;
    document.getElementById('et-due').value = task.due_date || '';

    const colSelect = document.getElementById('et-column');
    colSelect.innerHTML = state.board.columns
      .map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`)
      .join('');
    colSelect.value = String(task.column_id);

    const assigneeSelect = document.getElementById('et-assignee');
    assigneeSelect.innerHTML =
      `<option value="">Unassigned</option>` +
      state.board.members
        .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
        .join('');
    assigneeSelect.value = task.assignee_id ? String(task.assignee_id) : '';

    const { comments } = await api(`/api/tasks/${taskId}/comments`);
    const list = document.getElementById('task-comments-list');
    if (!comments.length) {
      list.innerHTML = `<div style="color:var(--ink-subtle);font-size:0.86rem;">No comments yet. Start collaborating below!</div>`;
      list.dataset.empty = 'true';
    } else {
      list.innerHTML = '';
      list.dataset.empty = 'false';
      comments.forEach(appendCommentToModal);
    }

    openModal('task-detail-modal');
  }

  // Auth switching
  let authMode = 'login';
  document.getElementById('auth-tab-login').addEventListener('click', () => {
    authMode = 'login';
    document.getElementById('auth-tab-login').className = 'btn btn-primary btn-sm';
    document.getElementById('auth-tab-register').className = 'btn btn-outline btn-sm';
    ['auth-name', 'auth-username', 'auth-role'].forEach((id) => {
      document.getElementById(id).style.display = 'none';
      document.getElementById(id).required = false;
    });
    document.getElementById('auth-submit').textContent = 'Sign In';
  });

  document.getElementById('auth-tab-register').addEventListener('click', () => {
    authMode = 'register';
    document.getElementById('auth-tab-register').className = 'btn btn-primary btn-sm';
    document.getElementById('auth-tab-login').className = 'btn btn-outline btn-sm';
    ['auth-name', 'auth-username', 'auth-role'].forEach((id) => {
      document.getElementById(id).style.display = 'block';
    });
    document.getElementById('auth-name').required = true;
    document.getElementById('auth-username').required = true;
    document.getElementById('auth-submit').textContent = 'Create Workspace Account';
  });

  document.getElementById('demo-login-btn').addEventListener('click', () => {
    document.getElementById('auth-tab-login').click();
    document.getElementById('auth-email').value = 'alex@taskflow.dev';
    document.getElementById('auth-password').value = 'DemoPass123!';
  });

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('auth-error');
    errEl.style.display = 'none';
    try {
      const data =
        authMode === 'register'
          ? await api('/api/auth/register', {
              method: 'POST',
              body: {
                name: document.getElementById('auth-name').value.trim(),
                username: document.getElementById('auth-username').value.trim(),
                role_title: document.getElementById('auth-role').value.trim(),
                email: document.getElementById('auth-email').value.trim(),
                password: document.getElementById('auth-password').value
              }
            })
          : await api('/api/auth/login', {
              method: 'POST',
              body: {
                identifier: document.getElementById('auth-email').value.trim(),
                password: document.getElementById('auth-password').value
              }
            });
      localStorage.setItem(TOKEN_KEY, data.token);
      state.user = data.user;
      await loadWorkspace();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    if (state.socket) state.socket.disconnect();
    state.user = null;
    document.getElementById('workspace-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'grid';
  });

  // Modals & Board Event Handlers
  document.getElementById('modal-backdrop').addEventListener('click', closeModals);
  document.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', closeModals));

  document.getElementById('project-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-select-project]');
    if (btn) selectProject(Number(btn.dataset.selectProject));
  });

  document.getElementById('mark-read-btn').addEventListener('click', async () => {
    await api('/api/notifications/read', { method: 'POST' });
    state.notifications.forEach((n) => (n.is_read = 1));
    renderNotifications();
  });

  document.getElementById('new-project-btn').addEventListener('click', () => {
    const picker = document.getElementById('proj-members-picker');
    picker.innerHTML = state.allUsers
      .filter((u) => u.id !== state.user.id)
      .map(
        (u) => `
      <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.88rem;">
        <input type="checkbox" value="${escapeHtml(u.username)}" />
        <span>${escapeHtml(u.name)} (@${escapeHtml(u.username)})</span>
      </label>`
      )
      .join('');
    openModal('project-modal');
  });

  document.getElementById('project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const members = Array.from(document.querySelectorAll('#proj-members-picker input:checked')).map(
      (cb) => cb.value
    );
    try {
      const { project } = await api('/api/projects', {
        method: 'POST',
        body: {
          name: document.getElementById('proj-name').value.trim(),
          description: document.getElementById('proj-desc').value.trim(),
          color: document.getElementById('proj-color').value,
          members
        }
      });
      document.getElementById('project-form').reset();
      closeModals();
      const { projects } = await api('/api/projects');
      state.projects = projects;
      await selectProject(project.id);
      showToast(`Project "${project.name}" created!`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('invite-member-btn').addEventListener('click', () => {
    if (!state.board) return;
    const memberIds = new Set(state.board.members.map((m) => m.id));
    const available = state.allUsers.filter((u) => !memberIds.has(u.id));
    document.getElementById('invite-suggestions').innerHTML = available
      .map(
        (u) =>
          `<button type="button" class="btn btn-outline btn-sm" data-pick-invite="${escapeHtml(u.username)}">+ @${escapeHtml(u.username)}</button>`
      )
      .join('');
    openModal('invite-modal');
  });

  document.getElementById('invite-suggestions').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-invite]');
    if (btn) document.getElementById('invite-identifier').value = btn.dataset.pickInvite;
  });

  document.getElementById('invite-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { member } = await api(`/api/projects/${state.activeProjectId}/members`, {
        method: 'POST',
        body: { identifier: document.getElementById('invite-identifier').value.trim() }
      });
      if (!state.board.members.some((m) => m.id === member.id)) {
        state.board.members.push(member);
      }
      renderProjectHeader();
      document.getElementById('invite-form').reset();
      closeModals();
      showToast(`${member.name} added to project!`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('add-column-btn').addEventListener('click', () => {
    if (state.board) openModal('column-modal');
  });

  document.getElementById('column-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { column } = await api(`/api/projects/${state.activeProjectId}/columns`, {
        method: 'POST',
        body: { title: document.getElementById('col-title').value.trim() }
      });
      if (!state.board.columns.some((c) => c.id === column.id)) {
        state.board.columns.push(column);
      }
      renderBoard();
      document.getElementById('column-form').reset();
      closeModals();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  function openCreateTaskModal(defaultColId = null) {
    if (!state.board) return;
    const colSelect = document.getElementById('ct-column');
    colSelect.innerHTML = state.board.columns
      .map((c) => `<option value="${c.id}">${escapeHtml(c.title)}</option>`)
      .join('');
    if (defaultColId) colSelect.value = String(defaultColId);

    const assigneeSelect = document.getElementById('ct-assignee');
    assigneeSelect.innerHTML =
      `<option value="">Unassigned</option>` +
      state.board.members.map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
    openModal('create-task-modal');
  }

  document.getElementById('new-task-btn').addEventListener('click', () => openCreateTaskModal());

  document.getElementById('create-task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { task } = await api(`/api/projects/${state.activeProjectId}/tasks`, {
        method: 'POST',
        body: {
          title: document.getElementById('ct-title').value.trim(),
          description: document.getElementById('ct-desc').value.trim(),
          column_id: Number(document.getElementById('ct-column').value),
          priority: document.getElementById('ct-priority').value,
          assignee_id: document.getElementById('ct-assignee').value
            ? Number(document.getElementById('ct-assignee').value)
            : null,
          due_date: document.getElementById('ct-due').value || null
        }
      });
      if (!state.board.tasks.some((t) => t.id === task.id)) {
        state.board.tasks.push(task);
      }
      renderBoard();
      document.getElementById('create-task-form').reset();
      closeModals();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('edit-task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { task } = await api(`/api/tasks/${state.activeTaskId}`, {
        method: 'PATCH',
        body: {
          title: document.getElementById('et-title').value.trim(),
          description: document.getElementById('et-desc').value.trim(),
          column_id: Number(document.getElementById('et-column').value),
          assignee_id: document.getElementById('et-assignee').value
            ? Number(document.getElementById('et-assignee').value)
            : null,
          priority: document.getElementById('et-priority').value,
          due_date: document.getElementById('et-due').value || null
        }
      });
      const idx = state.board.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) state.board.tasks[idx] = task;
      renderBoard();
      closeModals();
      showToast('Task updated');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('delete-task-btn').addEventListener('click', async () => {
    try {
      await api(`/api/tasks/${state.activeTaskId}`, { method: 'DELETE' });
      state.board.tasks = state.board.tasks.filter((t) => t.id !== state.activeTaskId);
      renderBoard();
      closeModals();
      showToast('Task deleted');
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('task-comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('task-comment-input');
    const content = input.value.trim();
    if (!content) return;
    try {
      const { comment } = await api(`/api/tasks/${state.activeTaskId}/comments`, {
        method: 'POST',
        body: { content }
      });
      input.value = '';
      appendCommentToModal(comment);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Filters
  document.getElementById('task-search').addEventListener('input', (e) => {
    state.filters.q = e.target.value.trim();
    renderBoard();
  });
  document.getElementById('filter-assignee').addEventListener('change', (e) => {
    state.filters.assigneeId = e.target.value;
    renderBoard();
  });
  document.getElementById('filter-priority').addEventListener('change', (e) => {
    state.filters.priority = e.target.value;
    renderBoard();
  });

  // Kanban Drag & Drop + Card Click
  let draggedTaskId = null;
  const boardEl = document.getElementById('kanban-board');

  boardEl.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task-card');
    if (!card) return;
    draggedTaskId = Number(card.dataset.taskId);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  boardEl.addEventListener('dragend', (e) => {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
    boardEl.querySelectorAll('.column').forEach((c) => c.classList.remove('drag-over'));
  });

  boardEl.addEventListener('dragover', (e) => {
    const col = e.target.closest('.column');
    if (!col) return;
    e.preventDefault();
    col.classList.add('drag-over');
  });

  boardEl.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.column');
    if (col && !col.contains(e.relatedTarget)) {
      col.classList.remove('drag-over');
    }
  });

  boardEl.addEventListener('drop', async (e) => {
    const col = e.target.closest('.column');
    if (!col || !draggedTaskId) return;
    e.preventDefault();
    col.classList.remove('drag-over');
    const targetColId = Number(col.dataset.columnId);
    const taskId = draggedTaskId;
    draggedTaskId = null;

    const task = state.board?.tasks.find((t) => t.id === taskId);
    if (!task || task.column_id === targetColId) return;

    task.column_id = targetColId;
    renderBoard();
    try {
      await api(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: { column_id: targetColId }
      });
    } catch (err) {
      showToast(err.message, true);
      await selectProject(state.activeProjectId);
    }
  });

  boardEl.addEventListener('click', (e) => {
    const quickAdd = e.target.closest('[data-quick-add-col]');
    if (quickAdd) {
      openCreateTaskModal(Number(quickAdd.dataset.quickAddCol));
      return;
    }
    const card = e.target.closest('.task-card');
    if (card) {
      openTaskDetail(Number(card.dataset.taskId));
    }
  });

  // Boot check existing token
  const existingToken = localStorage.getItem(TOKEN_KEY);
  if (existingToken) {
    try {
      const { user } = await api('/api/auth/me');
      state.user = user;
      await loadWorkspace();
    } catch {
      localStorage.removeItem(TOKEN_KEY);
    }
  }
})();
