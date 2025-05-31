const Database = require('better-sqlite3');
const path = require('path');

class ServerRepository {
  constructor() {
    this.db = new Database(path.join(__dirname, '../../sshfix.db'));
  }

  getSessionHistory(serverId, sessionId) {
    console.log('[ServerRepository] Getting session history for server:', serverId, 'session:', sessionId);
    
    // Normalize session ID to handle potential different formats
    let normalizedSessionId = String(sessionId);
    if (normalizedSessionId.endsWith('.0')) {
      normalizedSessionId = normalizedSessionId.replace('.0', '');
    }
    
    // Format for when sessionId is prefixed with server-X-session-
    const alternateSessionId = `server-${serverId}-session-${normalizedSessionId}`;
    
    // Try different sessionId formats
    const query = `
      SELECT * FROM history
      WHERE server_id = ? AND (
        chat_session_id = ? OR
        chat_session_id = ? OR
        (chat_session_id IS NULL AND server_id = ?)
      )
      ORDER BY created_at ASC
    `;
    
    try {
      const results = this.db.prepare(query).all(
        serverId, 
        normalizedSessionId, 
        alternateSessionId,
        serverId
      );
      
      console.log('[ServerRepository] Found', results.length, 'history entries');
      return results;
    } catch (error) {
      console.error('[ServerRepository] Error getting session history:', error);
      return [];
    }
  }

  getServer(serverId) {
    try {
      return this.db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    } catch (error) {
      console.error('[ServerRepository] Error getting server:', error);
      throw error;
    }
  }

  checkServerExists(host, username) {
    try {
      const server = this.db.prepare('SELECT * FROM servers WHERE host = ? AND username = ?').get(host, username);
      return !!server;
    } catch (error) {
      console.error('[ServerRepository] Error checking server existence:', error);
      throw error;
    }
  }

  addServer(name, host, port, username, password, privateKey) {
    try {
      // Check if server with same host and username already exists
      const exists = this.checkServerExists(host, username);
      if (exists) {
        throw new Error('Server with this host and username already exists');
      }

      const stmt = this.db.prepare('INSERT INTO servers (name, host, port, username, password, privateKey) VALUES (?, ?, ?, ?, ?, ?)');
      const info = stmt.run(name, host, port || 22, username, password, privateKey);
      return info.lastInsertRowid;
    } catch (error) {
      console.error('[ServerRepository] Error adding server:', error);
      throw error;
    }
  }

  deleteServer(serverId) {
    try {
      this.db.prepare('DELETE FROM servers WHERE id = ?').run(serverId);
      return true;
    } catch (error) {
      console.error('[ServerRepository] Error deleting server:', error);
      throw error;
    }
  }

  listServers() {
    try {
      return this.db.prepare('SELECT * FROM servers').all();
    } catch (error) {
      console.error('[ServerRepository] Error listing servers:', error);
      throw error;
    }
  }

  addHistory(serverId, command, output, chatSessionId = null) {
    try {
      // If no chat session ID is provided, try to get the current session
      let sessionId = chatSessionId;
      if (!sessionId) {
        const server = this.getCurrentSession(serverId);
        sessionId = server ? server.chat_session_id : null;
        console.log('[ServerRepository] Using current session ID:', sessionId, 'for server', serverId);
      }
      
      // Insert the history entry with the session ID
      const stmt = this.db.prepare('INSERT INTO history (server_id, command, output, chat_session_id) VALUES (?, ?, ?, ?)');
      const info = stmt.run(serverId, command, output, sessionId);
      
      console.log('[ServerRepository] Added history with ID:', info.lastInsertRowid, 'and session ID:', sessionId);
      return info.lastInsertRowid;
    } catch (error) {
      console.error('[ServerRepository] Error adding history:', error);
      throw error;
    }
  }

  getHistory(serverId) {
    try {
      return this.db.prepare('SELECT id, server_id, command, output, created_at, chat_session_id FROM history WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
    } catch (error) {
      console.error('[ServerRepository] Error getting history:', error);
      throw error;
    }
  }

  getServerHistory(serverId) {
    try {
      return this.db.prepare('SELECT id, server_id, command, output, created_at, chat_session_id FROM history WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
    } catch (error) {
      console.error('[ServerRepository] Error getting server history:', error);
      throw error;
    }
  }

  getServerContext(serverId) {
    try {
      return this.db.prepare('SELECT key, value FROM context WHERE server_id = ?').all(serverId);
    } catch (error) {
      console.error('[ServerRepository] Error getting server context:', error);
      throw error;
    }
  }

  setServerContext(serverId, key, value) {
    try {
      this.db.prepare('INSERT INTO context (server_id, key, value) VALUES (?, ?, ?) ON CONFLICT(server_id, key) DO UPDATE SET value = excluded.value')
        .run(serverId, key, value);
      return { success: true };
    } catch (error) {
      console.error('[ServerRepository] Error setting server context:', error);
      throw error;
    }
  }

  getCurrentSession(serverId) {
    try {
      const result = this.db.prepare('SELECT chat_session_id FROM servers WHERE id = ?').get(serverId);
      console.log('[ServerRepository] Current session for server', serverId, ':', result);
      return result;
    } catch (error) {
      console.error('[ServerRepository] Error getting current session:', error);
      throw error;
    }
  }

  saveHistory(serverId, historyEntry) {
    console.log('[ServerRepository] Saving history for server:', serverId);
    
    try {
      // Check if the server has a current session ID
      const serverInfo = this.db.prepare('SELECT chat_session_id FROM servers WHERE id = ?').get(serverId);
      const sessionId = historyEntry.chat_session_id || (serverInfo ? serverInfo.chat_session_id : null);
      
      console.log('[ServerRepository] Using session ID:', sessionId);
      
      const stmt = this.db.prepare(`
        INSERT INTO history (server_id, command, output, created_at, chat_session_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        serverId,
        historyEntry.command,
        historyEntry.output || '',
        historyEntry.created_at || new Date().toISOString(),
        sessionId
      );
      
      console.log('[ServerRepository] History saved with ID:', result.lastInsertRowid);
      return result.lastInsertRowid;
    } catch (error) {
      console.error('[ServerRepository] Error saving history:', error);
      throw error;
    }
  }
}

module.exports = new ServerRepository(); 