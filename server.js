/**
 * Reminders App - Server
 * 
 * A fast, elegant reminders system with folders and sub-tasks.
 * Uses JSON file for persistent storage.
 * 
 * @author Inacio Bo
 * @license MIT
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Data file path
const DATA_FILE = '/data/reminders.json';

// In-memory storage
let folders = new Map();
let reminders = new Map();

// Load data from file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      folders = new Map(data.folders || []);
      reminders = new Map(data.reminders || []);
      console.log('Data loaded from file');
    }
  } catch (err) {
    console.error('Error loading data:', err);
  }
  
  // Create default inbox if not exists
  if (!folders.has('inbox')) {
    folders.set('inbox', {
      id: 'inbox',
      name: 'Inbox',
      color: '#007AFF',
      icon: '📥',
      createdAt: Date.now()
    });
    saveData();
  }
}

// Save data to file
function saveData() {
  try {
    const data = {
      folders: Array.from(folders.entries()),
      reminders: Array.from(reminders.entries())
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// Load initial data
loadData();

// Auto-save every 30 seconds
setInterval(saveData, 30000);

// Middleware
app.use(express.json());
app.use(express.static('public'));

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
  saveData();
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
  saveData();
  res.json({ success: true });
});

// ============================================================================
// API Routes - Reminders
// ============================================================================

/** GET /api/reminders - List reminders */
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
  
  // Sort
  list.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.priority !== b.priority) {
      const p = { high: 0, normal: 1, low: 2 };
      return p[a.priority] - p[b.priority];
    }
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
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

/** POST /api/reminders - Create new reminder */
app.post('/api/reminders', (req, res) => {
  const { 
    title, 
    notes = '', 
    folderId = 'inbox',
    dueDate = null,
    priority = 'normal',
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
      title: st.title ? st.title.trim() : '',
      completed: st.completed || false
    })).filter(st => st.title),
    createdAt: Date.now(),
    completedAt: null
  };
  
  reminders.set(id, reminder);
  saveData();
  res.json(reminder);
});

/** PATCH /api/reminders/:id - Update reminder */
app.patch('/api/reminders/:id', (req, res) => {
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  
  const { title, notes, folderId, dueDate, priority, completed, subtasks } = req.body;
  
  if (title !== undefined) r.title = title.trim();
  if (notes !== undefined) r.notes = notes.trim();
  if (folderId !== undefined) r.folderId = folderId;
  if (dueDate !== undefined) r.dueDate = dueDate ? new Date(dueDate).getTime() : null;
  if (priority !== undefined) r.priority = priority;
  
  if (completed !== undefined && completed !== r.completed) {
    r.completed = completed;
    r.completedAt = completed ? Date.now() : null;
  }
  
  if (subtasks !== undefined) {
    r.subtasks = subtasks.map((st, i) => ({
      id: st.id || `${req.params.id}-sub-${i}`,
      title: st.title ? st.title.trim() : '',
      completed: st.completed || false
    })).filter(st => st.title);
  }
  
  saveData();
  res.json(r);
});

/** DELETE /api/reminders/:id - Delete reminder */
app.delete('/api/reminders/:id', (req, res) => {
  reminders.delete(req.params.id);
  saveData();
  res.json({ success: true });
});

// ============================================================================
// API Routes - Subtasks
// ============================================================================

/** POST /api/reminders/:id/subtasks - Add subtask */
app.post('/api/reminders/:id/subtasks', (req, res) => {
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  
  const { title } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title required' });
  }
  
  const subtask = {
    id: `${req.params.id}-sub-${r.subtasks.length}`,
    title: title.trim(),
    completed: false
  };
  
  r.subtasks.push(subtask);
  saveData();
  res.json(subtask);
});

/** PATCH /api/reminders/:id/subtasks/:subId - Update subtask */
app.patch('/api/reminders/:id/subtasks/:subId', (req, res) => {
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  
  const subtask = r.subtasks.find(st => st.id === req.params.subId);
  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });
  
  const { title, completed } = req.body;
  if (title !== undefined) subtask.title = title.trim();
  if (completed !== undefined) subtask.completed = completed;
  
  // Auto-complete parent if all subtasks done
  if (r.subtasks.length > 0 && r.subtasks.every(st => st.completed)) {
    r.completed = true;
    r.completedAt = Date.now();
  }
  
  saveData();
  res.json(subtask);
});

/** DELETE /api/reminders/:id/subtasks/:subId - Delete subtask */
app.delete('/api/reminders/:id/subtasks/:subId', (req, res) => {
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  
  r.subtasks = r.subtasks.filter(st => st.id !== req.params.subId);
  saveData();
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
