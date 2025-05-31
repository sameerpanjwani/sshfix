const WebSocket = require('ws');
const { Client: SSHClient } = require('ssh2');
const serverRepository = require('../repositories/serverRepository');

class TerminalService {
  setupWebSocketServer(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/terminal' });
    
    wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  async handleConnection(ws, req) {
    // Parse serverId from query string: /ws/terminal?serverId=123
    const url = new URL(req.url, `http://${req.headers.host}`);
    const serverId = url.searchParams.get('serverId');
    
    if (!serverId) {
      ws.close(1008, 'Missing serverId');
      return;
    }

    const serverRow = serverRepository.getServerById(serverId);
    if (!serverRow) {
      ws.close(1008, 'Server not found');
      return;
    }

    const conn = new SSHClient();
    let shellStream = null;
    let commandBuffer = '';
    let outputBuffer = '';
    let currentCommand = '';
    let isShellReady = false;

    conn.on('ready', () => {
      conn.shell({ 
        term: 'xterm-color',
        cols: 80,
        rows: 24,
        modes: {
          ECHO: true
        }
      }, (err, stream) => {
        if (err) {
          ws.send(`Shell error: ${err.message}`);
          ws.close();
          conn.end();
          return;
        }

        shellStream = stream;
        isShellReady = true;

        // Handle data from shell
        stream.on('data', (data) => {
          try {
            const text = data.toString('utf8');
            ws.send(text);
            outputBuffer += text;
            
            // Detect command completion by prompt
            const lines = outputBuffer.split(/\r?\n/);
            const lastLine = lines[lines.length - 1];
            const promptPatterns = [
              /[$#%>] ?$/,           // Common Unix/Linux prompts
              />\s*$/,               // Windows prompt
              /\]\$\s*$/,            // Bash with brackets
              /\]#\s*$/,             // Root with brackets
              /❯\s*$/,               // Modern shells (zsh, fish)
              /➜\s*$/,               // Another modern prompt
              /PS [^>]*>\s*$/        // Windows PowerShell prompt
            ];
            
            const hasPrompt = promptPatterns.some(pattern => pattern.test(lastLine));
            
            if (hasPrompt && commandBuffer.trim()) {
              const cleanCommand = commandBuffer.trim();
              // Get everything except the last line (prompt)
              const commandOutput = lines.slice(0, -1).join('\n').trim();
              
              if (cleanCommand && cleanCommand.length > 0) {
                try {
                  serverRepository.addHistory(serverId, cleanCommand, commandOutput);
                  console.log(`[TERMINAL] Logged command "${cleanCommand}" with output length ${commandOutput.length}`);
                } catch (error) {
                  console.error('[TERMINAL] Failed to log command:', error);
                  ws.send(`\r\n\x1b[31m[Error: Failed to log command - ${error.message}]\x1b[0m\r\n`);
                }
              }
              
              // Reset buffers after logging
              commandBuffer = '';
              outputBuffer = '';
              currentCommand = '';
            }
          } catch (error) {
            console.error('[TERMINAL] Error processing shell data:', error);
          }
        });

        // Handle stderr separately
        stream.stderr?.on('data', (data) => {
          try {
            const text = data.toString('utf8');
            ws.send(text);
            outputBuffer += text;
          } catch (error) {
            console.error('[TERMINAL] Error processing stderr:', error);
          }
        });

        stream.on('close', () => {
          ws.close();
          conn.end();
        });

        stream.on('error', (err) => {
          console.error('[TERMINAL] Shell stream error:', err);
          ws.send(`\r\n\x1b[31m[Shell Error: ${err.message}]\x1b[0m\r\n`);
        });
      });
    }).on('error', (err) => {
      console.error('[TERMINAL] SSH connection error:', err);
      ws.send(`\r\n\x1b[31m[SSH Error: ${err.message}]\x1b[0m\r\n`);
      ws.close();
    });

    // Handle incoming data from client
    ws.on('message', (data) => {
      try {
        if (!isShellReady || !shellStream) {
          console.warn('[TERMINAL] Received data before shell ready');
          return;
        }
        const text = data.toString('utf8');
        shellStream.write(text);
        commandBuffer += text;
        
        // If this is a newline, we're starting a new command
        if (text === '\r' || text === '\n') {
          const newCommand = commandBuffer.trim();
          if (newCommand) {
            currentCommand = newCommand;
            outputBuffer = ''; // Reset output buffer for new command
          }
        }
      } catch (error) {
        console.error('[TERMINAL] Error processing client message:', error);
        ws.send(`\r\n\x1b[31m[Internal Error: ${error.message}]\x1b[0m\r\n`);
      }
    });

    // Handle WebSocket closure
    ws.on('close', () => {
      try {
        if (shellStream) {
          shellStream.end();
          shellStream = null;
        }
        if (conn) {
          conn.end();
        }
      } catch (error) {
        console.error('[TERMINAL] Error during cleanup:', error);
      }
    });

    // Connect to the SSH server
    try {
      conn.connect({
        host: serverRow.host,
        port: serverRow.port || 22,
        username: serverRow.username,
        password: serverRow.password || undefined,
        privateKey: serverRow.privateKey || undefined,
      });
    } catch (error) {
      console.error('[TERMINAL] Error initiating SSH connection:', error);
      ws.send(`\r\n\x1b[31m[Connection Error: ${error.message}]\x1b[0m\r\n`);
      ws.close();
    }
  }
}

module.exports = new TerminalService(); 