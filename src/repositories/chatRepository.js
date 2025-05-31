const database = require('../config/database');

class ChatRepository {
    /**
     * Add a new chat message to history
     * @param {string} sessionId Unique session identifier
     * @param {string} role Message role (user/assistant)
     * @param {string} content Message content
     * @returns {Promise<Object>} Created chat message
     */
    async addMessage(sessionId, role, content) {
        const query = `
            INSERT INTO chat_history (session_id, role, content)
            VALUES (?, ?, ?)
        `;
        const params = [sessionId, role, content];
        
        const result = await database.run(query, params);
        return this.getMessageById(result.lastID);
    }

    /**
     * Get message by ID
     * @param {number} id Message ID
     * @returns {Promise<Object>} Chat message object
     */
    async getMessageById(id) {
        const query = 'SELECT * FROM chat_history WHERE id = ?';
        return database.get(query, [id]);
    }

    /**
     * Get chat history for a session
     * @param {string} sessionId Session identifier
     * @param {number} limit Maximum number of messages to return
     * @returns {Promise<Array>} Array of chat messages
     */
    async getSessionHistory(sessionId, limit = 50) {
        const query = `
            SELECT * FROM chat_history 
            WHERE session_id = ? 
            ORDER BY created_at ASC 
            LIMIT ?
        `;
        return database.all(query, [sessionId, limit]);
    }

    /**
     * Get recent chat sessions
     * @param {number} limit Maximum number of sessions to return
     * @returns {Promise<Array>} Array of unique session IDs with their last message
     */
    async getRecentSessions(limit = 10) {
        const query = `
            SELECT DISTINCT 
                session_id,
                MAX(created_at) as last_message_at,
                COUNT(*) as message_count
            FROM chat_history 
            GROUP BY session_id 
            ORDER BY last_message_at DESC 
            LIMIT ?
        `;
        return database.all(query, [limit]);
    }

    /**
     * Delete chat history for a session
     * @param {string} sessionId Session identifier
     * @returns {Promise<void>}
     */
    async deleteSessionHistory(sessionId) {
        const query = 'DELETE FROM chat_history WHERE session_id = ?';
        return database.run(query, [sessionId]);
    }

    /**
     * Clear old chat history
     * @param {number} daysToKeep Number of days of history to retain
     * @returns {Promise<void>}
     */
    async clearOldHistory(daysToKeep = 30) {
        const query = `
            DELETE FROM chat_history 
            WHERE created_at < datetime('now', '-' || ? || ' days')
        `;
        return database.run(query, [daysToKeep]);
    }
}

module.exports = new ChatRepository(); 