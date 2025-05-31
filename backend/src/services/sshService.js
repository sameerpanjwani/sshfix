const { Client: SSHClient } = require('ssh2');
const serverRepository = require('../repositories/serverRepository');

class SSHService {
  async executeCommand(serverId, command) {
    const server = serverRepository.getServer(serverId);
    if (!server) throw new Error('Server not found');

    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let output = '';

      conn.on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          stream.on('close', (code, signal) => {
            conn.end();
            serverRepository.addHistory(server.id, command, output);
            resolve({ output });
          }).on('data', (data) => {
            output += data.toString();
          }).stderr.on('data', (data) => {
            output += data.toString();
          });
        });
      }).on('error', (err) => {
        reject(err);
      }).connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password || undefined,
        privateKey: server.privateKey || undefined,
      });
    });
  }

  async testConnection(serverId) {
    const server = serverRepository.getServer(serverId);
    if (!server) throw new Error('Server not found');

    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let result = {
        success: false,
        error: null,
        os: null,
        tips: [],
        raw: null
      };
      let timeout;

      conn.on('ready', () => {
        conn.exec('uname -a || ver', (err, stream) => {
          if (err) {
            result.success = true;
            result.os = 'Unknown';
            result.tips.push('Connected, but could not detect OS.');
            conn.end();
            clearTimeout(timeout);
            resolve(result);
            return;
          }

          let osOutput = '';
          stream.on('data', (data) => {
            osOutput += data.toString();
          }).on('close', () => {
            result.success = true;
            result.os = osOutput.trim();
            result.tips.push('SSH connection successful!');
            if (/ubuntu|debian|centos|fedora|linux|unix/i.test(osOutput)) {
              result.tips.push('Detected Linux/Unix server.');
            } else if (/windows|microsoft/i.test(osOutput)) {
              result.tips.push('Detected Windows server.');
            } else {
              result.tips.push('Could not confidently detect OS.');
            }
            conn.end();
            clearTimeout(timeout);
            resolve(result);
          });
        });
      }).on('error', (err) => {
        result.error = err.message;
        if (/timed out|timeout/i.test(err.message)) {
          result.tips.push('Connection timed out. Check network/firewall and server IP/port.');
        } else if (/auth|password|key/i.test(err.message)) {
          result.tips.push('Authentication failed. Verify username, password, or private key.');
        } else if (/ECONNREFUSED|refused/i.test(err.message)) {
          result.tips.push('Connection refused. Is the SSH service running and accessible?');
        } else {
          result.tips.push('Check server address, port, credentials, and network connectivity.');
        }
        clearTimeout(timeout);
        resolve(result);
      }).connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password || undefined,
        privateKey: server.privateKey || undefined,
        readyTimeout: 10000
      });

      timeout = setTimeout(() => {
        result.error = 'Connection timed out.';
        result.tips.push('Check network/firewall and server IP/port.');
        try { conn.end(); } catch {}
        resolve(result);
      }, 12000);
    });
  }

  async testNewConnection({ host, port, username, password, privateKey }) {
    // Check if a server with the same host and username already exists
    try {
      const exists = serverRepository.checkServerExists(host, username);
      if (exists) {
        return {
          success: false,
          error: `A server with host ${host} and username ${username} already exists. Delete the existing server if you wish to update it.`,
          tips: [
            'Each server must have a unique host and username combination.',
            'Check your existing servers to avoid duplicates.',
            'Delete the existing server first if you wish to recreate it with new settings.'
          ]
        };
      }
    } catch (error) {
      console.error('[SSHService] Error checking server existence:', error);
    }

    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let result = {
        success: false,
        error: null,
        os: null,
        tips: [],
        raw: null
      };
      let timeout;

      conn.on('ready', () => {
        conn.exec('uname -a || ver', (err, stream) => {
          if (err) {
            result.success = true;
            result.os = 'Unknown';
            result.tips.push('Connected, but could not detect OS.');
            conn.end();
            clearTimeout(timeout);
            resolve(result);
            return;
          }

          let osOutput = '';
          stream.on('data', (data) => {
            osOutput += data.toString();
          }).on('close', () => {
            result.success = true;
            result.os = osOutput.trim();
            result.tips.push('SSH connection successful!');
            if (/ubuntu|debian|centos|fedora|linux|unix/i.test(osOutput)) {
              result.tips.push('Detected Linux/Unix server.');
            } else if (/windows|microsoft/i.test(osOutput)) {
              result.tips.push('Detected Windows server.');
            } else {
              result.tips.push('Could not confidently detect OS.');
            }
            conn.end();
            clearTimeout(timeout);
            resolve(result);
          });
        });
      }).on('error', (err) => {
        result.error = err.message;
        if (/timed out|timeout/i.test(err.message)) {
          result.tips.push('Connection timed out. Check network/firewall and server IP/port.');
        } else if (/auth|password|key/i.test(err.message)) {
          result.tips.push('Authentication failed. Verify username, password, or private key.');
        } else if (/ECONNREFUSED|refused/i.test(err.message)) {
          result.tips.push('Connection refused. Is the SSH service running and accessible?');
        } else {
          result.tips.push('Check server address, port, credentials, and network connectivity.');
        }
        clearTimeout(timeout);
        resolve(result);
      }).connect({
        host,
        port: port || 22,
        username,
        password: password || undefined,
        privateKey: privateKey || undefined,
        readyTimeout: 10000
      });

      timeout = setTimeout(() => {
        result.error = 'Connection timed out.';
        result.tips.push('Check network/firewall and server IP/port.');
        try { conn.end(); } catch {}
        resolve(result);
      }, 12000);
    });
  }
}

module.exports = new SSHService(); 