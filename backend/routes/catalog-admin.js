'use strict';
/** Menu, category, add-on and recipe management (immediately reflected on website + POS). */
const express = require('express');
const { all, get, run, transaction } = require('../db');
const { requireStaff, requirePermission, requireRole, asyncHandler, httpError } = require('../middleware/auth');
const { serializeProduct } = require('../lib/catalog');

const router = express.Router();
router.use(requireStaff);

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `item-${Date.now()}`;
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function recipeCostMap() {
  const rows = all(
    `SELECT r.product_id, SUM(r.qty * i.purchase_price) AS cost
     FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id GROUP BY r.product_id`
  );
  return Object.fromEntries(rows.map((r) => [r.product_id, r.cost]));
}

router.get('/menu', requirePermission('menu'), (req, res) => {
  const products = all(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.name`
  ).map((p) => serializeProduct(p));
  const costs = recipeCostMap();
  for (const p of products) {
    const cost = costs[p.id] || 0;
    p.recipe_cost = Math.round(cost * 100) / 100;
    p.profit = Math.round((p.price - cost) * 100) / 100;
    p.margin = p.price > 0 ? Math.round(((p.price - cost) / p.price) * 1000) / 10 : 0;
  }
  res.json({
    products,
    categories: all('SELECT * FROM categories ORDER BY sort_order, name'),
    addons: all('SELECT * FROM addons ORDER BY sort_order'),
    stats: {
      total: products.length,
      available: products.filter((p) => p.available).length,
      featured: products.filter((p) => p.is_featured).length,
      avgPrice: products.length ? Math.round(products.reduce((s, p) => s + p.price, 0) / products.length) : 0,
      avgMargin: products.length ? Math.round(products.reduce((s, p) => s + p.margin, 0) / products.length * 10) / 10 : 0
    }
  });
});

function validateProduct(body, existing = null) {
  const name = String(body.name || '').trim();
  if (name.length < 2) return 'Product name is required.';
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return 'Enter a valid selling price.';
  const categoryId = Number(body.category_id);
  if (!get('SELECT id FROM categories WHERE id = ?', categoryId)) return 'Choose a valid category.';
  return null;
}

router.post('/products', requirePermission('menu'), asyncHandler((req, res) => {
  const msg = validateProduct(req.body);
  if (msg) throw httpError(msg);
  let slug = slugify(req.body.name);
  if (get('SELECT id FROM products WHERE slug = ?', slug)) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const image = String(req.body.image || '/assets/images/food-spread.jpg');
  const r = run(
    `INSERT INTO products (name, slug, category_id, description, long_description, price, image, is_veg,
      is_featured, is_popular, is_recommended, available, prep_time, calories, rating)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    String(req.body.name).trim(), slug, Number(req.body.category_id),
    String(req.body.description || '').slice(0, 300), String(req.body.long_description || '').slice(0, 2000),
    Number(req.body.price), image, bool(req.body.is_veg), bool(req.body.is_featured), bool(req.body.is_popular),
    bool(req.body.is_recommended), req.body.available === undefined ? 1 : bool(req.body.available),
    Math.max(1, parseInt(req.body.prep_time, 10) || 15), parseInt(req.body.calories, 10) || null,
    Number(req.body.rating) || 4.5
  );
  if (Array.isArray(req.body.addon_ids)) {
    for (const id of req.body.addon_ids) {
      if (get('SELECT id FROM addons WHERE id = ?', Number(id))) {
        run('INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?,?)', r.lastInsertRowid, Number(id));
      }
    }
  }
  res.status(201).json({ product: serializeProduct(get('SELECT * FROM products WHERE id = ?', r.lastInsertRowid)) });
}));

router.put('/products/:id', requirePermission('menu'), asyncHandler((req, res) => {
  const product = get('SELECT * FROM products WHERE id = ?', Number(req.params.id));
  if (!product) throw httpError('Product not found.', 404);
  const msg = validateProduct(req.body, product);
  if (msg) throw httpError(msg);
  const image = String(req.body.image || product.image || '');
  run(
    `UPDATE products SET name = ?, category_id = ?, description = ?, long_description = ?, price = ?, image = ?,
      is_veg = ?, is_featured = ?, is_popular = ?, is_recommended = ?, available = ?, prep_time = ?, calories = ?, rating = ?
     WHERE id = ?`,
    String(req.body.name).trim(), Number(req.body.category_id),
    String(req.body.description || '').slice(0, 300), String(req.body.long_description || '').slice(0, 2000),
    Number(req.body.price), image, bool(req.body.is_veg), bool(req.body.is_featured), bool(req.body.is_popular),
    bool(req.body.is_recommended), req.body.available === undefined ? product.available : bool(req.body.available),
    Math.max(1, parseInt(req.body.prep_time, 10) || 15), parseInt(req.body.calories, 10) || null,
    Number(req.body.rating) || 4.5, product.id
  );
  if (Array.isArray(req.body.addon_ids)) {
    run('DELETE FROM product_addons WHERE product_id = ?', product.id);
    for (const id of req.body.addon_ids) {
      if (get('SELECT id FROM addons WHERE id = ?', Number(id))) {
        run('INSERT OR IGNORE INTO product_addons (product_id, addon_id) VALUES (?,?)', product.id, Number(id));
      }
    }
  }
  res.json({ product: serializeProduct(get('SELECT * FROM products WHERE id = ?', product.id)) });
}));

router.delete('/products/:id', requirePermission('menu'), (req, res) => {
  const product = get('SELECT * FROM products WHERE id = ?', Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  run('DELETE FROM products WHERE id = ?', product.id);
  res.json({ ok: true });
});

// ── Categories ──
router.post('/categories', requirePermission('menu'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Category name is required.' });
  let slug = slugify(name);
  if (get('SELECT id FROM categories WHERE slug = ?', slug)) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const max = get('SELECT COALESCE(MAX(sort_order),0) m FROM categories').m;
  const requestedSort = Number(req.body.sort_order);
  const sortOrder = Number.isFinite(requestedSort) && req.body.sort_order !== '' ? requestedSort : max + 1;
  const r = run('INSERT INTO categories (name, slug, description, image, sort_order) VALUES (?,?,?,?,?)',
    name, slug, String(req.body.description || ''), String(req.body.image || '/assets/images/food-spread.jpg'), sortOrder);
  res.status(201).json({ category: get('SELECT * FROM categories WHERE id = ?', r.lastInsertRowid) });
});

router.put('/categories/:id', requirePermission('menu'), (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Category not found.' });
  const name = String(req.body.name || c.name).trim();
  if (name.length < 2) return res.status(400).json({ error: 'Category name is required.' });
  run('UPDATE categories SET name = ?, description = ?, image = ?, active = ?, sort_order = ? WHERE id = ?',
    name, String(req.body.description ?? c.description ?? ''), String(req.body.image || c.image),
    req.body.active === undefined ? c.active : (req.body.active ? 1 : 0),
    req.body.sort_order !== undefined ? parseInt(req.body.sort_order, 10) : c.sort_order, c.id);
  res.json({ category: get('SELECT * FROM categories WHERE id = ?', c.id) });
});

router.delete('/categories/:id', requirePermission('menu'), (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Category not found.' });
  const count = get('SELECT COUNT(*) c FROM products WHERE category_id = ?', c.id).c;
  if (count > 0) return res.status(409).json({ error: `Move or delete the ${count} product(s) in this category first.` });
  run('DELETE FROM categories WHERE id = ?', c.id);
  res.json({ ok: true });
});

// ── Add-ons ──
router.post('/addons', requirePermission('menu'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Add-on name is required.' });
  const price = Number(req.body.price);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Enter a valid add-on price.' });
  const max = get('SELECT COALESCE(MAX(sort_order),0) m FROM addons').m;
  const r = run('INSERT INTO addons (name, price, group_name, sort_order) VALUES (?,?,?,?)',
    name, price, String(req.body.group_name || 'Extras'), max + 1);
  res.status(201).json({ addon: get('SELECT * FROM addons WHERE id = ?', r.lastInsertRowid) });
});

router.put('/addons/:id', requirePermission('menu'), (req, res) => {
  const a = get('SELECT * FROM addons WHERE id = ?', Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'Add-on not found.' });
  run('UPDATE addons SET name = ?, price = ?, group_name = ?, active = ? WHERE id = ?',
    String(req.body.name || a.name).trim(), req.body.price !== undefined ? Number(req.body.price) : a.price,
    String(req.body.group_name || a.group_name), req.body.active === undefined ? a.active : (req.body.active ? 1 : 0), a.id);
  res.json({ addon: get('SELECT * FROM addons WHERE id = ?', a.id) });
});

router.delete('/addons/:id', requirePermission('menu'), (req, res) => {
  run('DELETE FROM addons WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

// ── Recipes & food costing ──
router.get('/recipes', requirePermission('recipes'), (req, res) => {
  const products = all(
    `SELECT p.id, p.name, p.price, p.image, p.available, c.name AS category
     FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.name`
  );
  const costs = recipeCostMap();
  const rows = products.map((p) => ({
    ...p,
    cost: Math.round((costs[p.id] || 0) * 100) / 100,
    profit: Math.round((p.price - (costs[p.id] || 0)) * 100) / 100,
    margin: p.price ? Math.round(((p.price - (costs[p.id] || 0)) / p.price) * 1000) / 10 : 0,
    ingredients: all(
      `SELECT r.id, r.ingredient_id, r.qty, i.name, i.unit, i.purchase_price,
        ROUND(r.qty * i.purchase_price, 2) AS line_cost
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = ? ORDER BY i.name`, p.id
    )
  }));
  res.json({
    recipes: rows,
    ingredients: all('SELECT id, name, unit, purchase_price, stock_qty FROM ingredients ORDER BY name'),
    summary: {
      avgCost: rows.length ? Math.round(rows.reduce((s, r) => s + r.cost, 0) / rows.length) : 0,
      avgMargin: rows.length ? Math.round(rows.reduce((s, r) => s + r.margin, 0) / rows.length * 10) / 10 : 0,
      missing: rows.filter((r) => !r.ingredients.length).length
    }
  });
});

router.put('/recipes/:productId', requirePermission('recipes'), asyncHandler((req, res) => {
  const product = get('SELECT * FROM products WHERE id = ?', Number(req.params.productId));
  if (!product) throw httpError('Product not found.', 404);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  for (const it of items) {
    const ing = get('SELECT * FROM ingredients WHERE id = ?', Number(it.ingredient_id));
    if (!ing) throw httpError('One of the selected ingredients no longer exists.');
    if (!(Number(it.qty) > 0)) throw httpError(`Enter a quantity for ${ing.name}.`);
  }
  transaction(() => {
    run('DELETE FROM recipes WHERE product_id = ?', product.id);
    for (const it of items) {
      run('INSERT INTO recipes (product_id, ingredient_id, qty) VALUES (?,?,?)',
        product.id, Number(it.ingredient_id), Number(it.qty));
    }
  });
  const cost = get(
    `SELECT COALESCE(SUM(r.qty * i.purchase_price),0) cost FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = ?`,
    product.id
  ).cost;
  res.json({
    ok: true,
    cost: Math.round(cost * 100) / 100,
    profit: Math.round((product.price - cost) * 100) / 100,
    margin: product.price ? Math.round(((product.price - cost) / product.price) * 1000) / 10 : 0,
    ingredients: all(
      `SELECT r.id, r.ingredient_id, r.qty, i.name, i.unit, i.purchase_price, ROUND(r.qty * i.purchase_price,2) line_cost
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = ?`, product.id
    )
  });
}));

module.exports = router;
