/**
 * Reminders App - Server (Enhanced)
 * 
 * A fast, elegant reminders system with folders, sub-tasks, tags, recurring reminders,
 * search, and smart lists.
 * 
 * @author Inacio Bo
 * @license MIT
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 8080;

// Auth config
const AUTH_SERVICE = process.env.AUTH_SERVICE || 'https://inacio-auth.fly.dev';
const COOKIE_NAME = 'auth_session';

// Data file path
const DATA_FILE = '/data/reminders.json';

// In-memory storage
let folders = new Map();
let reminders = new Map();
let tags = new Map(); // Track tag usage counts

// Recurring reminder intervals (in ms)
const RECURRING_INTERVALS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000
};

// Load data from file
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      folders = new Map(data.folders || []);
      reminders = new Map(data.reminders || []);
      tags = new Map(data.tags || []);
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
  
  // Create default smart folders if not exist
  createDefaultFolders();
}

// Create default folders
function createDefaultFolders() {
  const defaults = [
    { id: 'today', name: 'Today', color: '#FF3B30', icon: '📅', smart: true, filter: 'today' },
    { id: 'scheduled', name: 'Scheduled', color: '#FF9500', icon: '📆', smart: true, filter: 'scheduled' },
    { id: 'all', name: 'All', color: '#5856D6', icon: '📋', smart: true, filter: 'all' },
    { id: 'completed', name: 'Completed', color: '#34C759', icon: '✅', smart: true, filter: 'completed' }
  ];
  
  defaults.forEach(f => {
    if (!folders.has(f.id)) {
      folders.set(f.id, { ...f, createdAt: Date.now() });
    }
  });
}

// Save data to file with backup
function saveData() {
  try {
    const data = {
      folders: Array.from(folders.entries()),
      reminders: Array.from(reminders.entries()),
      tags: Array.from(tags.entries()),
      lastSaved: Date.now()
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    
    // Trigger async backup
    backupData();
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// Backup data to Dropbox
function backupData() {
  const { exec } = require('child_process');
  exec('./backup.sh', (error, stdout, stderr) => {
    if (error) {
      console.error('Backup error:', error);
    } else {
      console.log('Backup completed:', stdout.trim());
    }
  });
}

// Extract hashtags from text
function extractTags(text) {
  if (!text) return [];
  const matches = text.match(/#\w+/g);
  return matches ? matches.map(t => t.toLowerCase()) : [];
}

// Update tag counts
function updateTags() {
  tags.clear();
  reminders.forEach(r => {
    const text = `${r.title} ${r.notes || ''}`;
    const tagList = extractTags(text);
    tagList.forEach(tag => {
      tags.set(tag, (tags.get(tag) || 0) + 1);
    });
  });
}

// Process recurring reminders
function processRecurringReminders() {
  const now = Date.now();
  let updated = false;
  
  reminders.forEach(r => {
    if (r.recurring && r.completed && r.completedAt) {
      const interval = RECURRING_INTERVALS[r.recurring];
      if (interval && (now - r.completedAt) >= interval) {
        // Reset the reminder
        r.completed = false;
        r.completedAt = null;
        r.createdAt = now;
        if (r.dueDate) {
          // Move due date forward by the interval
          r.dueDate = r.dueDate + interval;
        }
        updated = true;
        console.log(`Reset recurring reminder: ${r.title}`);
      }
    }
  });
  
  if (updated) {
    saveData();
  }
}

// Load initial data
loadData();

// Auto-save every 30 seconds
setInterval(saveData, 30000);

// Process recurring reminders every hour
setInterval(processRecurringReminders, 60 * 60 * 1000);

// Update tags periodically
setInterval(updateTags, 5 * 60 * 1000);

// Middleware
app.use(express.json());
app.use(cookieParser());

// Auth middleware - verify with auth-service
async function requireAuth(req, res, next) {
  let token = req.query.token || req.cookies[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  
  if (req.query.token && !req.cookies[COOKIE_NAME]) {
    res.cookie(COOKIE_NAME, req.query.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    token = req.query.token;
  }
  
  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        loginUrl: `${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(`https://reminders-app.fly.dev${req.originalUrl}`)}`
      });
    }
    return res.redirect(`${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(`https://reminders-app.fly.dev${req.originalUrl}`)}`);
  }
  
  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(`${AUTH_SERVICE}/api/verify`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Cookie': `${COOKIE_NAME}=${token}`
      }
    });
    
    if (!response.ok) throw new Error('Invalid token');
    
    const data = await response.json();
    req.user = data.user;
    next();
  } catch (err) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        loginUrl: `${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(`https://reminders-app.fly.dev${req.originalUrl}`)}`
      });
    }
    return res.redirect(`${AUTH_SERVICE}/login?returnTo=${encodeURIComponent(`https://reminders-app.fly.dev${req.originalUrl}`)}`);
  }
}

// Health endpoint (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Debug endpoint to check auth status (no auth required)
app.get('/auth-debug', (req, res) => {
  res.json({
    hasToken: !!req.query.token,
    hasCookie: !!req.cookies[COOKIE_NAME],
    cookieValue: req.cookies[COOKIE_NAME] ? 'present' : 'missing'
  });
});

// ============================================================================
// Special endpoints for AI assistant (NO AUTH REQUIRED)
// ============================================================================

const API_SECRET = process.env.API_SECRET || 'assistant-secret-key';

// Create reminder
app.post('/api/external/reminder', (req, res) => {
  const { secret, title, notes = '', dueDate = null, priority = 'normal', recurring = null } = req.body;
  
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title required' });
  }
  
  const id = uuidv4().slice(0, 8);
  const reminder = {
    id,
    title: title.trim(),
    notes: notes.trim(),
    folderId: 'inbox',
    completed: false,
    dueDate: dueDate ? new Date(dueDate).getTime() : null,
    priority,
    recurring: recurring || null, // daily, weekly, monthly
    subtasks: [],
    createdAt: Date.now(),
    completedAt: null,
    source: 'assistant'
  };
  
  reminders.set(id, reminder);
  updateTags();
  saveData();
  
  res.json({ 
    success: true, 
    reminder,
    url: `https://reminders-app.fly.dev/`
  });
});

// List all reminders
app.get('/api/external/reminders', (req, res) => {
  const { secret, folder, completed, today, tag, search } = req.query;
  
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  let list = Array.from(reminders.values());
  
  // Filter by folder
  if (folder) {
    list = list.filter(r => r.folderId === folder);
  }
  
  // Filter by completed status
  if (completed !== undefined) {
    const isCompleted = completed === 'true';
    list = list.filter(r => r.completed === isCompleted);
  }
  
  // Filter for today
  if (today === 'true') {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    list = list.filter(r => {
      if (r.completed) return false;
      if (!r.dueDate) return false;
      const due = new Date(r.dueDate);
      return due >= now && due < tomorrow;
    });
  }
  
  // Filter by tag
  if (tag) {
    list = list.filter(r => {
      const text = `${r.title} ${r.notes || ''}`.toLowerCase();
      return text.includes(tag.toLowerCase());
    });
  }
  
  // Search
  if (search) {
    const query = search.toLowerCase();
    list = list.filter(r => {
      return r.title.toLowerCase().includes(query) || 
             (r.notes && r.notes.toLowerCase().includes(query));
    });
  }
  
  // Sort: incomplete first, then by priority, then by due date
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
  
  res.json({
    success: true,
    count: list.length,
    reminders: list,
    tags: Array.from(tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20)
  });
});

// Get stats
app.get('/api/external/stats', (req, res) => {
  const { secret } = req.query;
  
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  const all = Array.from(reminders.values());
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const stats = {
    total: all.length,
    completed: all.filter(r => r.completed).length,
    incomplete: all.filter(r => !r.completed).length,
    dueToday: all.filter(r => {
      if (r.completed || !r.dueDate) return false;
      const due = new Date(r.dueDate);
      return due >= now && due < tomorrow;
    }).length,
    overdue: all.filter(r => {
      if (r.completed || !r.dueDate) return false;
      const due = new Date(r.dueDate);
      return due < now;
    }).length,
    highPriority: all.filter(r => !r.completed && r.priority === 'high').length,
    withDueDate: all.filter(r => !r.completed && r.dueDate).length,
    tags: Array.from(tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
  };
  
  res.json({ success: true, stats });
});

// Bulk operations
app.post('/api/external/bulk', (req, res) => {
  const { secret, action, ids } = req.body;
  
  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Invalid secret' });
  }
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No IDs provided' });
  }
  
  let updated = 0;
  
  ids.forEach(id => {
    const r = reminders.get(id);
    if (!r) return;
    
    switch (action) {
      case 'complete':
        r.completed = true;
        r.completedAt = Date.now();
        updated++;
        break;
      case 'uncomplete':
        r.completed = false;
        r.completedAt = null;
        updated++;
        break;
      case 'delete':
        reminders.delete(id);
        updated++;
        break;
      case 'move':
        if (req.body.folderId) {
          r.folderId = req.body.folderId;
          updated++;
        }
        break;
    }
  });
  
  if (updated > 0) saveData();
  
  res.json({ success: true, updated });
});

// Apply auth to API routes only
app.use('/api', requireAuth);

// Serve static files without auth - the client-side app will handle auth
app.use(express.static('public'));

// ============================================================================
// API Routes - Folders
// ============================================================================

app.get('/api/folders', (req, res) => {
  const list = Array.from(folders.values()).sort((a, b) => a.createdAt - b.createdAt);
  res.json(list);
});

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

app.delete('/api/folders/:id', (req, res) => {
  const { id } = req.params;
  
  if (id === 'inbox') {
    return res.status(400).json({ error: 'Cannot delete inbox' });
  }
  
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

app.get('/api/reminders', (req, res) => {
  const { folder, completed, tag, search } = req.query;
  let list = Array.from(reminders.values());
  
  if (folder) {
    list = list.filter(r => r.folderId === folder);
  }
  
  if (completed !== undefined) {
    const isCompleted = completed === 'true';
    list = list.filter(r => r.completed === isCompleted);
  }
  
  if (tag) {
    list = list.filter(r => {
      const text = `${r.title} ${r.notes || ''}`.toLowerCase();
      return text.includes(tag.toLowerCase());
    });
  }
  
  if (search) {
    const query = search.toLowerCase();
    list = list.filter(r => {
      return r.title.toLowerCase().includes(query) || 
             (r.notes && r.notes.toLowerCase().includes(query));
    });
  }
  
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

app.get('/api/reminders/:id', (req, res) => {
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

app.post('/api/reminders', (req, res) => {
  const { title, notes = '', folderId = 'inbox', dueDate = null, priority = 'normal', recurring = null, subtasks = [] } = req.body;
  
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
    recurring: recurring || null,
    subtasks: subtasks.map((st, i) => ({
      id: `${id}-sub-${i}`,
      title: st.title ? st.title.trim() : '',
      completed: st.completed || false
    })).filter(st => st.title),
    createdAt: Date.now(),
    completedAt: null
  };
  
  reminders.set(id, reminder);
  updateTags();
  saveData();
  res.json(reminder);
});

app.patch('/api/reminders/:id', (req, res) => {
  const r = reminders.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  
  const { title, notes, folderId, dueDate, priority, completed, recurring, subtasks } = req.body;
  
  if (title !== undefined) r.title = title.trim();
  if (notes !== undefined) r.notes = notes.trim();
  if (folderId !== undefined) r.folderId = folderId;
  if (dueDate !== undefined) r.dueDate = dueDate ? new Date(dueDate).getTime() : null;
  if (priority !== undefined) r.priority = priority;
  if (recurring !== undefined) r.recurring = recurring;
  
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
  
  updateTags();
  saveData();
  res.json(r);
});

app.delete('/api/reminders/:id', (req, res) => {
  reminders.delete(req.params.id);
  updateTags();
  saveData();
  res.json({ success: true });
});

// ============================================================================
// API Routes - Bulk Operations
// ============================================================================

app.post('/api/bulk', (req, res) => {
  const { action, ids, folderId } = req.body;
  
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No IDs provided' });
  }
  
  let updated = 0;
  
  ids.forEach(id => {
    const r = reminders.get(id);
    if (!r) return;
    
    switch (action) {
      case 'complete':
        r.completed = true;
        r.completedAt = Date.now();
        updated++;
        break;
      case 'uncomplete':
        r.completed = false;
        r.completedAt = null;
        updated++;
        break;
      case 'delete':
        reminders.delete(id);
        updated++;
        break;
      case 'move':
        if (folderId) {
          r.folderId = folderId;
          updated++;
        }
        break;
    }
  });
  
  if (updated > 0) {
    updateTags();
    saveData();
  }
  
  res.json({ success: true, updated });
});

// ============================================================================
// API Routes - Tags
// ============================================================================

app.get('/api/tags', (req, res) => {
  updateTags();
  const list = Array.from(tags.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
  res.json(list);
});

// ============================================================================
// API Routes - Stats
// ============================================================================

app.get('/api/stats', (req, res) => {
  const all = Array.from(reminders.values());
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  updateTags();
  
  res.json({
    total: all.length,
    completed: all.filter(r => r.completed).length,
    incomplete: all.filter(r => !r.completed).length,
    dueToday: all.filter(r => {
      if (r.completed || !r.dueDate) return false;
      const due = new Date(r.dueDate);
      return due >= now && due < tomorrow;
    }).length,
    overdue: all.filter(r => {
      if (r.completed || !r.dueDate) return false;
      const due = new Date(r.dueDate);
      return due < now;
    }).length,
    highPriority: all.filter(r => !r.completed && r.priority === 'high').length,
    tags: Array.from(tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
  });
});

// ============================================================================
// Backup & Restore API (Owner only)
// ============================================================================

app.post('/api/backup', async (req, res) => {
  const { exec } = require('child_process');
  exec('./backup.sh', (error, stdout, stderr) => {
    if (error) {
      console.error('Backup error:', error);
      return res.status(500).json({ error: 'Backup failed', details: error.message });
    }
    res.json({ success: true, message: stdout.trim() });
  });
});

app.get('/api/backups', async (req, res) => {
  try {
    const { exec } = require('child_process');
    exec('ls -t /data/backups/reminders_*.json 2>/dev/null | head -20', (error, stdout) => {
      const files = stdout.trim().split('\n').filter(f => f).map(f => {
        const name = f.replace('/data/backups/', '');
        const date = name.replace('reminders_', '').replace('.json', '');
        return { name, date };
      });
      res.json({ success: true, backups: files });
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

app.post('/api/restore', async (req, res) => {
  const { backupFile } = req.body;
  if (!backupFile) {
    return res.status(400).json({ error: 'Backup file required' });
  }
  
  const filePath = `/data/backups/${backupFile}`;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    folders = new Map(data.folders || []);
    reminders = new Map(data.reminders || []);
    tags = new Map(data.tags || []);
    saveData();
    res.json({ success: true, message: 'Data restored from backup' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore backup', details: err.message });
  }
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Reminders app on port ${PORT}`);
  // Initial tag update
  updateTags();
  
  // Schedule daily full backup at 3 AM
  const now = new Date();
  const nextBackup = new Date(now);
  nextBackup.setHours(3, 0, 0, 0);
  if (nextBackup <= now) {
    nextBackup.setDate(nextBackup.getDate() + 1);
  }
  const msUntilBackup = nextBackup - now;
  
  setTimeout(() => {
    backupData();
    setInterval(backupData, 24 * 60 * 60 * 1000); // Daily
  }, msUntilBackup);
  
  console.log(`Next backup scheduled for ${nextBackup.toISOString()}`);
});
