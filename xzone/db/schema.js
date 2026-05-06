'use strict';
/**
 * db/schema.js
 * Uses sql.js (pure JavaScript SQLite — no native compilation needed).
 * Exposes a better-sqlite3-compatible synchronous API so all route files
 * work without any changes.
 */

const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');
const config = require('../config');

let _wrapper = null;

// ── Compatibility wrapper ─────────────────────────────────────
// Makes sql.js behave like better-sqlite3 (.prepare().get/all/run)

class DbWrapper {
  constructor(sqliteDb, dbPath) {
    this._sql    = sqliteDb;
    this._dbPath = path.resolve(dbPath);
    this._transactionDepth = 0;
    this._dirty = false;
  }

  // Returns a Statement-like object with get / all / run
  prepare(sql) {
    const self = this;
    const paramsFrom = args => {
      const params = args.flat();
      const badIndex = params.findIndex(value => value === undefined);
      if (badIndex !== -1) {
        throw new Error(`[DB] Undefined SQL parameter ${badIndex + 1}: ${sql.trim().replace(/\s+/g, ' ')}`);
      }
      return params;
    };

    return {
      get(...args) {
        const params = paramsFrom(args);
        const stmt = self._sql.prepare(sql);
        try {
          if (params.length) stmt.bind(params);
          if (stmt.step()) return stmt.getAsObject();
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...args) {
        const params = paramsFrom(args);
        const stmt = self._sql.prepare(sql);
        const rows = [];
        try {
          if (params.length) stmt.bind(params);
          while (stmt.step()) rows.push(stmt.getAsObject());
        } finally {
          stmt.free();
        }
        return rows;
      },
      run(...args) {
        const params = paramsFrom(args);
        self._sql.run(sql, params.length ? params : []);
        self._save();
        return { changes: self._sql.getRowsModified() };
      }
    };
  }

  // Execute one or more SQL statements (schema init etc.)
  exec(sql) {
    this._sql.exec(sql);
    this._save();
    return this;
  }

  // SQLite PRAGMA helper
  pragma(str) {
    try { this._sql.run(`PRAGMA ${str}`); } catch (_) {}
    return this;
  }

  transaction(fn) {
    if (this._transactionDepth > 0) return fn();

    this._sql.run('BEGIN IMMEDIATE');
    this._transactionDepth = 1;
    try {
      const result = fn();
      this._sql.run('COMMIT');
      this._transactionDepth = 0;
      if (this._dirty) {
        this._dirty = false;
        this._save();
      }
      return result;
    } catch (err) {
      this._sql.run('ROLLBACK');
      this._transactionDepth = 0;
      this._dirty = false;
      throw err;
    }
  }

  // Persist in-memory database to disk after every write
  _save() {
    if (this._transactionDepth > 0) {
      this._dirty = true;
      return;
    }

    const data = this._sql.export();
    const dir  = path.dirname(this._dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this._dbPath}.tmp`;
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, this._dbPath);
  }

  // Create all tables on first run
  _initSchema() {
    this.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        gamertag    TEXT UNIQUE NOT NULL,
        xuid        TEXT UNIQUE,
        joined_at   INTEGER DEFAULT (strftime('%s','now')),
        last_seen   INTEGER DEFAULT (strftime('%s','now')),
        is_active   INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS famestar (
        user_id       TEXT PRIMARY KEY REFERENCES users(id),
        points        INTEGER DEFAULT 0,
        level         INTEGER DEFAULT 1,
        title         TEXT DEFAULT 'Newcomer',
        avatar_style  TEXT DEFAULT NULL,
        updated_at    INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS famestar_awards (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT REFERENCES users(id),
        award_id    TEXT NOT NULL,
        earned_at   INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS famestar_activity (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT REFERENCES users(id),
        action      TEXT NOT NULL,
        points      INTEGER NOT NULL,
        meta        TEXT,
        created_at  INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS feed_posts (
        id          TEXT PRIMARY KEY,
        user_id     TEXT REFERENCES users(id),
        body        TEXT NOT NULL,
        created_at  INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS titles (
        title_id    TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        added_at    INTEGER DEFAULT (strftime('%s','now')),
        is_active   INTEGER DEFAULT 1,
        notes       TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        user_id     TEXT PRIMARY KEY REFERENCES users(id),
        status      TEXT DEFAULT 'Online',
        title_id    TEXT,
        updated_at  INTEGER DEFAULT (strftime('%s','now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_famestar_awards_user_award
        ON famestar_awards(user_id, award_id);

      CREATE INDEX IF NOT EXISTS idx_famestar_points
        ON famestar(points DESC);

      CREATE INDEX IF NOT EXISTS idx_feed_posts_created
        ON feed_posts(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_sessions_updated
        ON sessions(updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_sessions_title_updated
        ON sessions(title_id, updated_at DESC);
    `);
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Initialize the database (async — await once at server startup).
 * After this resolves, getDb() works synchronously everywhere.
 */
async function initDb() {
  if (_wrapper) return _wrapper;

  // Locate sql.js WASM file inside node_modules
  const sqlJsDist = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));

  const SQL = await initSqlJs({
    locateFile: file => path.join(sqlJsDist, file)
  });

  const dbPath = path.resolve(config.dbPath);
  const dbDir  = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  let sqliteDb;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    sqliteDb  = new SQL.Database(buf);
  } else {
    sqliteDb = new SQL.Database();
  }

  _wrapper = new DbWrapper(sqliteDb, dbPath);
  _wrapper.pragma('foreign_keys = ON');
  _wrapper._initSchema();

  console.log(`[DB] SQLite ready → ${dbPath}`);
  return _wrapper;
}

/**
 * Get the database wrapper synchronously.
 * Safe to call from any route because initDb() is awaited before the
 * server starts accepting connections.
 */
function getDb() {
  if (!_wrapper) throw new Error('[DB] Not ready — await initDb() before starting the server');
  return _wrapper;
}

module.exports = { initDb, getDb };
