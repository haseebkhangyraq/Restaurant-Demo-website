'use strict';
/** Management APIs: dashboard analytics, order management, POS, billing, tables, CRM, staff, settings. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const {
  all, get, run, now, dateOnly, transaction, getSettings, setSetting, DB_PATH
} = require('../db');
const {
  createOrder, setOrderStatus, getOrderDetails, restockInventory, round, calculateTotals
} = require('../lib/orders');
const {
  requireStaff, requirePermission, requireRole, asyncHandler, httpError
} = require('../middleware/auth');
const { serializeProduct } = require('../lib/catalog');

const router = express.Router();
router.use(requireStaff);

const IS_SERVERLESS = Boolean(process.env.VERCEL);

// Images are stored in the database (uploads table) so they survive restarts
// and keep working in serverless environments such as Vercel.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, GIF or AVIF images are allowed.'));
    }
    cb(null, true);
  }
});

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const isoDate = (d) => dateOnly(d);

// ─────────────────────────── DASHBOARD ───────────────────────────
router.get('/stats', requirePermission('dashboard'), (req, res) => {
  const range = [7, 30, 90, 365].includes(Number(req.query.range)) ? Number(req.query.range) : 30;
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - range + 1);
  const from = isoDate(fromDate);
  const prevFromDate = new Date();
  prevFromDate.setDate(prevFromDate.getDate() - range * 2 + 1);
  const prevFrom = isoDate(prevFromDate);
  const prevTo = isoDate(new Date(fromDate.getTime() - 86400000));
  const today = isoDate(new Date());

  const allSales = get(`SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS orders FROM orders WHERE status = 'completed'`);
  const todaySales = get(`SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS orders FROM orders WHERE status = 'completed' AND date(created_at) = ?`, today);
  const rangeSales = get(`SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS orders FROM orders WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?`, from, today);
  const prevSales = get(`SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS orders FROM orders WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?`, prevFrom, prevTo);
  const totalOrders = get('SELECT COUNT(*) AS c FROM orders').c;
  const statusCounts = Object.fromEntries(all('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').map((r) => [r.status, r.c]));
  const totalCustomers = get('SELECT COUNT(*) AS c FROM customers').c;
  const lowStock = all('SELECT * FROM ingredients WHERE stock_qty <= min_stock ORDER BY (stock_qty - min_stock) ASC');
  const avgOrder = allSales.orders ? round(allSales.sales / allSales.orders) : 0;
  const prevAvg = prevSales.orders ? prevSales.sales / prevSales.orders : 0;
  const pct = (curr, prev) => (prev > 0 ? round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0));

  const bestSellers = all(
    `SELECT oi.product_id, oi.name, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue,
            p.image, c.name AS category
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status = 'completed' AND date(o.created_at) BETWEEN ? AND ?
     GROUP BY oi.product_id, oi.name ORDER BY qty DESC LIMIT 6`, from, today
  );

  const dailyMap = {};
  for (const row of all(
    `SELECT date(created_at) AS d, SUM(total) AS sales, COUNT(*) AS orders
     FROM orders WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ? GROUP BY date(created_at)`, from, today
  )) dailyMap[row.d] = row;
  const daily = [];
  for (let i = 0; i < range; i++) {
    const d = new Date(fromDate); d.setDate(d.getDate() + i);
    const key = isoDate(d);
    daily.push({ date: key, sales: round(dailyMap[key]?.sales || 0), orders: dailyMap[key]?.orders || 0 });
  }

  // Weekly (current week) and monthly (12 months) charts
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekly = weekday.map((label, idx) => {
    const row = get(
      `SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS orders FROM orders
       WHERE status='completed' AND strftime('%w', created_at) = ? AND date(created_at) >= ?`, String(idx), from
    );
    return { label, sales: round(row.sales), orders: row.orders };
  });
  const monthly = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const row = get(`SELECT COALESCE(SUM(total),0) AS sales, COUNT(*) AS orders FROM orders WHERE status='completed' AND strftime('%Y-%m', created_at) = ?`, key);
    monthly.push({ label: d.toLocaleString('en', { month: 'short' }), month: key, sales: round(row.sales), orders: row.orders });
  }

  const recentOrders = all(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
     FROM orders o ORDER BY o.created_at DESC LIMIT 8`
  );
  const recentTransactions = all(
    `SELECT i.*, o.order_number, o.customer_name, o.type FROM invoices i
     LEFT JOIN orders o ON o.id = i.order_id ORDER BY i.issued_at DESC LIMIT 8`
  );
  const paymentMix = all(
    `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM orders
     WHERE status='completed' AND date(created_at) BETWEEN ? AND ? GROUP BY payment_method`, from, today
  );
  const categorySales = all(
    `SELECT COALESCE(c.name,'Uncategorised') AS category, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status='completed' AND date(o.created_at) BETWEEN ? AND ?
     GROUP BY c.name ORDER BY revenue DESC`, from, today
  );
  const topCustomers = all(
    `SELECT c.id, c.name, c.phone, COUNT(o.id) AS orders, COALESCE(SUM(o.total),0) AS spent
     FROM customers c JOIN orders o ON o.customer_id = c.id AND o.status='completed'
     GROUP BY c.id ORDER BY spent DESC LIMIT 5`
  );
  const tableStats = Object.fromEntries(all(`SELECT status, COUNT(*) c FROM dining_tables GROUP BY status`).map((r) => [r.status, r.c]));
  const activeOrders = all(`SELECT COUNT(*) c FROM orders WHERE status IN ('pending','confirmed','preparing','ready','out_for_delivery')`)[0].c;
  const inventoryValue = round(get(`SELECT COALESCE(SUM(stock_qty * purchase_price),0) v FROM ingredients`).v);
  const unreadMessages = get(`SELECT COUNT(*) c FROM contact_messages WHERE status='new'`).c;
  const pendingReservations = get(`SELECT COUNT(*) c FROM reservations WHERE status='pending'`).c;

  res.json({
    range,
    kpis: {
      totalSales: round(allSales.sales),
      todayRevenue: round(todaySales.sales),
      todayOrders: todaySales.orders,
      totalOrders,
      activeOrders,
      completedOrders: statusCounts.completed || 0,
      pendingOrders: statusCounts.pending || 0,
      cancelledOrders: statusCounts.cancelled || 0,
      avgOrderValue: avgOrder,
      totalCustomers,
      lowStockCount: lowStock.length,
      inventoryValue,
      unreadMessages,
      pendingReservations,
      rangeSales: round(rangeSales.sales),
      rangeOrders: rangeSales.orders,
      growth: {
        sales: pct(rangeSales.sales, prevSales.sales),
        orders: pct(rangeSales.orders, prevSales.orders),
        avg: pct(avgOrder, prevAvg)
      }
    },
    statusCounts,
    bestSellers,
    lowStock: lowStock.slice(0, 6),
    daily,
    weekly,
    monthly,
    recentOrders,
    recentTransactions,
    paymentMix,
    categorySales,
    topCustomers,
    tableStats,
    today
  });
});

// ─────────────────────────── ORDERS ───────────────────────────
router.get('/orders', requirePermission('orders'), (req, res) => {
  const where = [];
  const params = [];
  const { status, search, type, payment_status, from, to, source } = req.query;
  if (status && status !== 'all') {
    if (status === 'active') where.push(`o.status IN ('pending','confirmed','preparing','ready','out_for_delivery')`);
    else { where.push('o.status = ?'); params.push(status); }
  }
  if (type && type !== 'all') { where.push('o.type = ?'); params.push(type); }
  if (payment_status && payment_status !== 'all') { where.push('o.payment_status = ?'); params.push(payment_status); }
  if (source && source !== 'all') { where.push('o.source = ?'); params.push(source); }
  if (search) {
    where.push(`(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ? OR o.table_id IN (SELECT id FROM dining_tables WHERE number LIKE ?))`);
    const q = `%${search}%`; params.push(q, q, q, q);
  }
  if (from) { where.push('date(o.created_at) >= ?'); params.push(from); }
  if (to) { where.push('date(o.created_at) <= ?'); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const rows = all(
    `SELECT o.*, t.number AS table_number, c.email AS customer_email,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
       i.invoice_number
     FROM orders o
     LEFT JOIN dining_tables t ON t.id = o.table_id
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN invoices i ON i.order_id = o.id
     ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  const total = get(`SELECT COUNT(*) c FROM orders o ${whereSql}`, ...params).c;
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) c FROM orders GROUP BY status').map((r) => [r.status, r.c]));
  counts.all = get('SELECT COUNT(*) c FROM orders').c;
  counts.active = (counts.pending || 0) + (counts.confirmed || 0) + (counts.preparing || 0) + (counts.ready || 0) + (counts.out_for_delivery || 0);
  res.json({ orders: rows, total, counts, limit, offset });
});

router.get('/orders/:id', requirePermission('orders'), (req, res) => {
  const order = getOrderDetails(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  order.settings = getSettings(true);
  res.json({ order });
});

router.patch('/orders/:id/status', requirePermission('orders'), asyncHandler((req, res) => {
  const { status, force } = req.body;
  try {
    const result = setOrderStatus(Number(req.params.id), status, { staffId: req.staff.id, force: !!force });
    res.json({ order: result.order, warnings: result.warnings });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ error: err.message, code: err.code, shortages: err.shortages });
    }
    throw err;
  }
}));

router.patch('/orders/:id/payment', requirePermission('orders'), asyncHandler((req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!order) throw httpError('Order not found.', 404);
  const status = req.body.payment_status;
  if (!['paid', 'unpaid', 'refunded'].includes(status)) throw httpError('Invalid payment status.');
  run('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ?', status, now(), order.id);
  run('UPDATE invoices SET status = ?, payment_method = COALESCE(?, payment_method) WHERE order_id = ?',
    status === 'paid' ? 'paid' : (status === 'refunded' ? 'refunded' : 'unpaid'), req.body.payment_method || null, order.id);
  res.json({ order: getOrderDetails(order.id) });
}));

router.patch('/orders/:id/table', requirePermission('orders'), asyncHandler((req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!order) throw httpError('Order not found.', 404);
  const table = get('SELECT * FROM dining_tables WHERE id = ?', Number(req.body.table_id));
  if (!table) throw httpError('Select a valid table.');
  transaction(() => {
    if (order.table_id) {
      run(`UPDATE dining_tables SET status = 'available', current_order_id = NULL WHERE id = ? AND current_order_id = ?`, order.table_id, order.id);
    }
    run(`UPDATE dining_tables SET status = 'occupied', current_order_id = ? WHERE id = ?`, order.id, table.id);
    run(`UPDATE orders SET table_id = ?, type = 'dine-in', updated_at = ? WHERE id = ?`, table.id, now(), order.id);
  });
  res.json({ order: getOrderDetails(order.id) });
}));

router.patch('/orders/:id/notes', requirePermission('orders'), (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ?', Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  run('UPDATE orders SET notes = ?, updated_at = ? WHERE id = ?', String(req.body.notes || '').slice(0, 1000), now(), order.id);
  res.json({ ok: true });
});

// Kitchen display — lightweight active queue
router.get('/kitchen/orders', requirePermission('kitchen'), (req, res) => {
  const rows = all(
    `SELECT o.id, o.order_number, o.type, o.status, o.created_at, o.notes, o.customer_name,
            t.number AS table_number,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
     FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id
     WHERE o.status IN ('pending','confirmed','preparing','ready')
     ORDER BY CASE o.status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'preparing' THEN 2 WHEN 'ready' THEN 3 ELSE 4 END,
              o.created_at ASC`
  ).map((o) => {
    const items = all('SELECT id, name, qty, addons_json, notes FROM order_items WHERE order_id = ?', o.id);
    return {
      ...o,
      items: items.map((i) => ({ ...i, addons: i.addons_json ? JSON.parse(i.addons_json) : null })),
      minutes_elapsed: Math.floor((Date.now() - new Date(o.created_at.replace(' ', 'T')).getTime()) / 60000)
    };
  });
  res.json({ orders: rows, counts: {
    pending: rows.filter((r) => r.status === 'pending').length,
    preparing: rows.filter((r) => r.status === 'preparing').length,
    ready: rows.filter((r) => r.status === 'ready').length
  } });
});

// ─────────────────────────── POS ───────────────────────────
router.post('/pos/checkout', requirePermission('pos'), asyncHandler((req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.items) || !b.items.length) throw httpError('Add at least one item to the order.');
  const type = ['dine-in', 'takeaway', 'delivery'].includes(b.type) ? b.type : 'takeaway';
  if (type === 'dine-in' && !b.table_id) throw httpError('Select a table for dine-in orders.');
  if (type === 'delivery' && !String(b.address || '').trim()) throw httpError('Enter a delivery address.');
  const method = ['cash', 'card', 'demo'].includes(b.payment_method) ? b.payment_method : 'cash';
  const paid = b.payment_status !== 'unpaid';
  let customerId = b.customer_id ? Number(b.customer_id) : null;
  if (customerId && !get('SELECT id FROM customers WHERE id = ?', customerId)) customerId = null;
  if (!customerId && String(b.customer_name || '').trim() && String(b.phone || '').trim()) {
    const existing = get('SELECT id FROM customers WHERE phone = ?', String(b.phone).trim());
    customerId = existing ? existing.id : null;
  }
  try {
    const result = createOrder({
      items: b.items,
      type,
      tableId: type === 'dine-in' ? Number(b.table_id) : null,
      customerId,
      customer: customerId ? null : {
        name: String(b.customer_name || '').trim() || 'Walk-in Guest',
        phone: String(b.phone || '').trim(),
        address: String(b.address || '').trim()
      },
      name: String(b.customer_name || '').trim(),
      phone: String(b.phone || '').trim(),
      address: String(b.address || '').trim() || null,
      notes: b.notes,
      couponCode: b.coupon_code,
      discount: num(b.discount),
      deliveryFee: type === 'delivery' ? num(b.delivery_fee, Number(getSettings().delivery_fee)) : 0,
      paymentMethod: method,
      paymentStatus: paid ? 'paid' : 'unpaid',
      status: 'completed',
      source: 'pos',
      deductInventory: true,
      force: !!b.force,
      staffId: req.staff.id
    });
    // Mark invoice paid for completed POS sales (or leave unpaid for room tabs)
    if (!paid) run(`UPDATE invoices SET status = 'unpaid' WHERE order_id = ?`, result.orderId);
    res.status(201).json({
      order: getOrderDetails(result.orderId),
      invoice: get('SELECT * FROM invoices WHERE order_id = ?', result.orderId),
      change_due: method === 'cash' ? round(num(b.cash_received) - result.totals.total) : 0
    });
  } catch (err) {
    if (err.code === 'INSUFFICIENT_STOCK') {
      return res.status(409).json({ error: err.message, code: err.code, shortages: err.shortages });
    }
    throw err;
  }
}));

// ─────────────────────────── INVOICES ───────────────────────────
router.get('/invoices', requirePermission('billing'), (req, res) => {
  const where = [];
  const params = [];
  const { status, search, from, to } = req.query;
  if (status && status !== 'all') { where.push('i.status = ?'); params.push(status); }
  if (search) {
    where.push(`(i.invoice_number LIKE ? OR o.order_number LIKE ? OR o.customer_name LIKE ?)`);
    const q = `%${search}%`; params.push(q, q, q);
  }
  if (from) { where.push('date(i.issued_at) >= ?'); params.push(from); }
  if (to) { where.push('date(i.issued_at) <= ?'); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT i.*, o.order_number, o.customer_name, o.type, o.payment_status
     FROM invoices i LEFT JOIN orders o ON o.id = i.order_id ${whereSql}
     ORDER BY i.issued_at DESC LIMIT 200`, ...params
  );
  const summary = get(
    `SELECT COALESCE(SUM(i.total),0) total, COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total ELSE 0 END),0) paid,
            COALESCE(SUM(CASE WHEN i.status='unpaid' THEN i.total ELSE 0 END),0) unpaid, COUNT(*) count
     FROM invoices i LEFT JOIN orders o ON o.id = i.order_id ${whereSql}`, ...params
  );
  res.json({ invoices: rows, summary });
});

router.get('/invoices/:id', requirePermission('billing'), (req, res) => {
  const invoice = get('SELECT * FROM invoices WHERE id = ?', Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  const order = invoice.order_id ? getOrderDetails(invoice.order_id) : null;
  res.json({ invoice, order, settings: getSettings(true) });
});

// ─────────────────────────── TABLES ───────────────────────────
router.get('/tables', requirePermission('tables'), (req, res) => {
  const tables = all(
    `SELECT t.*, o.order_number, o.total AS order_total, o.status AS order_status, o.customer_name
     FROM dining_tables t LEFT JOIN orders o ON o.id = t.current_order_id ORDER BY t.number`
  );
  const upcoming = all(
    `SELECT r.*, t.number AS table_number FROM reservations r LEFT JOIN dining_tables t ON t.id = r.table_id
     WHERE r.date >= date('now','localtime') AND r.status IN ('pending','confirmed') ORDER BY r.date, r.time`
  );
  res.json({ tables, reservations: upcoming });
});

router.post('/tables', requireRole('admin', 'manager'), (req, res) => {
  const number = String(req.body.number || '').trim();
  const capacity = parseInt(req.body.capacity, 10);
  if (!number) return res.status(400).json({ error: 'Table number is required.' });
  if (get('SELECT id FROM dining_tables WHERE number = ?', number)) return res.status(409).json({ error: 'Table number already exists.' });
  if (!capacity || capacity < 1 || capacity > 30) return res.status(400).json({ error: 'Capacity must be between 1 and 30.' });
  const r = run('INSERT INTO dining_tables (number, capacity, area, x, y) VALUES (?,?,?,?,?)',
    number, capacity, String(req.body.area || 'Main Hall'), num(req.body.x, 60), num(req.body.y, 60));
  res.status(201).json({ table: get('SELECT * FROM dining_tables WHERE id = ?', r.lastInsertRowid) });
});

router.put('/tables/:id', requireRole('admin', 'manager'), (req, res) => {
  const table = get('SELECT * FROM dining_tables WHERE id = ?', Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found.' });
  const number = String(req.body.number || table.number).trim();
  const dup = get('SELECT id FROM dining_tables WHERE number = ? AND id != ?', number, table.id);
  if (dup) return res.status(409).json({ error: 'Table number already exists.' });
  run('UPDATE dining_tables SET number = ?, capacity = ?, area = ?, x = ?, y = ? WHERE id = ?',
    number, parseInt(req.body.capacity, 10) || table.capacity, String(req.body.area || table.area),
    req.body.x !== undefined ? num(req.body.x) : table.x, req.body.y !== undefined ? num(req.body.y) : table.y, table.id);
  res.json({ table: get('SELECT * FROM dining_tables WHERE id = ?', table.id) });
});

router.patch('/tables/:id/status', requirePermission('tables'), (req, res) => {
  const table = get('SELECT * FROM dining_tables WHERE id = ?', Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found.' });
  const status = req.body.status;
  if (!['available', 'occupied', 'reserved', 'cleaning'].includes(status)) return res.status(400).json({ error: 'Invalid table status.' });
  run('UPDATE dining_tables SET status = ?, current_order_id = CASE WHEN ? = ? THEN current_order_id ELSE NULL END WHERE id = ?',
    status, status, 'occupied', table.id);
  res.json({ table: get('SELECT * FROM dining_tables WHERE id = ?', table.id) });
});

router.delete('/tables/:id', requireRole('admin', 'manager'), (req, res) => {
  const table = get('SELECT * FROM dining_tables WHERE id = ?', Number(req.params.id));
  if (!table) return res.status(404).json({ error: 'Table not found.' });
  if (table.current_order_id) return res.status(409).json({ error: 'This table has an active order. Clear the table first.' });
  run('DELETE FROM dining_tables WHERE id = ?', table.id);
  res.json({ ok: true });
});

// ─────────────────────────── RESERVATIONS ───────────────────────────
router.get('/reservations', requirePermission('reservations'), (req, res) => {
  const where = [];
  const params = [];
  const { status, date, search } = req.query;
  if (status && status !== 'all') { where.push('r.status = ?'); params.push(status); }
  if (date) { where.push('r.date = ?'); params.push(date); }
  if (search) { where.push(`(r.customer_name LIKE ? OR r.phone LIKE ? OR r.reservation_code LIKE ?)`); const q = `%${search}%`; params.push(q, q, q); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT r.*, t.number AS table_number, t.capacity FROM reservations r
     LEFT JOIN dining_tables t ON t.id = r.table_id ${whereSql}
     ORDER BY r.date DESC, r.time DESC LIMIT 200`, ...params
  );
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) c FROM reservations GROUP BY status').map((r) => [r.status, r.c]));
  res.json({ reservations: rows, counts });
});

router.post('/reservations', requirePermission('reservations'), (req, res) => {
  const name = String(req.body.customer_name || '').trim();
  const date = String(req.body.date || '');
  const time = String(req.body.time || '');
  const guests = parseInt(req.body.guests, 10);
  if (!name) return res.status(400).json({ error: 'Customer name is required.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'Valid date and time are required.' });
  if (!guests || guests < 1) return res.status(400).json({ error: 'Valid guest count is required.' });
  const count = get('SELECT COUNT(*) c FROM reservations').c;
  const r = run(
    `INSERT INTO reservations (reservation_code, customer_name, phone, email, guests, table_id, date, time, status, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    `RSV-${String(count + 1).padStart(4, '0')}`, name, String(req.body.phone || ''), String(req.body.email || ''),
    guests, req.body.table_id ? Number(req.body.table_id) : null, date, time,
    ['pending', 'confirmed', 'seated', 'completed', 'cancelled'].includes(req.body.status) ? req.body.status : 'pending',
    String(req.body.notes || '').slice(0, 500)
  );
  res.status(201).json({ reservation: get('SELECT * FROM reservations WHERE id = ?', r.lastInsertRowid) });
});

router.patch('/reservations/:id/status', requirePermission('reservations'), (req, res) => {
  const reservation = get('SELECT * FROM reservations WHERE id = ?', Number(req.params.id));
  if (!reservation) return res.status(404).json({ error: 'Reservation not found.' });
  const status = req.body.status;
  if (!['pending', 'confirmed', 'seated', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid reservation status.' });
  run('UPDATE reservations SET status = ? WHERE id = ?', status, reservation.id);
  if (reservation.table_id) {
    if (status === 'seated') run(`UPDATE dining_tables SET status = 'occupied' WHERE id = ?`, reservation.table_id);
    if (['completed', 'cancelled'].includes(status)) {
      const table = get('SELECT * FROM dining_tables WHERE id = ?', reservation.table_id);
      if (table && !table.current_order_id) run(`UPDATE dining_tables SET status = 'available' WHERE id = ?`, reservation.table_id);
    }
    if (status === 'confirmed' && reservation.date === isoDate(new Date())) {
      run(`UPDATE dining_tables SET status = 'reserved' WHERE id = ? AND status = 'available'`, reservation.table_id);
    }
  }
  res.json({ reservation: get('SELECT * FROM reservations WHERE id = ?', reservation.id) });
});

router.delete('/reservations/:id', requirePermission('reservations'), (req, res) => {
  run('DELETE FROM reservations WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ─────────────────────────── CUSTOMERS ───────────────────────────
router.get('/customers', requirePermission('customers'), (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const where = search ? 'WHERE c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?' : '';
  const params = search ? [search, search, search] : [];
  const rows = all(
    `SELECT c.*, COUNT(o.id) AS total_orders,
            COALESCE(SUM(CASE WHEN o.status='completed' THEN o.total ELSE 0 END),0) AS total_spent,
            MAX(o.created_at) AS last_order
     FROM customers c LEFT JOIN orders o ON o.customer_id = c.id ${where}
     GROUP BY c.id ORDER BY total_spent DESC, c.name`, ...params
  );
  const summary = get(`SELECT COUNT(*) count, COALESCE(SUM(loyalty_points),0) points FROM customers`);
  res.json({ customers: rows, summary });
});

router.get('/customers/:id', requirePermission('customers'), (req, res) => {
  const customer = get('SELECT * FROM customers WHERE id = ?', Number(req.params.id));
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const orders = all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50', customer.id);
  const stats = get(
    `SELECT COUNT(*) total_orders, COALESCE(SUM(CASE WHEN status='completed' THEN total ELSE 0 END),0) total_spent,
            COALESCE(AVG(CASE WHEN status='completed' THEN total END),0) avg_order, MAX(created_at) last_order
     FROM orders WHERE customer_id = ?`, customer.id
  );
  res.json({ customer, orders, stats, addresses: all('SELECT * FROM addresses WHERE customer_id = ?', customer.id) });
});

router.post('/customers', requirePermission('customers'), asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!name) throw httpError('Customer name is required.');
  if (phone && get('SELECT id FROM customers WHERE phone = ?', phone)) throw httpError('A customer with this phone already exists.', 409);
  const r = run('INSERT INTO customers (name, phone, email, address, city, notes) VALUES (?,?,?,?,?,?)',
    name, phone || null, String(req.body.email || '') || null, String(req.body.address || '') || null,
    String(req.body.city || 'Lahore'), String(req.body.notes || '') || null);
  res.status(201).json({ customer: get('SELECT * FROM customers WHERE id = ?', r.lastInsertRowid) });
}));

router.put('/customers/:id', requirePermission('customers'), (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  run('UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, city = ?, notes = ? WHERE id = ?',
    String(req.body.name || c.name).trim(), String(req.body.phone || c.phone || '') || null,
    String(req.body.email || c.email || '') || null, String(req.body.address || c.address || '') || null,
    String(req.body.city || c.city || 'Lahore'), String(req.body.notes ?? c.notes ?? '') || null, c.id);
  res.json({ customer: get('SELECT * FROM customers WHERE id = ?', c.id) });
});

router.delete('/customers/:id', requireRole('admin', 'manager'), (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  run('DELETE FROM customers WHERE id = ?', c.id);
  res.json({ ok: true });
});

// ─────────────────────────── STAFF ───────────────────────────
router.get('/staff', requirePermission('staff'), (req, res) => {
  const rows = all(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.salary, u.join_date, u.status, u.color, u.created_at,
            COUNT(o.id) AS orders_handled, COALESCE(SUM(CASE WHEN o.status='completed' THEN o.total ELSE 0 END),0) AS sales_handled
     FROM users u LEFT JOIN orders o ON o.staff_id = u.id
     GROUP BY u.id ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name`
  );
  res.json({ staff: rows });
});

const ROLES = ['admin', 'manager', 'cashier', 'waiter', 'kitchen'];
function validateStaffInput(body, isNew) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (name.length < 2) return 'Name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'A valid email is required.';
  if (!ROLES.includes(body.role)) return 'Select a valid role.';
  if (isNew && String(body.password || '').length < 6) return 'Password must be at least 6 characters.';
  if (body.password && String(body.password).length < 6) return 'Password must be at least 6 characters.';
  return null;
}

router.post('/staff', requireRole('admin'), asyncHandler((req, res) => {
  const msg = validateStaffInput(req.body, true);
  if (msg) throw httpError(msg);
  const email = String(req.body.email).trim().toLowerCase();
  if (get('SELECT id FROM users WHERE LOWER(email) = ?', email)) throw httpError('An account with this email already exists.', 409);
  const r = run(
    'INSERT INTO users (name, email, password_hash, role, phone, salary, join_date, status, color) VALUES (?,?,?,?,?,?,?,?,?)',
    String(req.body.name).trim(), email, bcrypt.hashSync(String(req.body.password), 10), req.body.role,
    String(req.body.phone || '') || null, num(req.body.salary), req.body.join_date || isoDate(new Date()),
    req.body.status === 'inactive' ? 'inactive' : 'active', String(req.body.color || '#C9A227')
  );
  res.status(201).json({ staff: get('SELECT id, name, email, role, phone, salary, join_date, status, color FROM users WHERE id = ?', r.lastInsertRowid) });
}));

router.put('/staff/:id', requireRole('admin'), asyncHandler((req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!user) throw httpError('Staff member not found.', 404);
  const msg = validateStaffInput({ ...req.body, password: req.body.password || undefined }, false);
  if (msg) throw httpError(msg);
  const email = String(req.body.email).trim().toLowerCase();
  const dup = get('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', email, user.id);
  if (dup) throw httpError('An account with this email already exists.', 409);
  if (user.id === req.staff.id && (req.body.role !== 'admin' || req.body.status === 'inactive')) {
    throw httpError('You cannot remove your own administrator access.');
  }
  run('UPDATE users SET name = ?, email = ?, role = ?, phone = ?, salary = ?, join_date = ?, status = ?, color = ? WHERE id = ?',
    String(req.body.name).trim(), email, req.body.role, String(req.body.phone || '') || null,
    num(req.body.salary), req.body.join_date || user.join_date, req.body.status === 'inactive' ? 'inactive' : 'active',
    String(req.body.color || user.color), user.id);
  if (req.body.password) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(String(req.body.password), 10), user.id);
  }
  res.json({ staff: get('SELECT id, name, email, role, phone, salary, join_date, status, color FROM users WHERE id = ?', user.id) });
}));

router.delete('/staff/:id', requireRole('admin'), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Staff member not found.' });
  if (user.id === req.staff.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  run('DELETE FROM users WHERE id = ?', user.id);
  res.json({ ok: true });
});

// ─────────────────────────── COUPONS ───────────────────────────
router.get('/coupons', requirePermission('menu'), (req, res) => {
  res.json({ coupons: all('SELECT * FROM coupons ORDER BY active DESC, id DESC') });
});

router.post('/coupons', requireRole('admin', 'manager'), (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().replace(/\s+/g, '');
  const type = req.body.type === 'fixed' ? 'fixed' : 'percent';
  const value = num(req.body.value);
  if (!code) return res.status(400).json({ error: 'Coupon code is required.' });
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return res.status(400).json({ error: 'Use 3–20 letters, numbers, - or _.' });
  if (value <= 0) return res.status(400).json({ error: 'Discount value must be greater than zero.' });
  if (type === 'percent' && value > 100) return res.status(400).json({ error: 'Percentage cannot exceed 100.' });
  if (get('SELECT id FROM coupons WHERE UPPER(code) = ?', code)) return res.status(409).json({ error: 'That coupon code already exists.' });
  const r = run('INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit, active, expires_at) VALUES (?,?,?,?,?,?,?,?)',
    code, type, value, num(req.body.min_order), req.body.max_discount ? num(req.body.max_discount) : null,
    req.body.usage_limit ? parseInt(req.body.usage_limit, 10) : null, req.body.active === false ? 0 : 1,
    req.body.expires_at || null);
  res.status(201).json({ coupon: get('SELECT * FROM coupons WHERE id = ?', r.lastInsertRowid) });
});

router.put('/coupons/:id', requireRole('admin', 'manager'), (req, res) => {
  const c = get('SELECT * FROM coupons WHERE id = ?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Coupon not found.' });
  run('UPDATE coupons SET active = ?, value = ?, min_order = ?, max_discount = ?, usage_limit = ?, expires_at = ? WHERE id = ?',
    req.body.active !== undefined ? (req.body.active ? 1 : 0) : c.active,
    req.body.value !== undefined ? num(req.body.value, c.value) : c.value,
    req.body.min_order !== undefined ? num(req.body.min_order) : c.min_order,
    req.body.max_discount ? num(req.body.max_discount) : null,
    req.body.usage_limit ? parseInt(req.body.usage_limit, 10) : null,
    req.body.expires_at || null, c.id);
  res.json({ coupon: get('SELECT * FROM coupons WHERE id = ?', c.id) });
});

router.delete('/coupons/:id', requireRole('admin', 'manager'), (req, res) => {
  run('DELETE FROM coupons WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ─────────────────────────── CONTACT MESSAGES ───────────────────────────
router.get('/messages', requirePermission('settings'), (req, res) => {
  res.json({ messages: all('SELECT * FROM contact_messages ORDER BY created_at DESC') });
});
router.patch('/messages/:id', requirePermission('settings'), (req, res) => {
  run(`UPDATE contact_messages SET status = ? WHERE id = ?`, req.body.status === 'read' ? 'read' : 'new', Number(req.params.id));
  res.json({ ok: true });
});
router.delete('/messages/:id', requirePermission('settings'), (req, res) => {
  run('DELETE FROM contact_messages WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ─────────────────────────── SETTINGS ───────────────────────────
const EDITABLE_SETTINGS = [
  'restaurant_name', 'tagline', 'address', 'phone', 'email', 'website', 'currency', 'currency_symbol',
  'tax_rate', 'tax_label', 'delivery_fee', 'min_order', 'receipt_footer', 'receipt_header', 'order_prefix',
  'opening_hours', 'socials', 'logo', 'reservation_notice', 'service_charge', 'online_payment_enabled', 'maintenance_mode'
];

router.get('/settings', requirePermission('settings'), (req, res) => {
  const rows = all('SELECT * FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json({ settings: obj });
});

router.put('/settings', requirePermission('settings'), asyncHandler((req, res) => {
  if (req.staff.role !== 'admin' && req.staff.role !== 'manager') throw httpError('Only administrators can change settings.', 403);
  const body = req.body || {};
  if (body.tax_rate !== undefined && (num(body.tax_rate) < 0 || num(body.tax_rate) > 50)) throw httpError('Tax rate must be between 0 and 50.');
  if (body.delivery_fee !== undefined && num(body.delivery_fee) < 0) throw httpError('Delivery fee cannot be negative.');
  transaction(() => {
    for (const key of EDITABLE_SETTINGS) {
      if (body[key] === undefined) continue;
      let value = body[key];
      if (['opening_hours', 'socials'].includes(key) && typeof value === 'object') value = JSON.stringify(value);
      setSetting(key, value);
    }
  });
  const rows = all('SELECT * FROM settings');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json({ settings: obj, message: 'Settings saved.' });
}));

router.post('/settings/password', asyncHandler((req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  if (next.length < 8) throw httpError('New password must be at least 8 characters.');
  const user = get('SELECT * FROM users WHERE id = ?', req.staff.id);
  if (!bcrypt.compareSync(current, user.password_hash)) throw httpError('Current password is incorrect.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(next, 10), user.id);
  res.json({ ok: true, message: 'Password updated.' });
}));

// ─────────────────────────── IMAGE UPLOAD ───────────────────────────
router.post('/upload', requirePermission('menu'), (req, res) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const filename = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    try {
      run('INSERT INTO uploads (filename, mime, size, data) VALUES (?,?,?,?)',
        filename, req.file.mimetype, req.file.buffer.byteLength, req.file.buffer);
      res.json({ url: `/uploads/${filename}`, filename });
    } catch (e) {
      res.status(500).json({ error: 'Could not store the image.' });
    }
  });
});

// ─────────────────────────── BACKUP ───────────────────────────
router.get('/backup', requireRole('admin'), (req, res) => {
  try {
    require('../db').exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const stamp = now().replace(/[-: ]/g, '').slice(0, 14);
    res.download(DB_PATH, `saffron-house-backup-${stamp}.db`);
  } catch (err) {
    res.status(500).json({ error: 'Could not create backup.' });
  }
});

router.post('/restore', requireRole('admin'), (req, res) => {
  if (IS_SERVERLESS) {
    return res.status(400).json({ error: 'Database restore is not available in the serverless demo deployment. Restore on a local machine, then reseed/redeploy.' });
  }
  const restoreUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single('database');
  restoreUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Choose a .db backup file.' });
    if (req.file.buffer.slice(0, 15).toString() !== 'SQLite format 3') {
      return res.status(400).json({ error: 'That is not a valid SQLite database file.' });
    }
    const backups = path.join(path.dirname(DB_PATH), 'backups');
    fs.mkdirSync(backups, { recursive: true });
    const currentBackup = path.join(backups, `pre-restore-${Date.now()}.db`);
    try {
      require('../db').exec('PRAGMA wal_checkpoint(TRUNCATE);');
      fs.copyFileSync(DB_PATH, currentBackup);
      fs.writeFileSync(DB_PATH, req.file.buffer);
      res.json({
        ok: true,
        message: 'Backup restored. Restart the server (Ctrl+C, then npm start) to load the restored data.',
        safety_backup: path.basename(currentBackup)
      });
    } catch (e) {
      res.status(500).json({ error: 'Restore failed. Your current database was not modified.' });
    }
  });
});

module.exports = router;
