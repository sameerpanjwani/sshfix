const Database = require('better-sqlite3');
const path = require('path');
const { runMigrations } = require('../migrations');

// Initialize SQLite database
const db = new Database(path.join(__dirname, '../../sshfix.db'));

// Run migrations
runMigrations();

module.exports = db; 