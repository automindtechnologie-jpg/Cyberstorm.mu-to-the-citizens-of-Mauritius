'use strict';
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const PETITION_TOKEN = process.env.PETITION_TOKEN || 'dev-token';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'default-secret';

// ── DATABASE ──────────────────────────────────────────
const db = new Database(path.join('/app/data', 'signatures.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS signatures (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ref       TEXT UNIQUE NOT NULL,
    nom       TEXT NOT NULL,
    prenom    TEXT NOT NULL,
    email     TEXT NOT NULL,
    tel       TEXT DEFAULT '',
    organisation TEXT DEFAULT '',
    source    TEXT DEFAULT 'form',
    timestamp TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_email ON signatures(email);
  CREATE INDEX IF NOT EXISTS idx_timestamp ON signatures(timestamp);
  CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT NOT NULL,
    level      TEXT NOT NULL,
    message    TEXT NOT NULL,
    detail     TEXT DEFAULT '',
    ip         TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
  CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
`);

// ── MIDDLEWARE ────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ── LOGGING HELPER ───────────────────────────────────
function logEvent(source, level, message, detail, ip) {
  try {
    db.prepare('INSERT INTO logs (source, level, message, detail, ip) VALUES (?, ?, ?, ?, ?)')
      .run(source, level, message, detail || '', ip || '');
  } catch(e) { /* silent */ }
}

// ── SESSIONS (in-memory, 24h TTL) ────────────────────
const sessions = new Map();

function dashAuth(req, res, next) {
  const token = req.headers['x-dashboard-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  const s = sessions.get(token);
  if (Date.now() > s.expires) { sessions.delete(token); return res.status(401).json({ error: 'Session expired' }); }
  s.expires = Date.now() + 24 * 3600 * 1000;
  next();
}

function getIP(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// ── ROUTES ────────────────────────────────────────────

// Health
app.get('/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM signatures').get();
  const logCount = db.prepare('SELECT COUNT(*) as n FROM logs').get();
  res.json({ status: 'ok', signatures: count.n, logs: logCount.n, uptime: process.uptime() });
});

// Dashboard login
app.post('/api/dashboard/login', (req, res) => {
  const { password } = req.body;
  const ip = getIP(req);
  if (!password || password !== DASHBOARD_PASSWORD) {
    logEvent('dashboard', 'warn', 'Login failed', 'Invalid password', ip);
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + 24 * 3600 * 1000 });
  logEvent('dashboard', 'info', 'Login success', 'Session created', ip);
  res.json({ token });
});

// Validate dashboard session
app.get('/api/dashboard/validate', dashAuth, (req, res) => {
  res.json({ valid: true });
});

// Public: signature count
app.get('/api/count', (req, res) => {
  const result = db.prepare('SELECT COUNT(*) as count FROM signatures').get();
  res.json({ count: result.count });
});

// Submit signature
app.post('/api/sign', (req, res) => {
  const { petition_token, nom, prenom, email, tel, organisation, ref, timestamp } = req.body;
  const ip = getIP(req);

  if (petition_token !== PETITION_TOKEN) {
    logEvent('form', 'error', 'Invalid petition token', 'Token: ' + (petition_token || 'none'), ip);
    return res.status(403).json({ error: 'Invalid petition token' });
  }
  if (!nom || !prenom || !email || !ref) {
    logEvent('form', 'warn', 'Missing required fields', 'nom=' + !!nom + ' prenom=' + !!prenom + ' email=' + !!email, ip);
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    logEvent('form', 'warn', 'Invalid email format', email, ip);
    return res.status(400).json({ error: 'Invalid email' });
  }

  const existing = db.prepare('SELECT ref FROM signatures WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    logEvent('form', 'warn', 'Duplicate email', email + ' (existing ref: ' + existing.ref + ')', ip);
    return res.status(409).json({ error: 'Email already registered', ref: existing.ref });
  }

  try {
    db.prepare(`
      INSERT INTO signatures (ref, nom, prenom, email, tel, organisation, source, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, 'form', ?)
    `).run(ref, nom.trim(), prenom.trim(), email.toLowerCase().trim(), tel || '', organisation || '', timestamp || new Date().toISOString());

    logEvent('form', 'info', 'Signature submitted', nom.trim() + ' ' + prenom.trim() + ' <' + email.toLowerCase().trim() + '> ref=' + ref, ip);
    console.log('[SIGN]', nom, prenom, '<' + email + '>', 'ref=' + ref);
    res.json({ success: true, ref });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      logEvent('form', 'warn', 'Duplicate ref', 'ref=' + ref + ' email=' + email, ip);
      return res.status(409).json({ error: 'Ref already exists' });
    }
    logEvent('form', 'error', 'Database error on sign', e.message, ip);
    console.error('[SIGN ERROR]', e.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all signatures (dashboard)
app.get('/api/signatures', dashAuth, (req, res) => {
  const sigs = db.prepare('SELECT * FROM signatures ORDER BY timestamp ASC').all();
  res.json(sigs);
});

// Delete signature (dashboard)
app.delete('/api/signatures/:ref', dashAuth, (req, res) => {
  const ip = getIP(req);
  const sig = db.prepare('SELECT nom, prenom, email FROM signatures WHERE ref = ?').get(req.params.ref);
  const info = db.prepare('DELETE FROM signatures WHERE ref = ?').run(req.params.ref);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  const detail = sig ? sig.nom + ' ' + sig.prenom + ' <' + sig.email + '> ref=' + req.params.ref : 'ref=' + req.params.ref;
  logEvent('dashboard', 'warn', 'Signature deleted', detail, ip);
  console.log('[DELETE] ref=' + req.params.ref);
  res.json({ success: true });
});

// Bulk import (dashboard)
app.post('/api/import', dashAuth, (req, res) => {
  const { entries } = req.body;
  const ip = getIP(req);
  if (!Array.isArray(entries) || entries.length === 0) {
    logEvent('dashboard', 'warn', 'Import failed', 'No entries provided', ip);
    return res.status(400).json({ error: 'No entries provided' });
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO signatures (ref, nom, prenom, email, tel, organisation, source, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, 'imported', ?)
  `);

  const now = Date.now();
  let count = 0;
  const insertAll = db.transaction((items) => {
    for (let i = 0; i < items.length; i++) {
      const e = items[i];
      if (!e.email || !e.email.includes('@')) continue;
      const ref = 'IMP-' + (now + i).toString(36).toUpperCase().slice(-6);
      const ts = new Date(now - i * 1000).toISOString();
      stmt.run(ref, e.nom || '', e.prenom || '', e.email.toLowerCase().trim(), e.tel || '', e.organisation || '', ts);
      count++;
    }
  });
  insertAll(entries);

  logEvent('dashboard', 'info', 'Bulk import completed', count + ' entries imported (' + entries.length + ' submitted)', ip);
  console.log('[IMPORT]', count, 'entries');
  res.json({ success: true, count });
});

// Export CSV (dashboard)
app.get('/api/export', dashAuth, (req, res) => {
  const ip = getIP(req);
  const sigs = db.prepare('SELECT nom,prenom,email,tel,organisation,ref,source,timestamp FROM signatures ORDER BY timestamp ASC').all();
  logEvent('dashboard', 'info', 'CSV export', sigs.length + ' rows exported', ip);
  const header = 'nom,prenom,email,tel,organisation,ref,source,timestamp\n';
  const rows = sigs.map(s =>
    [s.nom, s.prenom, s.email, s.tel, s.organisation, s.ref, s.source, s.timestamp]
      .map(v => '"' + (v || '').replace(/"/g, '""') + '"')
      .join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="cyberstorm-signatures.csv"');
  res.send(header + rows);
});

// Get logs (dashboard)
app.get('/api/logs', dashAuth, (req, res) => {
  const { source, level, limit = 300 } = req.query;
  let query = 'SELECT * FROM logs';
  const params = [];
  const where = [];
  if (source && (source === 'form' || source === 'dashboard')) {
    where.push('source = ?'); params.push(source);
  }
  if (level && ['info', 'warn', 'error'].includes(level)) {
    where.push('level = ?'); params.push(level);
  }
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit) || 300);
  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

// Clear logs (dashboard)
app.delete('/api/logs', dashAuth, (req, res) => {
  const { source } = req.query;
  const ip = getIP(req);
  if (source && (source === 'form' || source === 'dashboard')) {
    db.prepare('DELETE FROM logs WHERE source = ?').run(source);
    logEvent('dashboard', 'warn', 'Logs cleared', 'source=' + source, ip);
  } else {
    db.prepare('DELETE FROM logs').run();
    logEvent('dashboard', 'warn', 'All logs cleared', '', ip);
  }
  res.json({ success: true });
});

// Serve petition form at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'petition.html'));
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ── START ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('Cyberstorm Petition running on :' + PORT);
  console.log('Petition token configured: ' + PETITION_TOKEN.slice(0, 6) + '...');
});
