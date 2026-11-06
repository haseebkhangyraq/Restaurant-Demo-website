'use strict';
/** Reports & analytics — sales, products, P&L, tax, inventory, purchasing, expenses, staff, CSV export. */
const express = require('express');
const { all, get, dateOnly } = require('../db');
const { requireStaff, requirePermission } = require('../middleware/auth');
const { round } = require('../lib/orders');

const router = express.Router();
router.use(requireStaff);

function rangeFromQuery(req) {
  const today = dateOnly(new Date());
  const d = new Date(); d.setDate(d.getDate() - 29);
  let from = req.query.from || dateOnly(d);
  let to = req.query.to || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) from = dateOnly(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) to = today;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

const cogsSubquery = `(SELECT SUM(r.qty * i.purchase_price) FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = p.id)`;

router.get('/reports/sales', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const group = ['day', 'week', 'month'].includes(req.query.group) ? req.query.group : 'day';
  const fmt = group === 'month' ? '%Y-%m' : (group === 'week' ? '%Y-W%W' : '%Y-%m-%d');
  const series = all(
    `SELECT strftime(?, created_at) AS period, ROUND(SUM(total),2) AS revenue, COUNT(*) AS orders,
            ROUND(AVG(total),2) AS avg_order
     FROM orders WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?
     GROUP BY period ORDER BY period`, fmt, from, to
  );
  const summary = get(
    `SELECT COUNT(*) orders, ROUND(COALESCE(SUM(total),0),2) revenue, ROUND(COALESCE(AVG(total),0),2) avg_order,
            ROUND(COALESCE(SUM(subtotal),0),2) subtotal, ROUND(COALESCE(SUM(tax),0),2) tax,
            ROUND(COALESCE(SUM(discount),0),2) discount, ROUND(COALESCE(SUM(delivery_fee),0),2) delivery_fees
     FROM orders WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ?`, from, to
  );
  const itemsSold = get(
    `SELECT COALESCE(SUM(oi.qty),0) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'completed' AND date(o.created_at) BETWEEN ? AND ?`, from, to
  ).qty;
  const byType = all(
    `SELECT type, COUNT(*) orders, ROUND(SUM(total),2) revenue FROM orders
     WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ? GROUP BY type`, from, to
  );
  const byPayment = all(
    `SELECT payment_method, COUNT(*) orders, ROUND(SUM(total),2) revenue FROM orders
     WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ? GROUP BY payment_method`, from, to
  );
  const byStatus = all(
    `SELECT status, COUNT(*) count, ROUND(SUM(total),2) value FROM orders
     WHERE date(created_at) BETWEEN ? AND ? GROUP BY status`, from, to
  );
  const dailyTax = all(
    `SELECT date(created_at) period, ROUND(SUM(tax),2) tax, ROUND(SUM(total),2) total FROM orders
     WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ? GROUP BY date(created_at) ORDER BY period`, from, to
  );
  res.json({ from, to, group, series, summary: { ...summary, items_sold: itemsSold }, byType, byPayment, byStatus, dailyTax });
});

router.get('/reports/products', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const rows = all(
    `SELECT p.id, p.name, p.image, c.name AS category,
            SUM(oi.qty) AS qty, ROUND(SUM(oi.line_total),2) AS revenue,
            ROUND(COALESCE(${cogsSubquery},0), 2) AS unit_cost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status = 'completed' AND date(o.created_at) BETWEEN ? AND ?
     GROUP BY oi.product_id, oi.name ORDER BY revenue DESC LIMIT ?`, from, to, limit
  ).map((r) => {
    const cogs = round((r.unit_cost || 0) * r.qty);
    return { ...r, cogs, profit: round(r.revenue - cogs), margin: r.revenue ? round(((r.revenue - cogs) / r.revenue) * 100) : 0 };
  });
  const categories = all(
    `SELECT COALESCE(c.name,'Uncategorised') category, SUM(oi.qty) qty, ROUND(SUM(oi.line_total),2) revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
     WHERE o.status = 'completed' AND date(o.created_at) BETWEEN ? AND ?
     GROUP BY c.name ORDER BY revenue DESC`, from, to
  );
  res.json({ from, to, products: rows, categories });
});

router.get('/reports/inventory', requirePermission('reports'), (req, res) => {
  const ingredients = all(
    `SELECT i.*, s.name AS supplier_name, ROUND(i.stock_qty * i.purchase_price, 2) AS value
     FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id ORDER BY value DESC`
  );
  const summary = get(
    `SELECT COUNT(*) count, ROUND(COALESCE(SUM(stock_qty * purchase_price),0),2) value,
            SUM(CASE WHEN stock_qty <= min_stock THEN 1 ELSE 0 END) low_stock,
            SUM(CASE WHEN expiry_date IS NOT NULL AND date(expiry_date) <= date('now','localtime','+7 day') THEN 1 ELSE 0 END) expiring
     FROM ingredients`
  );
  const byCategory = all(
    `SELECT category, COUNT(*) count, ROUND(SUM(stock_qty * purchase_price),2) value FROM ingredients GROUP BY category ORDER BY value DESC`
  );
  const movement = all(
    `SELECT type, COUNT(*) count, ROUND(SUM(ABS(qty_change)), 2) qty FROM inventory_transactions
     WHERE created_at >= date('now','localtime','-30 day') GROUP BY type`
  );
  res.json({ ingredients, summary, byCategory, movement });
});

router.get('/reports/purchases', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const purchases = all(
    `SELECT p.*, s.name AS supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.order_date BETWEEN ? AND ? ORDER BY p.order_date DESC`, from, to
  );
  const summary = get(
    `SELECT COUNT(*) count, ROUND(COALESCE(SUM(total),0),2) total, ROUND(COALESCE(SUM(paid_amount),0),2) paid,
            ROUND(COALESCE(SUM(total - paid_amount),0),2) due
     FROM purchases WHERE order_date BETWEEN ? AND ?`, from, to
  );
  const bySupplier = all(
    `SELECT s.name, COUNT(p.id) count, ROUND(SUM(p.total),2) total, ROUND(SUM(p.paid_amount),2) paid
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.order_date BETWEEN ? AND ? GROUP BY s.id ORDER BY total DESC`, from, to
  );
  res.json({ from, to, purchases, summary, bySupplier });
});

router.get('/reports/expenses', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const expenses = all(`SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC`, from, to);
  const byCategory = all(
    `SELECT category, COUNT(*) count, ROUND(SUM(amount),2) total FROM expenses
     WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC`, from, to
  );
  const byMonth = all(
    `SELECT strftime('%Y-%m', date) period, ROUND(SUM(amount),2) total FROM expenses
     WHERE date BETWEEN ? AND ? GROUP BY period ORDER BY period`, from, to
  );
  const summary = get(`SELECT COUNT(*) count, ROUND(COALESCE(SUM(amount),0),2) total FROM expenses WHERE date BETWEEN ? AND ?`, from, to);
  res.json({ from, to, expenses, byCategory, byMonth, summary });
});

router.get('/reports/pnl', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const sales = get(
    `SELECT COUNT(*) orders, ROUND(COALESCE(SUM(total),0),2) revenue, ROUND(COALESCE(SUM(subtotal),0),2) net_sales,
            ROUND(COALESCE(SUM(tax),0),2) tax, ROUND(COALESCE(SUM(discount),0),2) discounts,
            ROUND(COALESCE(SUM(delivery_fee),0),2) delivery
     FROM orders WHERE status='completed' AND date(created_at) BETWEEN ? AND ?`, from, to
  );
  const cogs = get(
    `SELECT ROUND(COALESCE(SUM(oi.qty * COALESCE(
        (SELECT SUM(r.qty * i.purchase_price) FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = oi.product_id), 0
      )), 0), 2) cogs
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status='completed' AND date(o.created_at) BETWEEN ? AND ?`, from, to
  ).cogs;
  const expenses = get(`SELECT ROUND(COALESCE(SUM(amount),0),2) total FROM expenses WHERE date BETWEEN ? AND ?`, from, to).total;
  const purchaseTotal = get(`SELECT ROUND(COALESCE(SUM(total),0),2) total FROM purchases WHERE order_date BETWEEN ? AND ?`, from, to).total;
  const grossProfit = round(sales.revenue - sales.tax - cogs);
  const netProfit = round(grossProfit - expenses);
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rev = get(`SELECT COALESCE(SUM(total - tax),0) v FROM orders WHERE status='completed' AND strftime('%Y-%m', created_at) = ?`, key).v;
    const exp = get(`SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE strftime('%Y-%m', date) = ?`, key).v;
    const cg = get(
      `SELECT COALESCE(SUM(oi.qty * COALESCE(
        (SELECT SUM(r.qty * i.purchase_price) FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = oi.product_id), 0
      )),0) v FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status='completed' AND strftime('%Y-%m', o.created_at) = ?`, key
    ).v;
    monthly.push({ month: key, label: d.toLocaleString('en', { month: 'short' }), revenue: round(rev), cogs: round(cg), expenses: round(exp), profit: round(rev - cg - exp) });
  }
  res.json({
    from, to, sales, cogs, expenses, purchaseTotal,
    grossProfit, netProfit,
    grossMargin: sales.revenue ? round((grossProfit / (sales.revenue - sales.tax || 1)) * 100) : 0,
    netMargin: sales.revenue ? round((netProfit / (sales.revenue - sales.tax || 1)) * 100) : 0,
    monthly
  });
});

router.get('/reports/tax', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const rows = all(
    `SELECT date(created_at) date, COUNT(*) orders, ROUND(SUM(subtotal),2) taxable, ROUND(SUM(tax),2) tax, ROUND(SUM(total),2) total
     FROM orders WHERE status='completed' AND date(created_at) BETWEEN ? AND ? GROUP BY date(created_at) ORDER BY date`, from, to
  );
  const summary = get(
    `SELECT ROUND(COALESCE(SUM(subtotal),0),2) taxable, ROUND(COALESCE(SUM(tax),0),2) tax, COUNT(*) orders
     FROM orders WHERE status='completed' AND date(created_at) BETWEEN ? AND ?`, from, to
  );
  const byMethod = all(
    `SELECT payment_method, ROUND(SUM(tax),2) tax, COUNT(*) orders FROM orders
     WHERE status='completed' AND date(created_at) BETWEEN ? AND ? GROUP BY payment_method`, from, to
  );
  res.json({ from, to, rows, summary, byMethod });
});

router.get('/reports/employees', requirePermission('reports'), (req, res) => {
  const { from, to } = rangeFromQuery(req);
  const rows = all(
    `SELECT u.id, u.name, u.role, u.join_date, u.salary, u.status,
            COUNT(o.id) orders_handled,
            SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END) completed,
            SUM(CASE WHEN o.status='cancelled' THEN 1 ELSE 0 END) cancelled,
            ROUND(COALESCE(SUM(CASE WHEN o.status='completed' THEN o.total ELSE 0 END),0),2) sales,
            ROUND(COALESCE(AVG(CASE WHEN o.status='completed' THEN o.total END),0),2) avg_order
     FROM users u LEFT JOIN orders o ON o.staff_id = u.id AND date(o.created_at) BETWEEN ? AND ?
     GROUP BY u.id ORDER BY sales DESC`, from, to
  );
  res.json({ from, to, employees: rows });
});

// ─────────────────────────── CSV EXPORT ───────────────────────────
function csv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => c.label).join(','), ...rows.map((r) => columns.map((c) => esc(c.get ? c.get(r) : r[c.key])).join(','))].join('\n');
}

router.get('/reports/export', requirePermission('reports'), (req, res) => {
  const type = req.query.type;
  const { from, to } = rangeFromQuery(req);
  let rows = [];
  let columns = [];
  let filename = `saffron-report-${type}-${from}-to-${to}.csv`;
  switch (type) {
    case 'sales':
      rows = all(
        `SELECT date(created_at) date, COUNT(*) orders, ROUND(SUM(subtotal),2) subtotal, ROUND(SUM(discount),2) discount,
                ROUND(SUM(tax),2) tax, ROUND(SUM(delivery_fee),2) delivery, ROUND(SUM(total),2) total
         FROM orders WHERE status='completed' AND date(created_at) BETWEEN ? AND ? GROUP BY date(created_at) ORDER BY date`, from, to
      );
      columns = ['date', 'orders', 'subtotal', 'discount', 'tax', 'delivery', 'total'].map((k) => ({ key: k, label: k.toUpperCase() }));
      break;
    case 'orders':
      rows = all(
        `SELECT order_number, created_at, customer_name, phone, type, status, payment_status, payment_method, total
         FROM orders WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at`, from, to
      );
      columns = ['order_number', 'created_at', 'customer_name', 'phone', 'type', 'status', 'payment_status', 'payment_method', 'total']
        .map((k) => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() }));
      break;
    case 'products': {
      const prods = all(
        `SELECT oi.name, COALESCE(c.name,'') category, SUM(oi.qty) qty, ROUND(SUM(oi.line_total),2) revenue,
                ROUND(COALESCE(${cogsSubquery},0),2) unit_cost
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE o.status='completed' AND date(o.created_at) BETWEEN ? AND ?
         GROUP BY oi.product_id, oi.name ORDER BY revenue DESC`, from, to
      );
      rows = prods.map((p) => ({
        name: p.name, category: p.category, qty: p.qty, revenue: p.revenue,
        cogs: round((p.unit_cost || 0) * p.qty),
        profit: round(p.revenue - (p.unit_cost || 0) * p.qty)
      }));
      columns = ['name', 'category', 'qty', 'revenue', 'cogs', 'profit'].map((k) => ({ key: k, label: k.toUpperCase() }));
      break;
    }
    case 'inventory':
      rows = all(
        `SELECT i.name, i.category, i.unit, i.stock_qty, i.min_stock, i.purchase_price,
                ROUND(i.stock_qty * i.purchase_price,2) value, i.expiry_date, COALESCE(s.name,'') supplier
         FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id ORDER BY i.name`
      );
      columns = ['name', 'category', 'unit', 'stock_qty', 'min_stock', 'purchase_price', 'value', 'expiry_date', 'supplier']
        .map((k) => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() }));
      break;
    case 'expenses':
      rows = all(`SELECT date, category, description, amount, payment_method, reference FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date`, from, to);
      columns = ['date', 'category', 'description', 'amount', 'payment_method', 'reference'].map((k) => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() }));
      break;
    case 'purchases':
      rows = all(
        `SELECT p.po_number, p.order_date, s.name supplier, p.status, p.subtotal, p.tax, p.total, p.paid_amount, ROUND(p.total-p.paid_amount,2) due
         FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.order_date BETWEEN ? AND ? ORDER BY p.order_date`, from, to
      );
      columns = ['po_number', 'order_date', 'supplier', 'status', 'subtotal', 'tax', 'total', 'paid_amount', 'due']
        .map((k) => ({ key: k, label: k.replace(/_/g, ' ').toUpperCase() }));
      break;
    case 'tax':
      rows = all(
        `SELECT date(created_at) date, COUNT(*) orders, ROUND(SUM(subtotal),2) taxable, ROUND(SUM(tax),2) tax
         FROM orders WHERE status='completed' AND date(created_at) BETWEEN ? AND ? GROUP BY date(created_at) ORDER BY date`, from, to
      );
      columns = ['date', 'orders', 'taxable', 'tax'].map((k) => ({ key: k, label: k.toUpperCase() }));
      break;
    case 'employees':
      rows = all(
        `SELECT u.name, u.role, COUNT(o.id) orders, ROUND(COALESCE(SUM(CASE WHEN o.status='completed' THEN o.total ELSE 0 END),0),2) sales
         FROM users u LEFT JOIN orders o ON o.staff_id = u.id AND date(o.created_at) BETWEEN ? AND ?
         GROUP BY u.id ORDER BY sales DESC`, from, to
      );
      columns = ['name', 'role', 'orders', 'sales'].map((k) => ({ key: k, label: k.toUpperCase() }));
      break;
    default:
      return res.status(400).json({ error: 'Unknown export type.' });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv(rows, columns));
});

module.exports = router;
