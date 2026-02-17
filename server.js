/**
 * Reminders App - Server
 * 
 * A fast, elegant reminders system with folders and sub-tasks.
 * Uses in-memory storage for speed (data persists during session).
 * 
 * @author Inacio Bo
 * @license MIT
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// ============================================================================
// Data Store
// ============================================================================

/** @type {Map<string, Folder>} */
const folders = new Map();

/** @type {Map<string, Reminder>} */
const reminders = new Map();

// Create default folder
folders.set('inbox', {
  id: 'inbox',
  name: 'Inbox',
  color: '#007AFF',
  icon: '📥',
  createdAt: Date.now()
});

// ============================================================================
// API Routes - Folders
// ============================================================================

/** GET /api/folders - List all folders */
app.get('/api/folders', (req, res) => {
  const list = Array.from(folders.values()).sort((a, b) => a.createdAt - b.createdAt);
  res.json(list);
});

/** POST /api/folders - Create new folder */
app.post('/api/folders', (req, res) => {
  const { name, color = '#007AFF', icon = '📁' } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Folder name required' });
  }
  
  const id = uuidv4().slice(0, 8);
  const folder = {
    id,
    name: name.trim(),
    color,
    icon,
    createdAt: Date.now()
  };
  
  folders.set(id, folder);
  res.json(folder);
});

/** DELETE /api/folders/:id - Delete folder (move reminders to inbox) */
app.delete('/api/folders/:id', (req, res) => {
  const { id } = req.params;
  
  if (id === 'inbox') {
    return res.status(400).json({ error: 'Cannot delete inbox' });
  }
  
  // Move reminders to inbox
  reminders.forEach(r => {
    if (r.folderId === id) {
      r.folderId = 'inbox';
    }
  });
  
  folders.delete(id);
  res.json({ success: true });
});

// ============================================================================
// API Routes - Reminders
// ============================================================================

/** GET /api/reminders - List reminders (optionally filtered by folder) */
app.get('/api/reminders', (req, res) => {
  const { folder, completed } = req.query;
  let list = Array.from(reminders.values());
  
  if (folder) {
    list = list.filter(r => r.folderId === folder);
  }
  
  if (completed !== undefined) {
    const isCompleted = completed === 'true';
    list = list.filter(r => r.completed === isCompleted);
  }
  
  // Sort: incomplete first, then by due date, then by creation date
  list.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt - a.createdAt;
  });
  
  res.json(list);
});

/** GET /api/reminders/today - Get today's reminders */
app.get('/api/reminders/today', (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const list = Array.from(reminders.values()).filter(r => {
    if (r.completed) return false;
    if (!r.dueDate) return false;
    const due = new Date(r.dueDate);
    return due >= today && due < tomorrow;
  });
  
  list.sort((a, b) => a.dueDate - b.dueDate);
  res.json(list);
});

/** GET /api/reminders/:id - Get single reminder */
app.get('/api/reminders/:id', (req, res) => {
  const reminder = reminders.get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  res.json(reminder);
});

/** POST /api/reminders - Create new reminder */
app.post('/api/reminders', (req, res) => {
  const { 
    title, 
    notes = '', 
    folderId = 'inbox',
    dueDate = null,
    priority = 'normal', // low, normal, high
    subtasks = []
  } = req.body;
  
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title required' });
  }
  
  const id = uuidv4().slice(0, 8);
  const reminder = {
    id,
    title: title.trim(),
    notes: notes.trim(),
    folderId,
    completed: false,
    dueDate: dueDate ? new Date(dueDate).getTime() : null,
    priority,
    subtasks: subtasks.map((st, i) => ({
      id: `${id}-sub-${i}`,
      title: st.title || st,
      completed: st.completed || false
    })),
    createdAt: Date.now(),
    completedAt: null
  };
  
  reminders.set(id, reminder);
  res.json(reminder);
});

/** PATCH /api/reminders/:id - Update reminder */
app.patch('/api/reminders/:id', (req, res) => {
  const reminder = reminders.get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  
  const { title, notes, folderId, dueDate, priority, completed } = req.body;
  
  if (title !== undefined) reminder.title = title.trim();
  if (notes !== undefined) reminder.notes = notes.trim();
  if (folderId !== undefined) reminder.folderId = folderId;
  if (dueDate !== undefined) reminder.dueDate = dueDate ? new Date(dueDate).getTime() : null;
  if (priority !== undefined) reminder.priority = priority;
  
  if (completed !== undefined && completed !== reminder.completed) {
    reminder.completed = completed;
    reminder.completedAt = completed ? Date.now() : null;
  }
  
  res.json(reminder);
});

/** DELETE /api/reminders/:id - Delete reminder */
app.delete('/api/reminders/:id', (req, res) => {
  reminders.delete(req.params.id);
  res.json({ success: true });
});

// ============================================================================
// API Routes - Subtasks
// ============================================================================

/** POST /api/reminders/:id/subtasks - Add subtask */
app.post('/api/reminders/:id/subtasks', (req, res) => {
  const reminder = reminders.get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  
  const { title } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title required' });
  }
  
  const subtask = {
    id: `${reminder.id}-sub-${reminder.subtasks.length}`,
    title: title.trim(),
    completed: false
  };
  
  reminder.subtasks.push(subtask);
  res.json(subtask);
});

/** PATCH /api/reminders/:id/subtasks/:subId - Update subtask */
app.patch('/api/reminders/:id/subtasks/:subId', (req, res) => {
  const reminder = reminders.get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  
  const subtask = reminder.subtasks.find(st => st.id === req.params.subId);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });
  
  const { title, completed } = req.body;
  if (title !== undefined) subtask.title = title.trim();
  if (completed !== undefined) subtask.completed = completed;
  
  // Auto-complete parent if all subtasks done
  if (reminder.subtasks.length > 0 && reminder.subtasks.every(st => st.completed)) {
    reminder.completed = true;
    reminder.completedAt = Date.now();
  }
  
  res.json(subtask);
});

/** DELETE /api/reminders/:id/subtasks/:subId - Delete subtask */
app.delete('/api/reminders/:id/subtasks/:subId', (req, res) => {
  const reminder = reminders.get(req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  
  reminder.subtasks = reminder.subtasks.filter(st => st.id !== req.params.subId);
  res.json({ success: true });
});

// ============================================================================
// HTML Routes
// ============================================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Reminders app on port ${PORT}`);
});

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} icon
 * @property {number} createdAt
 */

/**
 * @typedef {Object} Subtask
 * @property {string} id
 * @property {string} title
 * @property {boolean} completed
 */

/**
 * @typedef {Object} Reminder
 * @property {string} id
 * @property {string} title
 * @property {string} notes
 * @property {string} folderId
 * @property {boolean} completed
 * @property {number|null} dueDate
 * @property {string} priority
 * @property {Subtask[]} subtasks
 * @property {number} createdAt
 * @property {number|null} completedAt
 */
