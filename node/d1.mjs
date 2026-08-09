/**
 * D1's query shapes, on top of Node's built-in SQLite.
 *
 * `node:sqlite` rather than `better-sqlite3`: it ships with Node 22.5+, so there is no
 * dependency to install and — the part that matters on a 200₽ VPS — no native module to
 * compile. A portfolio site should not need a C toolchain to move house.
 *
 * The surface below is not "most of D1". It is exactly what `worker/` calls, which is a
 * deliberately small set: prepare, bind, first, all, run, batch. Anything the Worker does
 * not use is absent on purpose — an adapter that implements more than its caller needs is
 * a second thing to keep correct.
 */

import { DatabaseSync } from 'node:sqlite';

/** node:sqlite hands back null-prototype rows; D1 gives plain objects, and callers spread them. */
function plain(row) {
  return row ? { ...row } : null;
}

class Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  /** D1's bind returns a NEW statement rather than mutating — several call sites reuse one. */
  bind(...args) {
    return new Statement(this.db, this.sql, args);
  }

  async first() {
    return plain(this.db.prepare(this.sql).get(...this.args));
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.args).map((row) => ({ ...row }));
    return { results, success: true, meta: {} };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.args);
    return {
      success: true,
      meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) },
    };
  }
}

class Database {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  /**
   * D1 runs a batch as one transaction. Reordering images depends on that: a half-applied
   * renumber would leave two photographs claiming the same position.
   */
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * Applies `migrations/*.sql` in order, recording each one — the same contract as
 * `wrangler d1 migrations apply`, and for the same reason: migration 0001 is not idempotent
 * and running it twice corrupted real data once. The table name matches wrangler's so a
 * database can be inspected the same way either side of a move.
 */
export function migrate(database, files) {
  const db = database.db;
  db.exec(
    `CREATE TABLE IF NOT EXISTS d1_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT UNIQUE,
       applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
     )`,
  );

  const applied = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  const pending = files.filter((file) => !applied.has(file.name));

  for (const file of pending) {
    db.exec('BEGIN');
    try {
      db.exec(file.sql);
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(file.name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file.name} failed: ${error.message}`);
    }
  }
  return pending.map((file) => file.name);
}

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return new Database(db);
}
