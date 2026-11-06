'use strict';
/** Inventory, suppliers, purchasing and expenses. */
const express = require('express');
const { all, get, run, transaction, now, dateOnly, nextPurchaseNumber } = require('../db');
const { requireStaff, requirePermission, requireRole, asyncHandler, httpError } = require('../middleware/auth');
const { round } = require('../lib/orders');

const router = express.Router();
router.use(requireStaff);

const isoDate = (d) => dateOnly(d);

// ─────────────────────────── INGREDIENTS ───────────────────────────
router.get('/ingredients', requirePermission('inventory'), (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const where = search ? 'WHERE i.name LIKE ? OR i.category LIKE ?' : '';
  const params = search ? [search, search] : [];
  const ingredients = all(
    `SELECT i.*, s.name AS supplier_name,
       ROUND(i.stock_qty * i.purchase_price, 2) AS stock_value,
       CASE WHEN i.stock_qty <= 0 THEN 'out' WHEN i.stock_qty <= i.min_stock THEN 'low' ELSE 'ok' END AS stock_status
     FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id ${where}
     ORDER BY stock_status, i.name`, ...params
  );
  const summary = get(
    `SELECT COUNT(*) count, ROUND(COALESCE(SUM(stock_qty * purchase_price),0),2) value,
            SUM(CASE WHEN stock_qty <= min_stock THEN 1 ELSE 0 END) low,
            SUM(CASE WHEN stock_qty <= 0 THEN 1 ELSE 0 END) out,
            SUM(CASE WHEN expiry_date IS NOT NULL AND date(expiry_date) <= date('now','localtime','+7 day') THEN 1 ELSE 0 END) expiring
     FROM ingredients`
  );
  res.json({ ingredients, summary, suppliers: all('SELECT id, name FROM suppliers ORDER BY name') });
});

router.post('/ingredients', requirePermission('inventory'), asyncHandler((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError('Ingredient name is required.');
  const unit = String(req.body.unit || 'kg').trim();
  if (!unit) throw httpError('Select a measurement unit.');
  const stock = Number(req.body.stock_qty) || 0;
  if (stock < 0) throw httpError('Opening stock cannot be negative.');
  const r = run(
    `INSERT INTO ingredients (name, unit, stock_qty, min_stock, purchase_price, supplier_id, expiry_date, category)
     VALUES (?,?,?,?,?,?,?,?)`,
    name, unit, stock, Math.max(0, Number(req.body.min_stock) || 0), Math.max(0, Number(req.body.purchase_price) || 0),
    req.body.supplier_id ? Number(req.body.supplier_id) : null, req.body.expiry_date || null,
    String(req.body.category || 'General')
  );
  if (stock > 0) {
    run('INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by) VALUES (?,?,?,?,?,?,?)',
      r.lastInsertRowid, 'opening', stock, Number(req.body.purchase_price) || 0, 'OPENING', 'Opening stock entered', req.staff.id);
  }
  res.status(201).json({ ingredient: get('SELECT * FROM ingredients WHERE id = ?', r.lastInsertRowid) });
}));

router.put('/ingredients/:id', requirePermission('inventory'), asyncHandler((req, res) => {
  const ing = get('SELECT * FROM ingredients WHERE id = ?', Number(req.params.id));
  if (!ing) throw httpError('Ingredient not found.', 404);
  const name = String(req.body.name || ing.name).trim();
  if (!name) throw httpError('Ingredient name is required.');
  run(
    `UPDATE ingredients SET name = ?, unit = ?, min_stock = ?, purchase_price = ?, supplier_id = ?, expiry_date = ?, category = ? WHERE id = ?`,
    name, String(req.body.unit || ing.unit),
    Math.max(0, req.body.min_stock !== undefined ? Number(req.body.min_stock) : ing.min_stock),
    Math.max(0, req.body.purchase_price !== undefined ? Number(req.body.purchase_price) : ing.purchase_price),
    req.body.supplier_id ? Number(req.body.supplier_id) : null, req.body.expiry_date || null,
    String(req.body.category || ing.category), ing.id
  );
  res.json({ ingredient: get('SELECT * FROM ingredients WHERE id = ?', ing.id) });
}));

router.delete('/ingredients/:id', requireRole('admin', 'manager'), (req, res) => {
  const ing = get('SELECT * FROM ingredients WHERE id = ?', Number(req.params.id));
  if (!ing) return res.status(404).json({ error: 'Ingredient not found.' });
  run('DELETE FROM ingredients WHERE id = ?', ing.id);
  res.json({ ok: true });
});

// ─────────────────────────── STOCK MOVEMENTS ───────────────────────────
router.get('/inventory/transactions', requirePermission('inventory'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.ingredient_id) { where.push('t.ingredient_id = ?'); params.push(Number(req.query.ingredient_id)); }
  if (req.query.type && req.query.type !== 'all') { where.push('t.type = ?'); params.push(req.query.type); }
  if (req.query.from) { where.push('date(t.created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(t.created_at) <= ?'); params.push(req.query.to); }
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 150));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const transactions = all(
    `SELECT t.*, i.name AS ingredient_name, i.unit, u.name AS staff_name
     FROM inventory_transactions t JOIN ingredients i ON i.id = t.ingredient_id
     LEFT JOIN users u ON u.id = t.created_by ${whereSql}
     ORDER BY t.created_at DESC, t.id DESC LIMIT ?`, ...params, limit
  );
  res.json({ transactions });
});

router.post('/inventory/transactions', requirePermission('inventory'), asyncHandler((req, res) => {
  const ing = get('SELECT * FROM ingredients WHERE id = ?', Number(req.body.ingredient_id));
  if (!ing) throw httpError('Select a valid ingredient.');
  const type = req.body.type;
  if (!['receive', 'issue', 'wastage', 'adjustment', 'return'].includes(type)) throw httpError('Select a valid transaction type.');
  let qty = Number(req.body.qty);
  if (!Number.isFinite(qty) || qty === 0) throw httpError('Enter a quantity.');
  let change = 0;
  if (type === 'receive' || type === 'return') change = Math.abs(qty);
  else if (type === 'issue' || type === 'wastage') change = -Math.abs(qty);
  else change = qty;
  const newQty = round(Number(ing.stock_qty) + change);
  if (newQty < 0) throw httpError(`Only ${ing.stock_qty} ${ing.unit} of ${ing.name} available.`, 400);
  transaction(() => {
    run('UPDATE ingredients SET stock_qty = ? WHERE id = ?', newQty, ing.id);
    run(
      `INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      ing.id, type, change, Number(req.body.unit_cost) || ing.purchase_price,
      String(req.body.reference || '').slice(0, 80) || null, String(req.body.notes || '').slice(0, 400) || null, req.staff.id
    );
  });
  res.status(201).json({ ingredient: get('SELECT * FROM ingredients WHERE id = ?', ing.id), message: 'Stock updated.' });
}));

// ─────────────────────────── SUPPLIERS ───────────────────────────
router.get('/suppliers', requirePermission('suppliers'), (req, res) => {
  const suppliers = all(
    `SELECT s.*, COUNT(p.id) AS purchase_count, COALESCE(SUM(p.total),0) AS total_purchased,
            COALESCE(SUM(p.paid_amount),0) AS total_paid
     FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id
     GROUP BY s.id ORDER BY s.name`
  );
  res.json({
    suppliers,
    summary: get(`SELECT COUNT(*) count, ROUND(COALESCE(SUM(outstanding_balance),0),2) outstanding FROM suppliers`)
  });
});

router.post('/suppliers', requirePermission('suppliers'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Supplier name is required.' });
  const r = run(
    'INSERT INTO suppliers (name, contact_person, phone, email, address, notes) VALUES (?,?,?,?,?,?)',
    name, String(req.body.contact_person || '') || null, String(req.body.phone || '') || null,
    String(req.body.email || '') || null, String(req.body.address || '') || null, String(req.body.notes || '') || null
  );
  res.status(201).json({ supplier: get('SELECT * FROM suppliers WHERE id = ?', r.lastInsertRowid) });
});

router.put('/suppliers/:id', requirePermission('suppliers'), (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id = ?', Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Supplier not found.' });
  run('UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?',
    String(req.body.name || s.name).trim(), String(req.body.contact_person || '') || null,
    String(req.body.phone || '') || null, String(req.body.email || '') || null,
    String(req.body.address || '') || null, String(req.body.notes || '') || null, s.id);
  res.json({ supplier: get('SELECT * FROM suppliers WHERE id = ?', s.id) });
});

router.delete('/suppliers/:id', requireRole('admin', 'manager'), (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id = ?', Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Supplier not found.' });
  const count = get('SELECT COUNT(*) c FROM purchases WHERE supplier_id = ?', s.id).c;
  if (count) return res.status(409).json({ error: 'This supplier has purchase history and cannot be deleted.' });
  run('DELETE FROM suppliers WHERE id = ?', s.id);
  res.json({ ok: true });
});

// ─────────────────────────── PURCHASES ───────────────────────────
router.get('/purchases', requirePermission('suppliers'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status && req.query.status !== 'all') { where.push('p.status = ?'); params.push(req.query.status); }
  if (req.query.search) {
    where.push('(p.po_number LIKE ? OR s.name LIKE ?)');
    const q = `%${req.query.search}%`; params.push(q, q);
  }
  if (req.query.from) { where.push('p.order_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('p.order_date <= ?'); params.push(req.query.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const purchases = all(
    `SELECT p.*, s.name AS supplier_name,
       (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${whereSql}
     ORDER BY p.order_date DESC, p.id DESC LIMIT 200`, ...params
  );
  const summary = get(
    `SELECT COUNT(*) count, ROUND(COALESCE(SUM(total),0),2) total, ROUND(COALESCE(SUM(paid_amount),0),2) paid,
            ROUND(COALESCE(SUM(total - paid_amount),0),2) due
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${whereSql}`, ...params
  );
  res.json({ purchases, summary });
});

router.get('/purchases/:id', requirePermission('suppliers'), (req, res) => {
  const purchase = get(`SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email
    FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`, Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Purchase order not found.' });
  purchase.items = all(
    `SELECT pi.*, i.name, i.unit FROM purchase_items pi JOIN ingredients i ON i.id = pi.ingredient_id WHERE pi.purchase_id = ?`, purchase.id
  );
  res.json({ purchase });
});

router.post('/purchases', requirePermission('suppliers'), asyncHandler((req, res) => {
  const supplier = get('SELECT * FROM suppliers WHERE id = ?', Number(req.body.supplier_id));
  if (!supplier) throw httpError('Select a valid supplier.');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw httpError('Add at least one item to the purchase order.');
  const validated = [];
  for (const it of items) {
    const ing = get('SELECT * FROM ingredients WHERE id = ?', Number(it.ingredient_id));
    if (!ing) throw httpError('One of the ingredients no longer exists.');
    const qty = Number(it.qty);
    const cost = Number(it.unit_cost);
    if (!(qty > 0)) throw httpError(`Enter a quantity for ${ing.name}.`);
    if (!(cost >= 0)) throw httpError(`Enter a unit cost for ${ing.name}.`);
    validated.push({ ing, qty, cost, total: round(qty * cost) });
  }
  const subtotal = round(validated.reduce((s, i) => s + i.total, 0));
  const tax = round(Number(req.body.tax) || 0);
  const total = round(subtotal + tax);
  const status = req.body.status === 'received' ? 'received' : 'pending';
  const po = nextPurchaseNumber();
  const result = transaction(() => {
    const r = run(
      `INSERT INTO purchases (po_number, supplier_id, status, order_date, received_date, subtotal, tax, total, paid_amount, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      po, supplier.id, status, req.body.order_date || isoDate(new Date()),
      status === 'received' ? isoDate(new Date()) : null, subtotal, tax, total, 0,
      String(req.body.notes || '').slice(0, 600), req.staff.id
    );
    for (const v of validated) {
      run('INSERT INTO purchase_items (purchase_id, ingredient_id, qty, unit_cost, total) VALUES (?,?,?,?,?)',
        r.lastInsertRowid, v.ing.id, v.qty, v.cost, v.total);
      if (status === 'received') {
        run('UPDATE ingredients SET stock_qty = ROUND(stock_qty + ?, 3), purchase_price = ? WHERE id = ?', v.qty, v.cost, v.ing.id);
        run('INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by) VALUES (?,?,?,?,?,?,?)',
          v.ing.id, 'purchase', v.qty, v.cost, po, `Received from ${supplier.name}`, req.staff.id);
      }
    }
    run('UPDATE suppliers SET outstanding_balance = ROUND(outstanding_balance + ?, 2) WHERE id = ?', total, supplier.id);
    return r.lastInsertRowid;
  });
  res.status(201).json({ purchase: get('SELECT * FROM purchases WHERE id = ?', result), message: status === 'received' ? 'Stock received and inventory updated.' : 'Purchase order created.' });
}));

router.patch('/purchases/:id/receive', requirePermission('suppliers'), asyncHandler((req, res) => {
  const purchase = get(`SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`, Number(req.params.id));
  if (!purchase) throw httpError('Purchase order not found.', 404);
  if (purchase.status === 'received') throw httpError('This purchase has already been received.', 409);
  if (purchase.status === 'cancelled') throw httpError('Cancelled purchases cannot be received.', 409);
  const items = all('SELECT * FROM purchase_items WHERE purchase_id = ?', purchase.id);
  transaction(() => {
    for (const it of items) {
      run('UPDATE ingredients SET stock_qty = ROUND(stock_qty + ?, 3), purchase_price = ? WHERE id = ?', it.qty, it.unit_cost, it.ingredient_id);
      run(`INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by) VALUES (?,?,?,?,?,?,?)`,
        it.ingredient_id, 'purchase', it.qty, it.unit_cost, purchase.po_number, `Received from ${purchase.supplier_name}`, req.staff.id);
    }
    run(`UPDATE purchases SET status = 'received', received_date = ? WHERE id = ?`, isoDate(new Date()), purchase.id);
    run('UPDATE suppliers SET outstanding_balance = ROUND(outstanding_balance + ?, 2) WHERE id = ?', purchase.total, purchase.supplier_id);
  });
  res.json({ purchase: get('SELECT * FROM purchases WHERE id = ?', purchase.id), message: 'Stock received — inventory updated.' });
}));

router.post('/purchases/:id/pay', requirePermission('suppliers'), asyncHandler((req, res) => {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', Number(req.params.id));
  if (!purchase) throw httpError('Purchase order not found.', 404);
  const due = round(purchase.total - purchase.paid_amount);
  const amount = round(Number(req.body.amount));
  if (!(amount > 0)) throw httpError('Enter a valid payment amount.');
  if (amount > due) throw httpError(`Payment exceeds the outstanding balance of Rs. ${due.toLocaleString()}.`);
  transaction(() => {
    run('UPDATE purchases SET paid_amount = ROUND(paid_amount + ?, 2) WHERE id = ?', amount, purchase.id);
    run('UPDATE suppliers SET outstanding_balance = MAX(0, ROUND(outstanding_balance - ?, 2)) WHERE id = ?', amount, purchase.supplier_id);
  });
  res.json({ purchase: get('SELECT * FROM purchases WHERE id = ?', purchase.id), message: 'Supplier payment recorded.' });
}));

router.delete('/purchases/:id', requireRole('admin', 'manager'), (req, res) => {
  const purchase = get('SELECT * FROM purchases WHERE id = ?', Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Purchase order not found.' });
  if (purchase.status === 'received') return res.status(409).json({ error: 'Received purchases cannot be deleted. Adjust stock instead.' });
  transaction(() => {
    run('UPDATE suppliers SET outstanding_balance = MAX(0, ROUND(outstanding_balance - ?, 2)) WHERE id = ?',
      round(purchase.total - purchase.paid_amount), purchase.supplier_id);
    run('DELETE FROM purchases WHERE id = ?', purchase.id);
  });
  res.json({ ok: true });
});

// ─────────────────────────── EXPENSES ───────────────────────────
const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Gas', 'Salaries', 'Ingredients', 'Maintenance', 'Marketing', 'Other'];

router.get('/expenses', requirePermission('expenses'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.category && req.query.category !== 'all') { where.push('category = ?'); params.push(req.query.category); }
  if (req.query.from) { where.push('date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date <= ?'); params.push(req.query.to); }
  if (req.query.search) { where.push('(description LIKE ? OR reference LIKE ?)'); const q = `%${req.query.search}%`; params.push(q, q); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const expenses = all(`SELECT e.*, u.name AS staff_name FROM expenses e LEFT JOIN users u ON u.id = e.created_by ${whereSql} ORDER BY e.date DESC, e.id DESC LIMIT 300`, ...params);
  const byCategory = all(`SELECT category, ROUND(SUM(amount),2) total, COUNT(*) count FROM expenses ${whereSql} GROUP BY category ORDER BY total DESC`, ...params);
  const summary = get(`SELECT COUNT(*) count, ROUND(COALESCE(SUM(amount),0),2) total FROM expenses ${whereSql}`, ...params);
  res.json({ expenses, byCategory, summary, categories: EXPENSE_CATEGORIES });
});

router.post('/expenses', requirePermission('expenses'), asyncHandler((req, res) => {
  const category = String(req.body.category || '');
  if (!EXPENSE_CATEGORIES.includes(category)) throw httpError('Select a valid expense category.');
  const amount = Number(req.body.amount);
  if (!(amount > 0)) throw httpError('Enter a valid expense amount.');
  const date = req.body.date || isoDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError('Enter a valid date.');
  const r = run('INSERT INTO expenses (category, description, amount, date, payment_method, reference, created_by) VALUES (?,?,?,?,?,?,?)',
    category, String(req.body.description || '').slice(0, 300), amount, date,
    String(req.body.payment_method || 'cash'), String(req.body.reference || '').slice(0, 100) || null, req.staff.id);
  res.status(201).json({ expense: get('SELECT * FROM expenses WHERE id = ?', r.lastInsertRowid) });
}));

router.put('/expenses/:id', requirePermission('expenses'), (req, res) => {
  const e = get('SELECT * FROM expenses WHERE id = ?', Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'Expense not found.' });
  const category = req.body.category || e.category;
  if (!EXPENSE_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid expense category.' });
  const amount = req.body.amount !== undefined ? Number(req.body.amount) : e.amount;
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
  run('UPDATE expenses SET category = ?, description = ?, amount = ?, date = ?, payment_method = ?, reference = ? WHERE id = ?',
    category, String(req.body.description ?? e.description ?? ''), amount, req.body.date || e.date,
    String(req.body.payment_method || e.payment_method), String(req.body.reference || '') || null, e.id);
  res.json({ expense: get('SELECT * FROM expenses WHERE id = ?', e.id) });
});

router.delete('/expenses/:id', requireRole('admin', 'manager'), (req, res) => {
  run('DELETE FROM expenses WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
