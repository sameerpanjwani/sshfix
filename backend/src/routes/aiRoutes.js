const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const chatRepository = require('../repositories/chatRepository');
const upload = require('../config/multer');
const { v4: uuidv4 } = require('uuid');

// Get available AI models
router.get('/available', async (req, res) => {
  try {
    const models = await aiService.getAvailableModels();
    res.json(models);
  } catch (error) {
    console.error('Error fetching available models:', error);
    res.status(500).json({ error: 'Failed to fetch available models' });
  }
});

// Process AI request
router.post('/', async (req, res) => {
  try {
    const { 
      prompt, 
      model, 
      serverId, 
      chatSessionId, 
      withTerminalContext, 
      newSession, 
      imageUrls,
      edit,
      messageId
    } = req.body;

    // Validate required fields
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    if (!model) return res.status(400).json({ error: 'model is required' });
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    
    // Process the AI request
    const result = await aiService.processAIRequest({
      prompt,
      model,
      serverId,
      chatSessionId: chatSessionId || uuidv4(),
      withTerminalContext,
      systemPrompt: null, // You can add custom system prompts later
      imageUrls,
      messageId,
      edit,
      req
    });
    
    res.json(result);
  } catch (error) {
    console.error('AI processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process AI request',
      details: error?.response?.data?.error || error.message
    });
  }
});

module.exports = router; 