'use strict';
const { get } = require('../db');

const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: ['dashboard', 'pos', 'orders', 'kitchen', 'billing', 'menu', 'inventory', 'recipes', 'tables', 'reservations', 'customers', 'staff', 'suppliers', 'expenses', 'reports', 'settings'],
  cashier: ['dashboard', 'pos', 'orders', 'billing', 'customers', 'reservations', 'tables'],
  waiter: ['dashboard', 'pos', 'orders', 'tables', 'reservations', 'customers'],
  kitchen: ['dashboard', 'orders', 'kitchen']
};

function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function requireStaff(req, res, next) {
  if (!req.session || !req.session.staff) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  const staff = get('SELECT id, name, email, role, phone, status FROM users WHERE id = ?', req.session.staff.id);
  if (!staff || staff.status !== 'active') {
    req.session.staff = null;
    return res.status(401).json({ error: 'Your account is no longer active.' });
  }
  req.staff = staff;
  next();
}

function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: 'Authentication required.' });
    if (!allowed.includes(req.staff.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.staff) return res.status(401).json({ error: 'Authentication required.' });
    if (!hasPermission(req.staff.role, permission)) {
      return res.status(403).json({ error: 'You do not have access to this module.' });
    }
    next();
  };
}

function requireCustomer(req, res, next) {
  if (!req.session || !req.session.customer) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  const customer = get('SELECT id, name, email, phone FROM customers WHERE id = ?', req.session.customer.id);
  if (!customer) {
    req.session.customer = null;
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  req.customer = customer;
  next();
}

/** Wraps async route handlers so rejected promises reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(message, status = 400, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

module.exports = {
  ROLE_PERMISSIONS, hasPermission, requireStaff, requireRole, requirePermission,
  requireCustomer, asyncHandler, httpError
};
