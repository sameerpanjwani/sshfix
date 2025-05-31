const express = require('express');
const router = express.Router();
const chatRepository = require('../repositories/chatRepository');
const aiService = require('../services/aiService');

// Get chat history for a server
router.get('/:id/chat', (req, res) => {
  const { date, sessionId } = req.query;
  const serverId = req.params.id;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId query parameter is required' });
  }

  const rows = chatRepository.getChatHistory(serverId, sessionId, date);
  
  // For AI messages, try to parse the main message as JSON and add a 'json' field if valid
  const result = rows.map(msg => {
    let processedMsg = { ...msg }; // Clone to avoid modifying original row object from DB
    if (msg.role === 'ai') {
      try {
        const parsedJson = JSON.parse(cleanAIResponse(msg.message));
        if (parsedJson && (typeof parsedJson === 'object') && (parsedJson.answer || parsedJson.commands)) {
          processedMsg.json = parsedJson;
        }
      } catch {
        // If parsing fails, json field remains undefined, original message is still there
      }
    }
    return processedMsg;
  });
  res.json(result);
});

// Add chat message
router.post('/:id/chat', (req, res) => {
  const { role, message, chatSessionId } = req.body;
  const serverId = req.params.id;

  if (!role || !message) return res.status(400).json({ error: 'role and message required' });
  if (!serverId) return res.status(400).json({ error: 'serverId is required' });
  if (!chatSessionId) return res.status(400).json({ error: 'chatSessionId is required in body' });

  try {
    let result;
    if (role === 'user') {
      result = chatRepository.addUserMessage(serverId, message, chatSessionId);
    } else {
      return res.status(400).json({ error: 'AI messages should be created via /api/ai to include request context.'});
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process AI request
router.post('/ai', async (req, res) => {
  try {
    const result = await aiService.processAIRequest({
      ...req.body,
      req
    });
    res.json(result);
  } catch (error) {
    console.error('AI endpoint error:', error);
    res.status(500).json({ error: error.message || 'Unknown server error', details: error.response?.data || null });
  }
});

// Get available AI models
router.get('/available', async (req, res) => {
  const models = await aiService.getAvailableModels();
  res.json(models);
});

// List chat sessions for a server
router.get('/:id/chat-sessions', (req, res) => {
  try {
    const sessions = chatRepository.getChatSessions(req.params.id);
    
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

module.exports = router; 