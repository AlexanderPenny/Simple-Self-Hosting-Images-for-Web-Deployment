// Copyright 2026 Alexander L. Penny
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    -- Set to enable OIDC sign-in for this user; matched case-insensitively
    -- against the identity provider's email claim.
    email         TEXT    COLLATE NOCASE,
    -- The provider's "sub" claim, recorded on the first successful OIDC
    -- sign-in and checked on every one after. See src/oidc.js.
    oidc_subject  TEXT,
    created_at    INTEGER NOT NULL,
    disabled      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    ip         TEXT,
    user_agent TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS images (
    id            TEXT    PRIMARY KEY,
    filename      TEXT    NOT NULL,
    original_name TEXT,
    mime          TEXT    NOT NULL,
    ext           TEXT    NOT NULL,
    bytes         INTEGER NOT NULL,
    sha256        TEXT    NOT NULL,
    width         INTEGER,
    height        INTEGER,
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL,
    views         INTEGER NOT NULL DEFAULT 0,
    title         TEXT,
    visibility    TEXT    NOT NULL DEFAULT 'public'
                          CHECK (visibility IN ('public','private'))
  );

  CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_images_sha     ON images(sha256);
`);

/* Migration: databases created before OIDC support existed need these two
   columns added. Both default to NULL, which leaves every existing user on
   password-only login exactly as before -- OIDC only activates for a user
   once an admin explicitly sets their email. */
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE');
  console.log('[migration] added users.email');
}
if (!userColumns.includes('oidc_subject')) {
  db.exec('ALTER TABLE users ADD COLUMN oidc_subject TEXT');
  console.log('[migration] added users.oidc_subject');
}
// Runs after the migration above, so the email column is guaranteed to exist
// by this point on both a fresh database and an upgraded one.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');

/* Migration: databases created before per-image visibility existed need the
   column added. Existing images stay public, which is what they already were,
   so an upgrade never silently changes who can see what. */
const imageColumns = db.prepare('PRAGMA table_info(images)').all().map((c) => c.name);
if (!imageColumns.includes('visibility')) {
  db.exec(`ALTER TABLE images ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`);
  console.log('[migration] added images.visibility, existing images left public');
}
if (!imageColumns.includes('title')) {
  db.exec('ALTER TABLE images ADD COLUMN title TEXT');
  // Seed titles from the original filenames so an upgraded library is not
  // suddenly a wall of blank captions.
  db.exec(`
    UPDATE images
       SET title = REPLACE(
             CASE WHEN INSTR(original_name, '.') > 0
                  THEN SUBSTR(original_name, 1, LENGTH(original_name) - LENGTH(ext) - 1)
                  ELSE original_name END,
             '_', ' ')
     WHERE title IS NULL AND original_name IS NOT NULL
  `);
  console.log('[migration] added images.title, seeded from original filenames');
}

export const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ? AND disabled = 0'),
  listUsers: db.prepare('SELECT id, username, email, oidc_subject, created_at, disabled FROM users ORDER BY id'),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, email, created_at) VALUES (?, ?, ?, ?)'
  ),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE username = ?'),
  setEmail: db.prepare('UPDATE users SET email = ?, oidc_subject = NULL WHERE username = ?'),
  setOidcSubject: db.prepare('UPDATE users SET oidc_subject = ? WHERE id = ?'),

  insertSession: db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ),
  sessionById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  insertImage: db.prepare(`
    INSERT INTO images (id, filename, original_name, mime, ext, bytes, sha256, width, height, uploaded_by, created_at, visibility, title)
    VALUES (@id, @filename, @original_name, @mime, @ext, @bytes, @sha256, @width, @height, @uploaded_by, @created_at, @visibility, @title)
  `),
  setVisibility: db.prepare('UPDATE images SET visibility = ? WHERE id = ?'),
  setTitle: db.prepare('UPDATE images SET title = ? WHERE id = ?'),
  setTitle: db.prepare('UPDATE images SET title = ? WHERE id = ?'),
  imageById: db.prepare('SELECT * FROM images WHERE id = ?'),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ?'),
  bumpViews: db.prepare('UPDATE images SET views = views + 1 WHERE id = ?'),
  listImages: db.prepare(`
    SELECT i.*, u.username AS uploader
    FROM images i LEFT JOIN users u ON u.id = i.uploaded_by
    ORDER BY i.created_at DESC
    LIMIT ? OFFSET ?
  `),
  searchImages: db.prepare(`
    SELECT i.*, u.username AS uploader
    FROM images i LEFT JOIN users u ON u.id = i.uploaded_by
    WHERE i.title LIKE '%' || @term || '%' COLLATE NOCASE
       OR i.original_name LIKE '%' || @term || '%' COLLATE NOCASE
       OR i.id = @term
    ORDER BY i.created_at DESC
    LIMIT @limit OFFSET @offset
  `),
  // Matches title, original filename or ID. LIKE with an escaped pattern
  // keeps this a parameterised query -- no string concatenation into SQL.
  searchImages: db.prepare(`
    SELECT i.*, u.username AS uploader
    FROM images i LEFT JOIN users u ON u.id = i.uploaded_by
    WHERE i.title LIKE @like ESCAPE '\\'
       OR i.original_name LIKE @like ESCAPE '\\'
       OR i.id LIKE @like ESCAPE '\\'
    ORDER BY i.created_at DESC
    LIMIT @limit OFFSET @offset
  `),
  countImages: db.prepare(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(bytes),0) AS b,
           COALESCE(SUM(visibility = 'private'),0) AS private_n
    FROM images
  `),
};

// Drop expired sessions on boot, then hourly.
q.deleteExpiredSessions.run(Date.now());
setInterval(() => {
  try {
    q.deleteExpiredSessions.run(Date.now());
  } catch { /* non-fatal */ }
}, 60 * 60 * 1000).unref();
