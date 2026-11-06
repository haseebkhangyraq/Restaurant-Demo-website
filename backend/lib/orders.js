'use strict';
/** Shared business logic for orders, pricing, inventory deduction and invoicing. */
const {
  all, get, run, transaction, now, nextOrderNumber, nextInvoiceNumber, getSettings
} = require('../db');

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

function calculateTotals({ subtotal, discount = 0, deliveryFee = 0, taxRate }) {
  const rate = taxRate === undefined ? Number(getSettings().tax_rate || 0) : Number(taxRate);
  const sub = round(subtotal);
  let disc = round(discount);
  if (disc > sub) disc = sub;
  const tax = round(((sub - disc) * rate) / 100);
  const total = round(sub - disc + tax + round(deliveryFee));
  return { subtotal: sub, discount: disc, tax, delivery_fee: round(deliveryFee), total, tax_rate: rate };
}

function validateCoupon(code, subtotal) {
  if (!code) return { valid: false, message: 'Enter a coupon code.' };
  const coupon = get('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND active = 1', String(code).trim());
  if (!coupon) return { valid: false, message: 'That coupon code is not valid.' };
  if (coupon.expires_at && coupon.expires_at < new Date().toISOString().slice(0, 10)) {
    return { valid: false, message: 'This coupon has expired.' };
  }
  if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
    return { valid: false, message: 'This coupon has reached its usage limit.' };
  }
  if (subtotal < coupon.min_order) {
    return { valid: false, message: `Minimum order of Rs. ${Number(coupon.min_order).toLocaleString()} required.` };
  }
  let discount = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
  if (coupon.max_discount) discount = Math.min(discount, coupon.max_discount);
  discount = Math.min(round(discount), subtotal);
  return { valid: true, coupon, discount, message: `Coupon applied — you saved Rs. ${discount.toLocaleString()}.` };
}

/** Resolve priced line items from DB — never trust client prices. */
function buildLineItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Your order must contain at least one item.');
    err.status = 400;
    throw err;
  }
  if (items.length > 80) {
    const err = new Error('Too many line items.');
    err.status = 400;
    throw err;
  }
  const lines = [];
  for (const raw of items) {
    const qty = Math.max(1, Math.min(99, parseInt(raw.qty, 10) || 1));
    const product = get('SELECT * FROM products WHERE id = ?', Number(raw.product_id || raw.id));
    if (!product) {
      const err = new Error('A product in your cart is no longer available.');
      err.status = 400;
      throw err;
    }
    if (!product.available) {
      const err = new Error(`${product.name} is currently unavailable.`);
      err.status = 409;
      throw err;
    }
    let addonTotal = 0;
    const addonNames = [];
    const addonIds = Array.isArray(raw.addonIds) ? raw.addonIds : [];
    if (addonIds.length) {
      const placeholders = addonIds.map(() => '?').join(',');
      const valid = all(
        `SELECT a.* FROM addons a JOIN product_addons pa ON pa.addon_id = a.id
         WHERE pa.product_id = ? AND a.active = 1 AND a.id IN (${placeholders})`,
        product.id, ...addonIds.map(Number)
      );
      for (const a of valid) { addonTotal += Number(a.price); addonNames.push(a.name); }
    }
    const unit = round(product.price + addonTotal);
    const lineTotal = round(unit * qty);
    lines.push({
      product_id: product.id,
      name: product.name,
      qty,
      unit_price: unit,
      addons_json: addonNames.length ? JSON.stringify({ names: addonNames, extra: round(addonTotal) }) : null,
      notes: raw.notes ? String(raw.notes).slice(0, 300) : null,
      line_total: lineTotal
    });
  }
  return lines;
}

function findOrCreateCustomer({ name, phone, email, address, city }, staffId = null) {
  name = (name || '').trim();
  phone = (phone || '').trim();
  if (!name && !phone) return null;
  let customer = null;
  if (phone) customer = get('SELECT * FROM customers WHERE phone = ?', phone);
  if (!customer && email) customer = get('SELECT * FROM customers WHERE LOWER(email) = LOWER(?)', email);
  if (customer) {
    const updates = [];
    const params = [];
    if (name && name !== customer.name) { updates.push('name = ?'); params.push(name); }
    if (email && !customer.email) { updates.push('email = ?'); params.push(email); }
    if (address && !customer.address) { updates.push('address = ?'); params.push(address); }
    if (city && !customer.city) { updates.push('city = ?'); params.push(city); }
    if (updates.length) {
      params.push(customer.id);
      run(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, ...params);
    }
    return customer.id;
  }
  const res = run(
    'INSERT INTO customers (name, phone, email, address, city) VALUES (?, ?, ?, ?, ?)',
    name || 'Walk-in Guest', phone || null, email || null, address || null, city || null
  );
  return res.lastInsertRowid;
}

/**
 * Create an order + invoice atomically.
 * options: { source, status, paymentStatus, paymentMethod, staffId, customerId, force }
 */
function createOrder(payload) {
  const {
    items, type = 'takeaway', tableId = null, customerId = null, customer = null,
    notes = null, couponCode = null, deliveryFee = null, status = 'pending',
    paymentStatus = 'unpaid', paymentMethod = 'cash', source = 'online',
    staffId = null, name = null, phone = null, address = null
  } = payload;

  const lines = buildLineItems(items);
  const subtotal = round(lines.reduce((s, l) => s + l.line_total, 0));

  let disc = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const v = validateCoupon(couponCode, subtotal);
    if (v.valid) { disc = v.discount; appliedCoupon = v.coupon; }
    else {
      const err = new Error(v.message);
      err.status = 400;
      throw err;
    }
  }
  const manualDiscount = Math.max(0, Number(payload.discount) || 0);
  disc = round(Math.min(subtotal, disc + manualDiscount));

  const settings = getSettings();
  const fee = type === 'delivery' || type === 'online'
    ? (deliveryFee !== null && deliveryFee !== undefined && deliveryFee !== '' ? Number(deliveryFee) : Number(settings.delivery_fee))
    : 0;
  const totals = calculateTotals({ subtotal, discount: disc, deliveryFee: fee });

  if (type === 'delivery' && !address) {
    const err = new Error('A delivery address is required.');
    err.status = 400;
    throw err;
  }

  return transaction(() => {
    let cid = customerId ? Number(customerId) : null;
    if (cid && !get('SELECT id FROM customers WHERE id = ?', cid)) cid = null;
    if (!cid && (customer || phone || name)) {
      cid = findOrCreateCustomer(customer || { name, phone, address }, staffId);
    }

    const orderNumber = nextOrderNumber();
    const res = run(
      `INSERT INTO orders (order_number, customer_id, staff_id, type, table_id, status, payment_status,
        payment_method, subtotal, tax, discount, delivery_fee, total, coupon_code, notes,
        customer_name, phone, address, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNumber, cid, staffId, type, tableId || null, status, paymentStatus, paymentMethod,
      totals.subtotal, totals.tax, totals.discount, totals.delivery_fee, totals.total,
      appliedCoupon ? appliedCoupon.code : null, notes || null,
      name || customer?.name || null, phone || customer?.phone || null, address || customer?.address || null,
      source, now(), now()
    );
    const orderId = res.lastInsertRowid;

    for (const l of lines) {
      run(
        `INSERT INTO order_items (order_id, product_id, name, qty, unit_price, addons_json, notes, line_total)
         VALUES (?,?,?,?,?,?,?,?)`,
        orderId, l.product_id, l.name, l.qty, l.unit_price, l.addons_json, l.notes, l.line_total
      );
    }

    if (appliedCoupon) {
      run('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', appliedCoupon.id);
    }

    const invoiceNumber = nextInvoiceNumber();
    run(
      `INSERT INTO invoices (invoice_number, order_id, customer_id, subtotal, tax, discount, delivery_fee,
        total, payment_method, status, issued_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      invoiceNumber, orderId, cid, totals.subtotal, totals.tax, totals.discount, totals.delivery_fee,
      totals.total, paymentMethod, paymentStatus === 'paid' ? 'paid' : 'unpaid', now()
    );

    if (tableId) {
      if (type === 'dine-in') {
        run(`UPDATE dining_tables SET status = 'occupied', current_order_id = ? WHERE id = ?`, orderId, tableId);
      }
    }

    if (status === 'completed' && payload.deductInventory) {
      deductInventory(orderId, { force: !!payload.force, staffId });
      run(`UPDATE orders SET inventory_deducted = 1, completed_at = ? WHERE id = ?`, now(), orderId);
    }

    return { orderId, orderNumber, totals, customerId: cid, invoiceNumber };
  });
}

/** Compute ingredient requirements for an order from recipes. */
function getOrderRequirements(orderId) {
  return all(
    `SELECT i.id, i.name, i.unit, i.stock_qty,
            SUM(r.qty * oi.qty) AS required
     FROM order_items oi
     JOIN recipes r ON r.product_id = oi.product_id
     JOIN ingredients i ON i.id = r.ingredient_id
     WHERE oi.order_id = ?
     GROUP BY i.id`,
    orderId
  );
}

/**
 * Deducts recipe ingredients for a completed order.
 * Returns { warnings: [] }. Throws 409 if stock is insufficient and force is false.
 */
function deductInventory(orderId, { force = false, staffId = null } = {}) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }
  if (order.inventory_deducted) return { warnings: [], alreadyDeducted: true };
  const reqs = getOrderRequirements(orderId);
  if (!reqs.length) {
    run('UPDATE orders SET inventory_deducted = 1 WHERE id = ?', orderId);
    return { warnings: [] };
  }
  const warnings = [];
  const shortages = reqs
    .filter((r) => Number(r.stock_qty) < Number(r.required))
    .map((r) => ({
      ingredient_id: r.id,
      name: r.name,
      unit: r.unit,
      required: round(r.required),
      available: round(r.stock_qty)
    }));
  if (shortages.length && !force) {
    const err = new Error('Insufficient inventory for this order.');
    err.status = 409;
    err.code = 'INSUFFICIENT_STOCK';
    err.shortages = shortages;
    throw err;
  }
  for (const r of reqs) {
    const available = Number(r.stock_qty);
    const required = Number(r.required);
    const deductQty = force ? Math.min(available, required) : required;
    if (deductQty <= 0) {
      warnings.push(`${r.name}: no stock available (${required}${r.unit} required).`);
      continue;
    }
    if (force && available < required) {
      warnings.push(`${r.name}: short by ${round(required - available)}${r.unit}; stock set to zero.`);
    }
    run('UPDATE ingredients SET stock_qty = MAX(0, ROUND(stock_qty - ?, 3)) WHERE id = ?', deductQty, r.id);
    run(
      `INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      r.id, 'sale', -deductQty, 0, order.order_number, `Recipe deduction for order ${order.order_number}`, staffId
    );
  }
  run('UPDATE orders SET inventory_deducted = 1 WHERE id = ?', orderId);
  return { warnings };
}

/** Restock ingredients when a completed order is refunded/cancelled. */
function restockInventory(orderId, staffId = null) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order || !order.inventory_deducted) return;
  const reqs = getOrderRequirements(orderId);
  for (const r of reqs) {
    run('UPDATE ingredients SET stock_qty = ROUND(stock_qty + ?, 3) WHERE id = ?', r.required, r.id);
    run(
      `INSERT INTO inventory_transactions (ingredient_id, type, qty_change, unit_cost, reference, notes, created_by)
       VALUES (?,?,?,?,?,?,?)`,
      r.id, 'return', Number(r.required), 0, order.order_number, `Stock returned from cancelled order ${order.order_number}`, staffId
    );
  }
  run('UPDATE orders SET inventory_deducted = 0 WHERE id = ?', orderId);
}

const VALID_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];

/**
 * Change order status, syncing invoice, table and inventory.
 * Returns { order, warnings }.
 */
function setOrderStatus(orderId, status, { staffId = null, force = false } = {}) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error('Invalid order status.');
    err.status = 400;
    throw err;
  }
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) {
    const err = new Error('Order not found.');
    err.status = 404;
    throw err;
  }
  let warnings = [];
  return transaction(() => {
    if (status === 'completed' && !order.inventory_deducted) {
      const result = deductInventory(orderId, { force, staffId });
      warnings = result.warnings || [];
      run(`UPDATE orders SET inventory_deducted = 1, completed_at = ?, payment_status = CASE WHEN payment_status = 'unpaid' THEN 'paid' ELSE payment_status END WHERE id = ?`, now(), orderId);
      run(`UPDATE invoices SET status = 'paid' WHERE order_id = ? AND status = 'unpaid'`, orderId);
    }
    if (status === 'cancelled') {
      if (order.inventory_deducted) restockInventory(orderId, staffId);
      if (order.payment_status === 'paid') {
        run(`UPDATE orders SET payment_status = 'refunded' WHERE id = ?`, orderId);
        run(`UPDATE invoices SET status = 'refunded' WHERE order_id = ?`, orderId);
      }
      if (order.table_id) {
        run(`UPDATE dining_tables SET status = 'available', current_order_id = NULL WHERE id = ? AND current_order_id = ?`, order.table_id, orderId);
      }
    }
    if (status === 'completed' && order.table_id) {
      // Keep table occupied with the guest; staff can clear it from Table Management.
      run(`UPDATE dining_tables SET status = 'occupied', current_order_id = ? WHERE id = ?`, orderId, order.table_id);
    }
    run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, now(), orderId);
    const updated = get('SELECT * FROM orders WHERE id = ?', orderId);
    return { order: updated, warnings };
  });
}

function getOrderDetails(id) {
  const order = get(
    `SELECT o.*, c.name AS customer_record_name, c.email AS customer_email,
            u.name AS staff_name, t.number AS table_number
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN users u ON u.id = o.staff_id
     LEFT JOIN dining_tables t ON t.id = o.table_id
     WHERE o.id = ?`, id
  );
  if (!order) return null;
  order.items = all('SELECT * FROM order_items WHERE order_id = ?', id).map((it) => ({
    ...it, addons: it.addons_json ? JSON.parse(it.addons_json) : null
  }));
  order.invoice = get('SELECT * FROM invoices WHERE order_id = ?', id);
  return order;
}

module.exports = {
  round, calculateTotals, validateCoupon, buildLineItems, findOrCreateCustomer,
  createOrder, deductInventory, restockInventory, setOrderStatus, getOrderDetails,
  getOrderRequirements, VALID_STATUSES
};
