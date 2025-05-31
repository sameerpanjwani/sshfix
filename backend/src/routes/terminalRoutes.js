const express = require('express');
const router = express.Router();
const terminalSuggestionService = require('../services/terminalSuggestionService');

// Get command suggestions based on terminal history
router.post('/suggest', async (req, res) => {
  try {
    const { entries, latestCommand, serverId, sessionId } = req.body;
    const result = await terminalSuggestionService.getSuggestions({
      entries,
      latestCommand,
      serverId,
      sessionId
    });
    res.json(result);
  } catch (error) {
    console.error('Terminal suggestion error:', error);
    res.status(500).json({ 
      error: 'Failed to get suggestions',
      details: error?.response?.data?.error || error.message
    });
  }
});

// Get alternative command suggestions
router.post('/suggest-alt', async (req, res) => {
  try {
    const { entries, previousSuggestion } = req.body;
    const result = await terminalSuggestionService.getAlternativeSuggestions({
      entries,
      previousSuggestion
    });
    res.json(result);
  } catch (error) {
    console.error('Terminal alternative suggestion error:', error);
    res.status(500).json({ 
      error: 'Failed to get alternative suggestions',
      details: error?.response?.data?.error || error.message
    });
  }
});

module.exports = router; 