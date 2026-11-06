'use strict';
const { all, get, getSettings, safeJSON } = require('../db');

function addonsForProduct(productId) {
  return all(
    `SELECT a.id, a.name, a.price, a.group_name
     FROM addons a JOIN product_addons pa ON pa.addon_id = a.id
     WHERE pa.product_id = ? AND a.active = 1
     ORDER BY a.sort_order`, productId
  );
}

function serializeProduct(p, includeAddons = true) {
  const addons = includeAddons ? addonsForProduct(p.id) : [];
  const groups = {};
  for (const a of addons) {
    groups[a.group_name] = groups[a.group_name] || [];
    groups[a.group_name].push(a);
  }
  const recipe = all(
    `SELECT r.qty, i.name, i.unit FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.product_id = ?`,
    p.id
  );
  return {
    ...p,
    is_veg: !!p.is_veg, is_featured: !!p.is_featured, is_popular: !!p.is_popular,
    is_recommended: !!p.is_recommended, available: !!p.available,
    addons, addon_groups: groups, recipe
  };
}

function getCatalog({ publicOnly = true } = {}) {
  const categories = all(
    `SELECT * FROM categories ${publicOnly ? 'WHERE active = 1' : ''} ORDER BY sort_order, name`
  );
  const products = all(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     ${publicOnly ? 'WHERE c.active = 1' : ''}
     ORDER BY p.is_featured DESC, p.name`
  ).map((p) => serializeProduct(p, true));
  return { categories, products };
}

function getSiteContent() {
  const settings = getSettings(true);
  return {
    settings,
    categories: all('SELECT * FROM categories WHERE active = 1 ORDER BY sort_order, name'),
    products: all(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       WHERE c.active = 1 ORDER BY p.is_featured DESC, p.name`
    ).map((p) => serializeProduct(p)),
    testimonials: all('SELECT * FROM testimonials WHERE active = 1 ORDER BY id'),
    gallery: all('SELECT * FROM gallery ORDER BY sort_order'),
    faqs: all('SELECT * FROM faqs WHERE active = 1 ORDER BY sort_order'),
    offers: all(
      `SELECT code, type, value, min_order, max_discount FROM coupons
       WHERE active = 1 AND (expires_at IS NULL OR expires_at >= date('now','localtime'))
       ORDER BY min_order LIMIT 4`
    )
  };
}

function getTablesAvailability(date, time) {
  const tables = all('SELECT * FROM dining_tables ORDER BY number');
  const reservationRows = all(
    `SELECT table_id FROM reservations WHERE date = ? AND time = ? AND status IN ('pending','confirmed','seated')`,
    date, time
  );
  const reservedIds = new Set(reservationRows.map((r) => r.table_id));
  return tables.map((t) => ({
    ...t,
    reserved_for_slot: reservedIds.has(t.id),
    bookable: !reservedIds.has(t.id)
  }));
}

module.exports = { getCatalog, getSiteContent, getTablesAvailability, addonsForProduct, serializeProduct };
