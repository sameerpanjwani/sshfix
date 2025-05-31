const sshService = require('./sshService');
const serverRepository = require('../repositories/serverRepository');

class TerminalService {
    constructor() {
        this.sessions = new Map();
    }

    /**
     * Initialize a new terminal session
     * @param {WebSocket} ws WebSocket connection
     * @param {number} serverId Server ID
     * @returns {Promise<void>}
     */
    async initializeSession(ws, serverId) {
        try {
            const server = await serverRepository.getServerById(serverId);
            if (!server) {
                ws.send(JSON.stringify({ 
                    type: 'error', 
                    message: 'Server not found' 
                }));
                ws.close();
                return;
            }

            // Create SSH connection
            const client = await sshService.connect(server);
            
            // Create interactive shell
            client.shell({ term: 'xterm-color' }, (err, stream) => {
                if (err) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Failed to create shell' 
                    }));
                    ws.close();
                    return;
                }

                // Store session
                this.sessions.set(ws, {
                    serverId,
                    stream,
                    client
                });

                // Handle WebSocket messages
                ws.on('message', (data) => {
                    try {
                        const message = JSON.parse(data);
                        this.handleMessage(ws, message);
                    } catch (error) {
                        console.error('Error handling WebSocket message:', error);
                    }
                });

                // Handle WebSocket close
                ws.on('close', () => {
                    this.closeSession(ws);
                });

                // Handle stream data
                stream.on('data', (data) => {
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'output',
                            data: data.toString()
                        }));
                    }
                });

                // Handle stream close
                stream.on('close', () => {
                    this.closeSession(ws);
                });
            });
        } catch (error) {
            console.error('Error initializing terminal session:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: error.message 
            }));
            ws.close();
        }
    }

    /**
     * Handle incoming WebSocket messages
     * @param {WebSocket} ws WebSocket connection
     * @param {Object} message Parsed message
     */
    handleMessage(ws, message) {
        const session = this.sessions.get(ws);
        if (!session) {
            return;
        }

        switch (message.type) {
            case 'input':
                // Send input to shell
                if (session.stream && message.data) {
                    session.stream.write(message.data);
                }
                break;

            case 'resize':
                // Resize terminal
                if (session.stream && message.rows && message.cols) {
                    session.stream.setWindow(
                        message.rows,
                        message.cols,
                        message.height || 0,
                        message.width || 0
                    );
                }
                break;

            case 'ping':
                // Keep-alive ping
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
        }
    }

    /**
     * Close a terminal session
     * @param {WebSocket} ws WebSocket connection
     */
    closeSession(ws) {
        const session = this.sessions.get(ws);
        if (session) {
            if (session.stream) {
                session.stream.end();
            }
            sshService.disconnect(session.serverId);
            this.sessions.delete(ws);
        }
        
        if (ws.readyState === ws.OPEN) {
            ws.close();
        }
    }

    /**
     * Close all terminal sessions
     */
    closeAllSessions() {
        for (const ws of this.sessions.keys()) {
            this.closeSession(ws);
        }
    }
}

module.exports = new TerminalService(); 