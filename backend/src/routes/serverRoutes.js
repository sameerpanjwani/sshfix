const express = require('express');
const router = express.Router();
const serverRepository = require('../repositories/serverRepository');
const sshService = require('../services/sshService');

// List servers
router.get('/', (req, res) => {
  try {
    const servers = serverRepository.listServers();
    res.json(servers);
  } catch (error) {
    console.error('Error listing servers:', error);
    res.status(500).json({ error: 'Failed to list servers: ' + error.message });
  }
});

// Add server
router.post('/', (req, res) => {
  try {
    const { name, host, port, username, password, privateKey } = req.body;
    
    // Validate required fields
    if (!name || !host || !username) {
      return res.status(400).json({ error: 'Name, host, and username are required' });
    }

    const serverId = serverRepository.addServer(name, host, port, username, password, privateKey);
    res.json({ id: serverId });
  } catch (error) {
    console.error('Error adding server:', error);
    res.status(500).json({ error: 'Failed to add server: ' + error.message });
  }
});

// Get server by id
router.get('/:id', (req, res) => {
  try {
    const server = serverRepository.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    res.json(server);
  } catch (error) {
    console.error('Error getting server:', error);
    res.status(500).json({ error: 'Failed to get server: ' + error.message });
  }
});

// Delete server
router.delete('/:id', (req, res) => {
  try {
    const result = serverRepository.deleteServer(req.params.id);
    res.json({ success: result });
  } catch (error) {
    console.error('Error deleting server:', error);
    res.status(500).json({ error: 'Failed to delete server: ' + error.message });
  }
});

// List history for a server
router.get('/:id/history', (req, res) => {
  try {
    const history = serverRepository.getServerHistory(req.params.id);
    res.json(history);
  } catch (error) {
    console.error('Error getting server history:', error);
    res.status(500).json({ error: 'Failed to get server history: ' + error.message });
  }
});

// Add terminal history
router.post('/:id/history', (req, res) => {
  const serverId = parseInt(req.params.id);
  const { command, output } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  try {
    const currentSession = serverRepository.getCurrentSession(serverId);
    const sessionId = currentSession?.chat_session_id || null;

    console.log('[HISTORY] Added command', JSON.stringify(command), 'to server', serverId, 'session', sessionId);

    serverRepository.addHistory(serverId, command, output, sessionId);

    const history = serverRepository.getServerHistory(serverId);
    res.json(history);
  } catch (error) {
    console.error('Error adding history:', error);
    res.status(500).json({ error: 'Failed to add history: ' + error.message });
  }
});

// Get context for a server
router.get('/:id/context', (req, res) => {
  try {
    const context = serverRepository.getServerContext(req.params.id);
    res.json(context);
  } catch (error) {
    console.error('Error getting server context:', error);
    res.status(500).json({ error: 'Failed to get server context: ' + error.message });
  }
});

// Set context key/value
router.post('/:id/context', (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }
    const result = serverRepository.setServerContext(req.params.id, key, value);
    res.json(result);
  } catch (error) {
    console.error('Error setting server context:', error);
    res.status(500).json({ error: 'Failed to set server context: ' + error.message });
  }
});

// SSH Command Execution
router.post('/:id/ssh', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }
    const result = await sshService.executeCommand(req.params.id, command);
    res.json(result);
  } catch (error) {
    console.error('Error executing SSH command:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test SSH Connection
router.post('/:id/test', async (req, res) => {
  try {
    const result = await sshService.testConnection(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('Error testing SSH connection:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test New Server Connection
router.post('/test-connection', async (req, res) => {
  try {
    const { host, port, username, password, privateKey } = req.body;
    
    // Validate required fields
    if (!host || !username) {
      return res.status(400).json({ error: 'Host and username are required' });
    }
    
    const result = await sshService.testNewConnection({ host, port, username, password, privateKey });
    res.json(result);
  } catch (error) {
    console.error('Error testing new connection:', error);
    res.status(500).json({ error: error.message });
  }
});

// List chat sessions for a server
router.get('/:id/chat-sessions', (req, res) => {
  const serverId = parseInt(req.params.id);
  try {
    const sessions = serverRepository.db.prepare(`
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
    
    // Format the sessions for frontend display
    const formattedSessions = sessions.map(s => ({
      ...s,
      startTime: new Date(s.startTime).toISOString(),
      messageCount: parseInt(s.messageCount),
      firstMessage: s.firstMessage || 'No messages'
    }));
    
    res.json(formattedSessions);
  } catch (error) {
    console.error('Error fetching chat sessions:', error);
    res.status(500).json({ error: 'Failed to fetch chat sessions' });
  }
});

// Update chat session tracking
router.post('/:id/set-chat-session', (req, res) => {
  const serverId = parseInt(req.params.id);
  const { sessionId } = req.body;
  
  console.log(`[CHAT SESSION] Received sessionId: "${sessionId}" for server ${serverId}`);
  
  if (!sessionId || typeof sessionId !== 'string') {
    console.error(`[CHAT SESSION] Invalid sessionId: ${sessionId}`);
    return res.status(400).json({ error: 'Valid sessionId is required' });
  }
  
  // Normalize the session ID by removing any trailing .0
  const normalizedSessionId = sessionId.endsWith('.0') 
    ? sessionId.substring(0, sessionId.length - 2)
    : sessionId;
  
  // Update the current session in the repository
  try {
    serverRepository.db.prepare('UPDATE servers SET chat_session_id = ? WHERE id = ?')
      .run(normalizedSessionId, serverId);
    console.log(`[CHAT SESSION] Server ${serverId} now using session ${normalizedSessionId}`);
    
    // Update all history entries with server-X-session-default to use this session ID
    serverRepository.db.prepare(`
      UPDATE history 
      SET chat_session_id = ? 
      WHERE server_id = ? AND chat_session_id LIKE 'server-%-session-default'
    `).run(normalizedSessionId, serverId);
    console.log(`[CHAT SESSION] Updated history entries with default session to use ${normalizedSessionId}`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[CHAT SESSION] Error updating session:', error);
    res.status(500).json({ error: 'Failed to update chat session' });
  }
});

module.exports = router; 