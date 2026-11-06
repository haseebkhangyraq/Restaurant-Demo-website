'use strict';
/**
 * Saffron House — application entry point.
 * Local:   node server.js   (serves the API and the static frontend)
 * Vercel:  this module is exported as the serverless request handler for /api/*,
 *          static files are served straight from the frontend/ folder.
 */
const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteSessionStore = require('./backend/session-store');
const db = require('./backend/db');
const { get } = db;

const PORT = Number(process.env.PORT) || 3001;
const IS_VERCEL = Boolean(process.env.VERCEL);

const app = express();

if (IS_VERCEL) app.set('trust proxy', 1);
app.disable('x-powered-by');

// ─────────────────────────── Middleware ───────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.use(session({
  store: new SQLiteSessionStore(),
  name: 'saffron.sid',
  secret: process.env.SESSION_SECRET || 'saffron-house-dev-secret',
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 14 * 24 * 60 * 60 * 1000
  }
}));

// Local convenience: auto-seed an empty database when running development.
if (!IS_VERCEL) {
  try {
    if (get('SELECT COUNT(*) AS c FROM users').c === 0 && get('SELECT COUNT(*) AS c FROM products').c === 0) {
      console.warn('⚠  Database is empty — seeding demo data… (npm run seed to force a reseed)');
      require('./backend/seed').seed();
    }
  } catch (err) {
    console.error('Startup seed check failed:', err.message);
  }
}

// ─────────────────────────── API routes ───────────────────────────
app.use('/api', require('./backend/routes/public'));
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api/admin', require('./backend/routes/admin'));
app.use('/api/admin', require('./backend/routes/catalog-admin'));
app.use('/api/admin', require('./backend/routes/inventory'));
app.use('/api/admin', require('./backend/routes/reports'));

// ─────────────────────────── Uploaded images ───────────────────────────
// New uploads live in the database (Vercel has no writable static storage).
app.get('/uploads/:file', (req, res, next) => {
  try {
    const row = get('SELECT mime, data FROM uploads WHERE filename = ?', req.params.file);
    if (row && row.data) {
      res.setHeader('Content-Type', row.mime || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(Buffer.from(row.data));
    }
  } catch (_) { /* fall through to disk lookup */ }
  next();
});
// Legacy uploads that were written to disk before the move to the database.
app.use('/uploads', express.static(path.join(__dirname, 'frontend', 'uploads'), { maxAge: '30d', fallthrough: false }));

// ─────────────────────────── Static frontend ───────────────────────────
const FRONTEND_DIR = path.join(__dirname, 'frontend');
app.use(express.static(FRONTEND_DIR, { maxAge: '1h' }));

// Friendly 404 for everything else
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API route not found.' });
  res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html'));
});

// ─────────────────────────── Errors ───────────────────────────
app.use((err, req, res, _next) => {
  if (req.path.startsWith('/api')) {
    const status = err.status || (Number(err.statusCode) || 500);
    if (status >= 500) console.error('API error:', err);
    return res.status(status).json({ error: err.expose === false ? 'Internal server error.' : (err.message || 'Internal server error.') });
  }
  console.error('Unhandled error:', err);
  if (res.headersSent) return res.end();
  res.status(500).sendFile(path.join(FRONTEND_DIR, '404.html'));
});

module.exports = app;

// Start the real HTTP server only for local development. On Vercel the
// exported app already acts as the serverless request handler.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Saffron House running: http://localhost:${PORT}`);
    console.log(`Database: ${db.DB_PATH}`);
  });
}
