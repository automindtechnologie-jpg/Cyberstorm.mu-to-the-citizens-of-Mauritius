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
`);

// ── MIDDLEWARE ────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// ── SESSIONS (in-memory, 24h TTL) ────────────────────
const sessions = new Map();

function dashAuth(req, res, next) {
  const token = req.headers['x-dashboard-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  const s = sessions.get(token);
  if (Date.now() > s.expires) { sessions.delete(token); return res.status(401).json({ error: 'Session expired' }); }
  s.expires = Date.now() + 24 * 3600 * 1000; // extend on activity
  next();
}

// ── ROUTES ────────────────────────────────────────────

// Health
app.get('/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM signatures').get();
  res.json({ status: 'ok', signatures: count.n, uptime: process.uptime() });
});

// Dashboard login
app.post('/api/dashboard/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + 24 * 3600 * 1000 });
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

// Submit signature (requires petition token)
app.post('/api/sign', (req, res) => {
  const { petition_token, nom, prenom, email, tel, organisation, ref, timestamp } = req.body;

  if (petition_token !== PETITION_TOKEN) {
    return res.status(403).json({ error: 'Invalid petition token' });
  }
  if (!nom || !prenom || !email || !ref) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const existing = db.prepare('SELECT ref FROM signatures WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Email already registered', ref: existing.ref });
  }

  try {
    db.prepare(`
      INSERT INTO signatures (ref, nom, prenom, email, tel, organisation, source, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, 'form', ?)
    `).run(ref, nom.trim(), prenom.trim(), email.toLowerCase().trim(), tel || '', organisation || '', timestamp || new Date().toISOString());

    console.log(`[SIGN] ${nom} ${prenom} <${email}> ref=${ref}`);
    res.json({ success: true, ref });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ref already exists' });
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
  const info = db.prepare('DELETE FROM signatures WHERE ref = ?').run(req.params.ref);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  console.log(`[DELETE] ref=${req.params.ref}`);
  res.json({ success: true });
});

// Bulk import (dashboard)
app.post('/api/import', dashAuth, (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
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

  console.log(`[IMPORT] ${count} entries`);
  res.json({ success: true, count });
});

// Export CSV (dashboard)
app.get('/api/export', dashAuth, (req, res) => {
  const sigs = db.prepare('SELECT nom,prenom,email,tel,organisation,ref,source,timestamp FROM signatures ORDER BY timestamp ASC').all();
  const header = 'nom,prenom,email,tel,organisation,ref,source,timestamp\n';
  const rows = sigs.map(s =>
    [s.nom, s.prenom, s.email, s.tel, s.organisation, s.ref, s.source, s.timestamp]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="cyberstorm-signatures.csv"');
  res.send(header + rows);
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
  console.log(`Cyberstorm Petition running on :${PORT}`);
  console.log(`Petition token configured: ${PETITION_TOKEN.slice(0, 6)}...`);
});
