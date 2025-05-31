const database = require('../config/database');

class ServerRepository {
    /**
     * Create a new server entry
     * @param {Object} serverData Server configuration data
     * @returns {Promise<Object>} Created server object
     */
    async createServer(serverData) {
        const query = `
            INSERT INTO servers (name, host, port, username, password, privateKey)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const params = [
            serverData.name,
            serverData.host,
            serverData.port,
            serverData.username,
            serverData.password,
            serverData.privateKey
        ];

        const result = await database.run(query, params);
        return this.getServerById(result.lastID);
    }

    /**
     * Get server by ID
     * @param {number} id Server ID
     * @returns {Promise<Object>} Server object
     */
    async getServerById(id) {
        const query = 'SELECT * FROM servers WHERE id = ?';
        return database.get(query, [id]);
    }

    /**
     * Get all servers
     * @returns {Promise<Array>} Array of server objects
     */
    async getAllServers() {
        const query = 'SELECT * FROM servers ORDER BY created_at DESC';
        return database.all(query);
    }

    /**
     * Update server configuration
     * @param {number} id Server ID
     * @param {Object} serverData Updated server data
     * @returns {Promise<Object>} Updated server object
     */
    async updateServer(id, serverData) {
        const query = `
            UPDATE servers 
            SET name = ?, host = ?, port = ?, username = ?, 
                password = COALESCE(?, password), 
                privateKey = COALESCE(?, privateKey)
            WHERE id = ?
        `;
        const params = [
            serverData.name,
            serverData.host,
            serverData.port,
            serverData.username,
            serverData.password,
            serverData.privateKey,
            id
        ];

        await database.run(query, params);
        return this.getServerById(id);
    }

    /**
     * Delete server by ID
     * @param {number} id Server ID
     * @returns {Promise<void>}
     */
    async deleteServer(id) {
        const query = 'DELETE FROM servers WHERE id = ?';
        return database.run(query, [id]);
    }

    /**
     * Add command to history
     * @param {number} serverId Server ID
     * @param {string} command Executed command
     * @param {string} output Command output
     * @returns {Promise<Object>} Created history entry
     */
    async addCommandHistory(serverId, command, output) {
        const query = `
            INSERT INTO command_history (server_id, command, output)
            VALUES (?, ?, ?)
        `;
        const params = [serverId, command, output];
        
        return database.run(query, params);
    }

    /**
     * Get command history for a server
     * @param {number} serverId Server ID
     * @param {number} limit Maximum number of entries to return
     * @returns {Promise<Array>} Array of history entries
     */
    async getCommandHistory(serverId, limit = 100) {
        const query = `
            SELECT * FROM command_history 
            WHERE server_id = ? 
            ORDER BY executed_at DESC 
            LIMIT ?
        `;
        return database.all(query, [serverId, limit]);
    }
}

module.exports = new ServerRepository(); 