const { Client } = require('ssh2');
const fs = require('fs').promises;
const serverRepository = require('../repositories/serverRepository');

class SSHService {
    constructor() {
        this.activeConnections = new Map();
    }

    /**
     * Create a new SSH connection
     * @param {Object} serverConfig Server configuration
     * @returns {Promise<Client>} SSH client instance
     */
    async connect(serverConfig) {
        return new Promise((resolve, reject) => {
            const client = new Client();
            
            const config = {
                host: serverConfig.host,
                port: serverConfig.port,
                username: serverConfig.username,
                readyTimeout: 20000
            };

            // Add authentication method
            if (serverConfig.privateKey) {
                config.privateKey = serverConfig.privateKey;
            } else if (serverConfig.password) {
                config.password = serverConfig.password;
            } else {
                reject(new Error('No authentication method provided'));
                return;
            }

            client
                .on('ready', () => {
                    this.activeConnections.set(serverConfig.id, client);
                    resolve(client);
                })
                .on('error', (err) => {
                    reject(err);
                })
                .connect(config);
        });
    }

    /**
     * Execute a command on the server
     * @param {number} serverId Server ID
     * @param {string} command Command to execute
     * @returns {Promise<{output: string, exitCode: number}>} Command result
     */
    async executeCommand(serverId, command) {
        const server = await serverRepository.getServerById(serverId);
        if (!server) {
            throw new Error('Server not found');
        }

        let client = this.activeConnections.get(serverId);
        if (!client) {
            client = await this.connect(server);
        }

        return new Promise((resolve, reject) => {
            client.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let output = '';
                let errorOutput = '';

                stream
                    .on('data', (data) => {
                        output += data.toString();
                    })
                    .stderr.on('data', (data) => {
                        errorOutput += data.toString();
                    });

                stream
                    .on('close', (code) => {
                        // Save command to history
                        serverRepository.addCommandHistory(
                            serverId,
                            command,
                            output + (errorOutput ? `\nErrors:\n${errorOutput}` : '')
                        );

                        resolve({
                            output: output + (errorOutput ? `\nErrors:\n${errorOutput}` : ''),
                            exitCode: code
                        });
                    })
                    .on('error', reject);
            });
        });
    }

    /**
     * Upload a file to the server
     * @param {number} serverId Server ID
     * @param {string} localPath Local file path
     * @param {string} remotePath Remote file path
     * @returns {Promise<void>}
     */
    async uploadFile(serverId, localPath, remotePath) {
        const server = await serverRepository.getServerById(serverId);
        if (!server) {
            throw new Error('Server not found');
        }

        let client = this.activeConnections.get(serverId);
        if (!client) {
            client = await this.connect(server);
        }

        return new Promise((resolve, reject) => {
            client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.fastPut(localPath, remotePath, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    /**
     * Download a file from the server
     * @param {number} serverId Server ID
     * @param {string} remotePath Remote file path
     * @param {string} localPath Local file path
     * @returns {Promise<void>}
     */
    async downloadFile(serverId, remotePath, localPath) {
        const server = await serverRepository.getServerById(serverId);
        if (!server) {
            throw new Error('Server not found');
        }

        let client = this.activeConnections.get(serverId);
        if (!client) {
            client = await this.connect(server);
        }

        return new Promise((resolve, reject) => {
            client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                sftp.fastGet(remotePath, localPath, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        });
    }

    /**
     * Close an SSH connection
     * @param {number} serverId Server ID
     */
    disconnect(serverId) {
        const client = this.activeConnections.get(serverId);
        if (client) {
            client.end();
            this.activeConnections.delete(serverId);
        }
    }

    /**
     * Close all active SSH connections
     */
    disconnectAll() {
        for (const [serverId, client] of this.activeConnections) {
            client.end();
            this.activeConnections.delete(serverId);
        }
    }
}

module.exports = new SSHService(); 