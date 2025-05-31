const Database = require('better-sqlite3');
const path = require('path');

class ServerRepository {
  constructor() {
    this.db = new Database(path.join(__dirname, '../../sshfix.db'));
  }

  async getSessionHistory(serverId, sessionId) {
    try {
      // Get unique commands by using GROUP BY and taking the most recent output for each command
      return this.db.prepare(`
        WITH RankedHistory AS (
          SELECT 
            command,
            output,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY command ORDER BY created_at DESC) as rn
          FROM history 
          WHERE server_id = ? AND chat_session_id = ?
        )
        SELECT command, output, created_at
        FROM RankedHistory
        WHERE rn = 1
        ORDER BY created_at DESC 
        LIMIT 6
      `).all(serverId, sessionId);
    } catch (error) {
      console.error('[ServerRepository] Error getting session history:', error);
      throw error;
    }
  }

  async getServer(serverId) {
    try {
      return this.db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    } catch (error) {
      console.error('[ServerRepository] Error getting server:', error);
      throw error;
    }
  }

  async addServer(name, host, port, username, password, privateKey) {
    try {
      const stmt = this.db.prepare('INSERT INTO servers (name, host, port, username, password, privateKey) VALUES (?, ?, ?, ?, ?, ?)');
      const info = stmt.run(name, host, port || 22, username, password, privateKey);
      return info.lastInsertRowid;
    } catch (error) {
      console.error('[ServerRepository] Error adding server:', error);
      throw error;
    }
  }

  async deleteServer(serverId) {
    try {
      this.db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
      return true;
    } catch (error) {
      console.error('[ServerRepository] Error deleting server:', error);
      throw error;
    }
  }

  async listServers() {
    try {
      return this.db.prepare('SELECT * FROM servers').all();
    } catch (error) {
      console.error('[ServerRepository] Error listing servers:', error);
      throw error;
    }
  }

  async addHistory(serverId, command, output, chatSessionId = null) {
    try {
      const stmt = this.db.prepare('INSERT INTO history (server_id, command, output, chat_session_id) VALUES (?, ?, ?, ?)');
      const info = stmt.run(serverId, command, output, chatSessionId);
      return info.lastInsertRowid;
    } catch (error) {
      console.error('[ServerRepository] Error adding history:', error);
      throw error;
    }
  }

  async getHistory(serverId) {
    try {
      return this.db.prepare('SELECT id, server_id, command, output, created_at, chat_session_id FROM history WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
    } catch (error) {
      console.error('[ServerRepository] Error getting history:', error);
      throw error;
    }
  }

  getServerHistory(serverId) {
    return this.db.prepare('SELECT id, server_id, command, output, created_at, chat_session_id FROM history WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
  }

  getServerContext(serverId) {
    return this.db.prepare('SELECT key, value FROM context WHERE server_id = ?').all(serverId);
  }

  setServerContext(serverId, key, value) {
    this.db.prepare('INSERT INTO context (server_id, key, value) VALUES (?, ?, ?) ON CONFLICT(server_id, key) DO UPDATE SET value = excluded.value')
      .run(serverId, key, value);
    return { success: true };
  }

  getCurrentSession(serverId) {
    return this.db.prepare('SELECT chat_session_id FROM servers WHERE id = ?').get(serverId);
  }
}

module.exports = new ServerRepository(); 