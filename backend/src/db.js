import Database from 'better-sqlite3';
import path from 'path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const db = new Database(path.join(DATA_DIR, 'shoottime.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_path TEXT NOT NULL,
    proxy_path TEXT,
    watermarked_path TEXT,
    facebook_photo_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS facebook_albums (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    album_id TEXT NOT NULL,
    album_name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_photos_session ON photos(session_id);
  CREATE INDEX IF NOT EXISTS idx_photos_status ON photos(status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations
try { db.exec("ALTER TABLE photos ADD COLUMN facebook_photo_id TEXT"); } catch {}

export default db;
