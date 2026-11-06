'use strict';
/**
 * SQLite-backed express-session store. Replaces the default memory store so
 * sessions survive restarts and (on Vercel) serverless instance swaps — every
 * session row lives in the same database as the app data.
 */
const session = require('express-session');
const { run, get } = require('./db');

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

class SQLiteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = get('SELECT data FROM sessions WHERE sid = ? AND expires > ?', sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = (sess && sess.cookie && sess.cookie.expires)
        ? new Date(sess.cookie.expires).getTime() - Date.now()
        : TWO_WEEKS_MS;
      run(
        `INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires`,
        sid, JSON.stringify(sess), Math.floor(Date.now() + maxAge + 60_000)
      );
      // Cheap opportunistic cleanup
      if (Math.random() < 0.05) run('DELETE FROM sessions WHERE expires < ?', Date.now());
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      const maxAge = (sess && sess.cookie && sess.cookie.expires)
        ? new Date(sess.cookie.expires).getTime() - Date.now()
        : TWO_WEEKS_MS;
      run('UPDATE sessions SET expires = ? WHERE sid = ?', Math.floor(Date.now() + maxAge + 60_000), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      run('DELETE FROM sessions WHERE sid = ?', sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = SQLiteSessionStore;
