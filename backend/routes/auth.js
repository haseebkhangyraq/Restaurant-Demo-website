'use strict';
/** Staff + customer authentication. Passwords are bcrypt hashed; sessions are server-side. */
const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db');
const { asyncHandler, requireCustomer } = require('../middleware/auth');

const router = express.Router();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

function tooManyAttempts(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count++;
}
function clearAttempts(key) { attempts.delete(key); }

function publicStaff(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

router.post('/staff/login', asyncHandler((req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const key = `staff:${req.ip}:${email}`;
  if (tooManyAttempts(key)) {
    return res.status(429).json({ error: 'Too many login attempts. Please wait 10 minutes and try again.' });
  }
  const user = get('SELECT * FROM users WHERE LOWER(email) = ?', email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'This account has been deactivated.' });
  clearAttempts(key);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start your session.' });
    req.session.staff = { id: user.id, name: user.name, role: user.role };
    req.session.save((saveErr) => {
      if (saveErr) return res.status(500).json({ error: 'Could not save your session.' });
      res.json({ staff: publicStaff(user) });
    });
  });
}));

router.post('/staff/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie('saffron.sid');
    res.json({ ok: true });
  });
});

router.get('/staff/me', (req, res) => {
  if (!req.session?.staff) return res.status(401).json({ error: 'Not signed in.' });
  const user = get('SELECT * FROM users WHERE id = ?', req.session.staff.id);
  if (!user || user.status !== 'active') {
    req.session.staff = null;
    return res.status(401).json({ error: 'Not signed in.' });
  }
  res.json({ staff: publicStaff(user) });
});

// ───────────── Customers ─────────────
function publicCustomer(c) {
  const { password_hash, ...rest } = c;
  return rest;
}

router.post('/customer/register', asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (get('SELECT id FROM customers WHERE LOWER(email) = ?', email)) {
    return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const r = run('INSERT INTO customers (name, email, phone, password_hash, address, city) VALUES (?,?,?,?,?,?)',
    name, email, phone, hash, req.body.address || null, req.body.city || 'Lahore');
  req.session.customer = { id: r.lastInsertRowid, name };
  res.status(201).json({ customer: publicCustomer(get('SELECT * FROM customers WHERE id = ?', r.lastInsertRowid)) });
}));

router.post('/customer/login', asyncHandler((req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const key = `customer:${req.ip}:${email}`;
  if (tooManyAttempts(key)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  const customer = get('SELECT * FROM customers WHERE LOWER(email) = ?', email);
  if (!customer || !customer.password_hash || !bcrypt.compareSync(password, customer.password_hash)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  clearAttempts(key);
  req.session.customer = { id: customer.id, name: customer.name };
  res.json({ customer: publicCustomer(customer) });
}));

router.post('/customer/logout', (req, res) => {
  if (req.session) req.session.customer = null;
  res.json({ ok: true });
});

router.get('/customer/me', requireCustomer, (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', req.customer.id);
  res.json({ customer: publicCustomer(c) });
});

router.put('/customer/profile', requireCustomer, asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const address = String(req.body.address || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  run('UPDATE customers SET name = ?, phone = ?, address = ?, city = ? WHERE id = ?',
    name, phone || null, address || null, req.body.city || 'Lahore', req.customer.id);
  if (req.session.customer) req.session.customer.name = name;
  res.json({ customer: publicCustomer(get('SELECT * FROM customers WHERE id = ?', req.customer.id)) });
}));

router.put('/customer/password', requireCustomer, asyncHandler((req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const customer = get('SELECT * FROM customers WHERE id = ?', req.customer.id);
  if (!customer.password_hash || !bcrypt.compareSync(current, customer.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  run('UPDATE customers SET password_hash = ? WHERE id = ?', bcrypt.hashSync(next, 10), req.customer.id);
  res.json({ ok: true });
}));

module.exports = router;
