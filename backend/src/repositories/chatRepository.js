const db = require('../config/database');

class ChatRepository {
  getChatHistory(serverId, sessionId, date = null) {
    let query = `SELECT id, role, message, created_at, ai_request_context FROM chat_history WHERE server_id = ? AND chat_session_id = ?`;
    const params = [serverId, sessionId];

    if (date) {
      query += ` AND DATE(created_at) = ?`;
      params.push(date);
    }
    query += ` ORDER BY created_at ASC`;

    return db.prepare(query).all(...params);
  }

  addUserMessage(serverId, message, chatSessionId) {
    const stmt = db.prepare('INSERT INTO chat_history (server_id, role, message, chat_session_id) VALUES (?, ?, ?, ?)');
    const info = stmt.run(serverId, 'user', message, chatSessionId);
    return { id: info.lastInsertRowid };
  }

  addAIMessage(serverId, message, chatSessionId, aiRequestContext) {
    const stmt = db.prepare('INSERT INTO chat_history (server_id, role, message, chat_session_id, ai_request_context) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(serverId, 'ai', message, chatSessionId, aiRequestContext);
    return { id: info.lastInsertRowid };
  }

  updateUserMessage(messageId, serverId, message, chatSessionId) {
    return db.prepare('UPDATE chat_history SET message = ? WHERE id = ? AND role = ? AND server_id = ? AND chat_session_id = ?')
      .run(message, messageId, 'user', serverId, chatSessionId);
  }

  updateAIMessage(messageId, serverId, message, chatSessionId, aiRequestContext) {
    return db.prepare('UPDATE chat_history SET message = ?, ai_request_context = ? WHERE id = ? AND role = ? AND server_id = ? AND chat_session_id = ?')
      .run(message, aiRequestContext, messageId, 'ai', serverId, chatSessionId);
  }

  getNextAIMessage(messageId, serverId, chatSessionId) {
    return db.prepare(
      'SELECT id FROM chat_history WHERE server_id = ? AND chat_session_id = ? AND role = ? AND id > ? ORDER BY created_at ASC LIMIT 1'
    ).get(serverId, chatSessionId, 'ai', messageId);
  }

  getChatSessions(serverId) {
    return db.prepare(`
      SELECT DISTINCT 
        chat_session_id as sessionId,
        MIN(created_at) as startTime,
        COUNT(*) as messageCount,
        (SELECT message FROM chat_history ch2 
         WHERE ch2.server_id = chat_history.server_id 
         AND ch2.chat_session_id = chat_history.chat_session_id 
         AND ch2.role = 'user' 
         ORDER BY ch2.created_at ASC LIMIT 1) as firstMessage,
        'Session ' || chat_session_id as label
      FROM chat_history 
      WHERE server_id = ? 
      GROUP BY chat_session_id 
      ORDER BY MIN(created_at) DESC
    `).all(serverId);
  }
}

module.exports = new ChatRepository(); 