'use strict';
/**
 * Database layer — uses Node's built-in SQLite (node:sqlite), so no native
 * compilation is required. All queries are prepared statements (SQL injection safe).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

/**
 * Resolves where the SQLite database lives.
 * Locally it stays in ./database/ as before. On Vercel the filesystem is
 * read-only, so the database is copied once per serverless instance into the
 * writable /tmp folder (data persists for that instance; redeploy/cold start
 * restores the bundled copy — demo behaviour).
 */
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.VERCEL) {
    const tmpPath = path.join(os.tmpdir(), 'restaurant.db');
    const sourcePath = path.join(__dirname, '..', 'database', 'restaurant.db');
    if (!fs.existsSync(tmpPath) && fs.existsSync(sourcePath)) {
      for (const file of ['restaurant.db', 'restaurant.db-wal', 'restaurant.db-shm']) {
        const src = path.join(__dirname, '..', 'database', file);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(os.tmpdir(), file));
      }
    }
    return tmpPath;
  }
  return path.join(__dirname, '..', 'database', 'restaurant.db');
}

const DB_PATH = resolveDbPath();
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function run(sql, ...params) {
  const r = db.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}
function exec(sql) {
  return db.exec(sql);
}
/** Runs fn inside a transaction. Rolls back on any error. */
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
    throw err;
  }
}

function now() {
  // Local time formatted for SQLite date functions
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function dateOnly(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  phone TEXT,
  salary REAL DEFAULT 0,
  join_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  color TEXT DEFAULT '#C9A227',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  loyalty_points INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  image TEXT,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  long_description TEXT,
  price REAL NOT NULL DEFAULT 0,
  image TEXT,
  is_veg INTEGER DEFAULT 0,
  is_featured INTEGER DEFAULT 0,
  is_popular INTEGER DEFAULT 0,
  is_recommended INTEGER DEFAULT 0,
  available INTEGER DEFAULT 1,
  prep_time INTEGER DEFAULT 20,
  calories INTEGER,
  rating REAL DEFAULT 4.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  group_name TEXT DEFAULT 'Extras',
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_addons (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  addon_id INTEGER NOT NULL REFERENCES addons(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, addon_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  outstanding_balance REAL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  stock_qty REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  purchase_price REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  expiry_date TEXT,
  category TEXT DEFAULT 'General',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 0,
  UNIQUE(product_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  qty_change REAL NOT NULL,
  unit_cost REAL DEFAULT 0,
  reference TEXT,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  order_date TEXT NOT NULL DEFAULT (date('now','localtime')),
  received_date TEXT,
  subtotal REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL DEFAULT 0,
  paid_amount REAL DEFAULT 0,
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS dining_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL DEFAULT 2,
  area TEXT DEFAULT 'Main Hall',
  status TEXT NOT NULL DEFAULT 'available',
  current_order_id INTEGER,
  x INTEGER DEFAULT 0,
  y INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'dine-in',
  table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  payment_method TEXT DEFAULT 'cash',
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  delivery_fee REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  coupon_code TEXT,
  notes TEXT,
  customer_name TEXT,
  phone TEXT,
  address TEXT,
  source TEXT DEFAULT 'pos',
  inventory_deducted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  addons_json TEXT,
  notes TEXT,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  subtotal REAL NOT NULL,
  tax REAL NOT NULL,
  discount REAL NOT NULL,
  delivery_fee REAL NOT NULL,
  total REAL NOT NULL,
  payment_method TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  issued_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  guests INTEGER NOT NULL DEFAULT 2,
  table_id INTEGER REFERENCES dining_tables(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now','localtime')),
  payment_method TEXT DEFAULT 'cash',
  reference TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'percent',
  value REAL NOT NULL,
  min_order REAL DEFAULT 0,
  max_discount REAL,
  usage_limit INTEGER,
  used_count INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS testimonials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT,
  rating INTEGER DEFAULT 5,
  text TEXT NOT NULL,
  image TEXT,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  category TEXT,
  image TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Home',
  address TEXT NOT NULL,
  city TEXT,
  phone TEXT,
  is_default INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_ingredient ON inventory_transactions(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
`);

const DEFAULT_SETTINGS = {
  restaurant_name: 'Saffron House',
  tagline: 'Modern Pakistani Grill & Kitchen',
  address: '42-C, MM Alam Road, Gulberg III, Lahore, Pakistan',
  phone: '+92 42 3577 8899',
  email: 'hello@saffronhouse.pk',
  website: 'www.saffronhouse.pk',
  currency: 'PKR',
  currency_symbol: 'Rs.',
  tax_rate: '5',
  delivery_fee: '250',
  min_order: '1000',
  receipt_footer: 'Thank you for dining with Saffron House. We hope to see you again!',
  receipt_header: 'Saffron House — Modern Pakistani Grill & Kitchen',
  order_prefix: 'SH',
  opening_hours: JSON.stringify({
    mon: '12:00 PM – 11:30 PM', tue: '12:00 PM – 11:30 PM', wed: '12:00 PM – 11:30 PM',
    thu: '12:00 PM – 11:30 PM', fri: '12:00 PM – 12:30 AM', sat: '12:00 PM – 12:30 AM', sun: '12:00 PM – 11:00 PM'
  }),
  socials: JSON.stringify({ instagram: '#', facebook: '#', twitter: '#', youtube: '#' }),
  tax_label: 'GST (5%)',
  logo: 'SH',
  reservation_notice: 'Reservations are held for 15 minutes past the booked time.',
  service_charge: '0',
  online_payment_enabled: '1',
  maintenance_mode: '0'
};

function seedSettings() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
  }
}
seedSettings();

function getSettings(publicOnly = false) {
  const rows = all('SELECT key, value FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  if (publicOnly) {
    return {
      restaurant_name: obj.restaurant_name,
      tagline: obj.tagline,
      address: obj.address,
      phone: obj.phone,
      email: obj.email,
      website: obj.website,
      currency: obj.currency,
      currency_symbol: obj.currency_symbol,
      tax_rate: Number(obj.tax_rate),
      delivery_fee: Number(obj.delivery_fee),
      min_order: Number(obj.min_order),
      opening_hours: safeJSON(obj.opening_hours, {}),
      socials: safeJSON(obj.socials, {}),
      logo: obj.logo,
      online_payment_enabled: obj.online_payment_enabled,
      reservation_notice: obj.reservation_notice
    };
  }
  return obj;
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

/** Generates a unique sequential order number like SH-241102-0042 */
function nextOrderNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const prefix = get('SELECT value FROM settings WHERE key = ?', 'order_prefix')?.value || 'SH';
  const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const row = get(
    `SELECT COUNT(*) AS c FROM orders WHERE order_number LIKE ?`, `${prefix}-${stamp}-%`
  );
  return `${prefix}-${stamp}-${String((row?.c || 0) + 1).padStart(4, '0')}`;
}

function nextInvoiceNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}`;
  const row = get('SELECT COUNT(*) AS c FROM invoices WHERE invoice_number LIKE ?', `INV-${stamp}-%`);
  return `INV-${stamp}-${String((row?.c || 0) + 1).padStart(4, '0')}`;
}

function nextPurchaseNumber() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}`;
  const row = get('SELECT COUNT(*) AS c FROM purchases WHERE po_number LIKE ?', `PO-${stamp}-%`);
  return `PO-${stamp}-${String((row?.c || 0) + 1).padStart(3, '0')}`;
}

function nextReservationCode() {
  const row = get('SELECT COUNT(*) AS c FROM reservations');
  return `RSV-${String((row?.c || 0) + 1).padStart(4, '0')}`;
}

module.exports = {
  db, all, get, run, exec, transaction, now, dateOnly,
  getSettings, setSetting, seedSettings, safeJSON,
  nextOrderNumber, nextInvoiceNumber, nextPurchaseNumber, nextReservationCode,
  DB_PATH, DEFAULT_SETTINGS
};
