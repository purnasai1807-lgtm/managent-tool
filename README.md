# TaskFlow — Collaborative Project Management Tool

A Trello/Asana-inspired collaborative project management application built with **HTML, CSS, JavaScript**, **Express.js (Node.js)**, **Socket.IO**, and **SQLite** (`node:sqlite`).

## Features

- **User Authentication & Workspace**: Account registration, sign-in, and JWT authentication (`bcryptjs` + `jsonwebtoken`).
- **Group Projects & Team Invitations**: Create shared project boards, choose custom accent colors, and invite collaborators by username or email.
- **Interactive Kanban Boards**: Drag-and-drop task cards across customizable columns (`Backlog`, `To Do`, `In Progress`, `Review`, `Done`, plus custom columns).
- **Task Assignment & Filtering**: Assign teammates to cards, set priorities (`low`, `medium`, `high`, `urgent`) and due dates, and filter boards by assignee, priority, or search text.
- **Task Comments & Communication**: Discuss tasks directly inside each card's detail modal.
- **Real-Time WebSocket Updates & Notifications (Bonus)**: Instant synchronization across connected browsers via **Socket.IO** rooms for card moves, creations, comments, member invites, and live notifications.

## Quick Start

> Requires **Node.js >= 22.5.0**.

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3003`.

### Demo Account

- **Email / Username**: `alex@taskflow.dev` (or `alex`)
- **Password**: `DemoPass123!`

## Running Tests

Includes end-to-end HTTP + Socket.IO WebSocket synchronization tests:

```bash
npm test
```
