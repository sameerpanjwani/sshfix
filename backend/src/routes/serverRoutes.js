const express = require('express');
const router = express.Router();
const serverRepository = require('../repositories/serverRepository');
const sshService = require('../services/sshService');

// List servers
router.get('/', (req, res) => {
  const servers = serverRepository.getAllServers();
  res.json(servers);
});

// Add server
router.post('/', (req, res) => {
  const { name, host, port, username, password, privateKey } = req.body;
  const result = serverRepository.createServer({ name, host, port, username, password, privateKey });
  res.json(result);
});

// Get server by id
router.get('/:id', (req, res) => {
  const server = serverRepository.getServerById(req.params.id);
  if (!server) return res.status(404).json({ error: 'Not found' });
  res.json(server);
});

// Delete server
router.delete('/:id', (req, res) => {
  const result = serverRepository.deleteServer(req.params.id);
  res.json(result);
});

// List history for a server
router.get('/:id/history', (req, res) => {
  const history = serverRepository.getServerHistory(req.params.id);
  res.json(history);
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
  const context = serverRepository.getServerContext(req.params.id);
  res.json(context);
});

// Set context key/value
router.post('/:id/context', (req, res) => {
  const { key, value } = req.body;
  const result = serverRepository.setServerContext(req.params.id, key, value);
  res.json(result);
});

// SSH Command Execution
router.post('/:id/ssh', async (req, res) => {
  try {
    const { command } = req.body;
    const result = await sshService.executeCommand(req.params.id, command);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test SSH Connection
router.post('/:id/test', async (req, res) => {
  try {
    const result = await sshService.testConnection(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test New Server Connection
router.post('/test-connection', async (req, res) => {
  try {
    const { host, port, username, password, privateKey } = req.body;
    const result = await sshService.testNewConnection({ host, port, username, password, privateKey });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 