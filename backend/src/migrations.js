const Database = require('better-sqlite3');
const path = require('path');

function runMigrations() {
  console.log('[MIGRATIONS] Starting database migrations...');
  const db = new Database(path.join(__dirname, '../sshfix.db'));

  try {
    // Create servers table
    db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        password TEXT,
        privateKey TEXT,
        chat_session_id INTEGER
      );
    `);

    // Create history table
    db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        output TEXT,
        chat_session_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
    `);

    // Create context table
    db.exec(`
      CREATE TABLE IF NOT EXISTS context (
        server_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (server_id, key),
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
    `);

    // Create chat_history table
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        message TEXT NOT NULL,
        chat_session_id INTEGER,
        ai_request_context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
    `);

    // Add indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_history_server_id ON history(server_id);
      CREATE INDEX IF NOT EXISTS idx_history_chat_session ON history(chat_session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_history_server_id ON chat_history(server_id);
      CREATE INDEX IF NOT EXISTS idx_chat_history_chat_session ON chat_history(chat_session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at);
    `);

    console.log('[MIGRATIONS] Database migrations completed successfully.');
  } catch (error) {
    console.error('[MIGRATIONS] Error running migrations:', error);
    throw error;
  }
}

module.exports = { runMigrations }; 