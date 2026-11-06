'use strict';
/** Public storefront APIs — menu, online ordering, reservations, contact, tracking and customer account. */
const express = require('express');
const { all, get, run, now, nextReservationCode, getSettings } = require('../db');
const { getSiteContent, getTablesAvailability, serializeProduct } = require('../lib/catalog');
const { createOrder, validateCoupon, getOrderDetails } = require('../lib/orders');
const { asyncHandler, requireCustomer, httpError } = require('../middleware/auth');

const router = express.Router();

const digits = (s) => String(s || '').replace(/\D/g, '');
const esc = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

router.get('/site', (req, res) => {
  res.json(getSiteContent());
});

router.get('/menu', (req, res) => {
  const { categories, products } = require('../lib/catalog').getCatalog({ publicOnly: true });
  res.json({ categories, products, settings: getSettings(true) });
});

router.get('/products/:slug', (req, res) => {
  const product = get(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.slug = ?`, req.params.slug
  );
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const related = all(
    `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id
     WHERE p.category_id = ? AND p.id != ? AND p.available = 1 LIMIT 4`, product.category_id, product.id
  ).map((p) => serializeProduct(p, false));
  res.json({ product: serializeProduct(product), related });
});

router.get('/tables/availability', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const time = req.query.time || '19:00';
  res.json({ tables: getTablesAvailability(date, time) });
});

router.post('/coupon/validate', (req, res) => {
  const subtotal = Number(req.body.subtotal) || 0;
  const result = validateCoupon(req.body.code, subtotal);
  if (!result.valid) return res.status(400).json({ error: result.message });
  res.json({ code: result.coupon.code, discount: result.discount, message: result.message });
});

router.post('/orders', asyncHandler((req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  if (name.length < 2) throw httpError('Please enter your name.');
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) throw httpError('Please enter a valid phone number.');
  const type = body.type === 'delivery' ? 'delivery' : 'takeaway';
  if (type === 'delivery' && String(body.address || '').trim().length < 10) {
    throw httpError('Please enter a complete delivery address.');
  }
  const method = ['cash', 'card', 'demo'].includes(body.paymentMethod) ? body.paymentMethod : 'cash';
  const paid = method === 'card' || method === 'demo';
  const settings = getSettings();
  const subtotalGuess = (Array.isArray(body.items) ? body.items : []).reduce((s, i) => {
    const p = get('SELECT price FROM products WHERE id = ?', Number(i.product_id || i.id));
    return s + (p ? p.price * Math.max(1, Number(i.qty) || 1) : 0);
  }, 0);
  if (settings.min_order && subtotalGuess < Number(settings.min_order)) {
    throw httpError(`Minimum order value is Rs. ${Number(settings.min_order).toLocaleString()}.`);
  }
  const sessionCustomer = req.session?.customer?.id || null;
  const customer = sessionCustomer ? get('SELECT * FROM customers WHERE id = ?', sessionCustomer) : null;

  const result = createOrder({
    items: body.items,
    type,
    customerId: sessionCustomer,
    customer: customer ? { name: customer.name, phone: customer.phone, address: body.address || customer.address } : { name, phone, address: body.address },
    name: customer ? customer.name : name,
    phone: customer ? customer.phone : phone,
    address: body.address,
    notes: body.notes,
    couponCode: body.couponCode,
    paymentMethod: method,
    paymentStatus: paid ? 'paid' : 'unpaid',
    status: 'pending',
    source: 'online',
    staffId: null
  });

  // Digital demo payments get a simulated transaction reference (no real card data stored)
  let txnRef = null;
  if (paid) {
    txnRef = `DEMO-${Date.now().toString(36).toUpperCase()}`;
    run(`UPDATE orders SET notes = TRIM(COALESCE(notes,'') || ' [Demo payment ' || ? || ']') WHERE id = ?`, txnRef, result.orderId);
  }

  res.status(201).json({
    order: {
      id: result.orderId,
      order_number: result.orderNumber,
      total: result.totals.total,
      payment_status: paid ? 'paid' : 'unpaid',
      payment_method: method,
      type,
      status: 'pending',
      transaction_reference: txnRef
    }
  });
}));

router.get('/orders/:number/track', (req, res) => {
  const order = get('SELECT * FROM orders WHERE order_number = ?', req.params.number.trim());
  if (!order) return res.status(404).json({ error: 'No order found with that number.' });
  const isStaff = !!req.session?.staff;
  const isOwner = req.session?.customer && req.session.customer.id === order.customer_id;
  const phone = digits(req.query.phone);
  const phoneMatches = phone && (digits(order.phone) === phone || digits(order.phone).endsWith(phone.slice(-7)));
  if (!isStaff && !isOwner && !phoneMatches) {
    return res.status(403).json({ error: 'Please enter the phone number used for this order.' });
  }
  const details = getOrderDetails(order.id);
  res.json({
    order: {
      order_number: details.order_number,
      status: details.status,
      payment_status: details.payment_status,
      payment_method: details.payment_method,
      type: details.type,
      table_number: details.table_number,
      customer_name: details.customer_name,
      subtotal: details.subtotal,
      tax: details.tax,
      discount: details.discount,
      delivery_fee: details.delivery_fee,
      total: details.total,
      notes: details.notes,
      created_at: details.created_at,
      updated_at: details.updated_at,
      completed_at: details.completed_at,
      items: details.items.map((i) => ({
        name: i.name, qty: i.qty, unit_price: i.unit_price, line_total: i.line_total,
        addons: i.addons, notes: i.notes
      }))
    }
  });
});

router.post('/reservations', asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const date = String(req.body.date || '');
  const time = String(req.body.time || '');
  const guests = parseInt(req.body.guests, 10);
  if (name.length < 2) throw httpError('Please enter your name.');
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) throw httpError('Please enter a valid phone number.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError('Please choose a reservation date.');
  if (!/^\d{2}:\d{2}$/.test(time)) throw httpError('Please choose a reservation time.');
  if (!guests || guests < 1 || guests > 30) throw httpError('Please select a valid party size.');
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) throw httpError('Please choose today or a future date.');
  if (date === today) {
    const nowHM = now().slice(11, 16);
    if (time < nowHM) throw httpError('Please choose a future time for today.');
  }
  const settings = getSettings();
  // Pick requested table if available, otherwise first suitable free table
  let tableId = req.body.table_id ? Number(req.body.table_id) : null;
  if (tableId) {
    const clash = get(`SELECT id FROM reservations WHERE table_id = ? AND date = ? AND time = ? AND status IN ('pending','confirmed','seated')`, tableId, date, time);
    if (clash) tableId = null;
  }
  if (!tableId) {
    const candidates = all(`SELECT id, capacity FROM dining_tables ORDER BY capacity`);
    const busy = new Set(all(`SELECT table_id FROM reservations WHERE date = ? AND time = ? AND status IN ('pending','confirmed','seated')`, date, time).map((r) => r.table_id));
    const suitable = candidates.find((t) => !busy.has(t.id) && t.capacity >= guests);
    tableId = suitable ? suitable.id : null;
  }
  const code = nextReservationCode();
  run(`INSERT INTO reservations (reservation_code, customer_name, phone, email, guests, table_id, date, time, status, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    code, name, phone, String(req.body.email || '').slice(0, 160), guests, tableId, date, time, 'pending',
    String(req.body.notes || '').slice(0, 500));
  const table = tableId ? get('SELECT * FROM dining_tables WHERE id = ?', tableId) : null;
  if (date === today && tableId) run(`UPDATE dining_tables SET status = 'reserved' WHERE id = ? AND status = 'available'`, tableId);
  res.status(201).json({
    reservation: {
      code, name, date, time, guests, table: table?.number || null,
      status: 'pending',
      notice: settings.reservation_notice
    }
  });
}));

router.post('/contact', asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const message = String(req.body.message || '').trim();
  if (name.length < 2) throw httpError('Please enter your name.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError('Please enter a valid email address.');
  if (!email && !String(req.body.phone || '').trim()) throw httpError('Please provide an email or phone number.');
  if (message.length < 10) throw httpError('Please tell us a little more (at least 10 characters).');
  run('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)',
    name, email || null, String(req.body.phone || '').trim() || null,
    String(req.body.subject || 'General enquiry').slice(0, 160), message.slice(0, 3000));
  res.status(201).json({ ok: true, message: 'Thank you — our team will get back to you within one business day.' });
}));

// ───────────── Customer account ─────────────
router.get('/customer/orders', requireCustomer, (req, res) => {
  const rows = all(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
     FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 100`, req.customer.id
  );
  res.json({ orders: rows.map((o) => ({ ...o, items: all('SELECT * FROM order_items WHERE order_id = ?', o.id) })) });
});

router.get('/customer/orders/:id', requireCustomer, (req, res) => {
  const details = getOrderDetails(Number(req.params.id));
  if (!details || details.customer_id !== req.customer.id) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order: details });
});

router.post('/customer/orders/:id/reorder', requireCustomer, (req, res) => {
  const order = get('SELECT * FROM orders WHERE id = ? AND customer_id = ?', Number(req.params.id), req.customer.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const items = all(
    `SELECT oi.product_id, oi.qty, oi.addons_json, oi.notes, p.name, p.price, p.image, p.available
     FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`, order.id
  ).map((i) => ({
    product_id: i.product_id, qty: i.qty, name: i.name, price: i.price, image: i.image,
    available: !!i.available, notes: i.notes,
    addons: i.addons_json ? JSON.parse(i.addons_json) : null
  }));
  res.json({ items, available: items.every((i) => i.available) });
});

router.get('/customer/addresses', requireCustomer, (req, res) => {
  res.json({ addresses: all('SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, id', req.customer.id) });
});

router.post('/customer/addresses', requireCustomer, (req, res) => {
  const address = String(req.body.address || '').trim();
  if (address.length < 10) return res.status(400).json({ error: 'Please enter a complete address.' });
  const isDefault = req.body.is_default ? 1 : 0;
  if (isDefault) run('UPDATE addresses SET is_default = 0 WHERE customer_id = ?', req.customer.id);
  const r = run('INSERT INTO addresses (customer_id, label, address, city, phone, is_default) VALUES (?,?,?,?,?,?)',
    req.customer.id, String(req.body.label || 'Home').slice(0, 40), address,
    String(req.body.city || 'Lahore').slice(0, 60), String(req.body.phone || '').slice(0, 30), isDefault);
  res.status(201).json({ address: get('SELECT * FROM addresses WHERE id = ?', r.lastInsertRowid) });
});

router.put('/customer/addresses/:id', requireCustomer, (req, res) => {
  const addr = get('SELECT * FROM addresses WHERE id = ? AND customer_id = ?', Number(req.params.id), req.customer.id);
  if (!addr) return res.status(404).json({ error: 'Address not found.' });
  const address = String(req.body.address || '').trim();
  if (address.length < 10) return res.status(400).json({ error: 'Please enter a complete address.' });
  if (req.body.is_default) run('UPDATE addresses SET is_default = 0 WHERE customer_id = ?', req.customer.id);
  run('UPDATE addresses SET label = ?, address = ?, city = ?, phone = ?, is_default = ? WHERE id = ?',
    String(req.body.label || addr.label).slice(0, 40), address, String(req.body.city || 'Lahore').slice(0, 60),
    String(req.body.phone || '').slice(0, 30), req.body.is_default ? 1 : 0, addr.id);
  res.json({ address: get('SELECT * FROM addresses WHERE id = ?', addr.id) });
});

router.delete('/customer/addresses/:id', requireCustomer, (req, res) => {
  const addr = get('SELECT * FROM addresses WHERE id = ? AND customer_id = ?', Number(req.params.id), req.customer.id);
  if (!addr) return res.status(404).json({ error: 'Address not found.' });
  run('DELETE FROM addresses WHERE id = ?', addr.id);
  res.json({ ok: true });
});

// Email-capture / newsletter (used in footer)
router.post('/newsletter', (req, res) => {
  const email = String(req.body.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  res.json({ ok: true, message: 'You are on the list. Welcome to the Saffron table.' });
});

module.exports = router;
