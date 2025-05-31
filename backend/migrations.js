const Database = require('better-sqlite3');
const path = require('path');

function runMigrations() {
  const db = new Database(path.join(__dirname, 'sshfix.db'));
  
  console.log('[MIGRATIONS] Starting database migrations...');
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Create or update servers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      password TEXT,
      privateKey TEXT,
      chat_session_id TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create or update history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER,
      command TEXT NOT NULL,
      output TEXT,
      chat_session_id TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(server_id) REFERENCES servers(id)
    );
  `);
  
  // Create or update context table
  db.exec(`
    CREATE TABLE IF NOT EXISTS context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER,
      key TEXT NOT NULL,
      value TEXT,
      FOREIGN KEY(server_id) REFERENCES servers(id)
    );
  `);
  
  // Create or update chat_history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER,
      role TEXT NOT NULL,
      message TEXT NOT NULL,
      chat_session_id TEXT NOT NULL DEFAULT 'default_session_0',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ai_request_context TEXT NULL,
      FOREIGN KEY(server_id) REFERENCES servers(id)
    );
  `);
  
  // Add chat_session_id to servers table if it doesn't exist
  try {
    db.prepare('SELECT chat_session_id FROM servers LIMIT 1').get();
  } catch (err) {
    if (err.message.includes('no such column')) {
      console.log('[MIGRATIONS] Adding chat_session_id column to servers table...');
      db.exec('ALTER TABLE servers ADD COLUMN chat_session_id TEXT NULL');
    }
  }
  
  // Add chat_session_id to history table if it doesn't exist
  try {
    db.prepare('SELECT chat_session_id FROM history LIMIT 1').get();
  } catch (err) {
    if (err.message.includes('no such column')) {
      console.log('[MIGRATIONS] Adding chat_session_id column to history table...');
      db.exec('ALTER TABLE history ADD COLUMN chat_session_id TEXT NULL');
    }
  }
  
  console.log('[MIGRATIONS] Database migrations completed successfully.');
  db.close();
}

module.exports = { runMigrations }; 