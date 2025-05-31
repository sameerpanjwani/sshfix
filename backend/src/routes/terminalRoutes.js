const express = require('express');
const router = express.Router();
const terminalSuggestionService = require('../services/terminalSuggestionService');
const serverRepository = require('../repositories/serverRepository');

// Add a test endpoint to check if this route is accessible
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Terminal routes are working!' });
});

// Get command suggestions based on terminal history
router.post('/suggest', async (req, res) => {
  console.log('[terminalRoutes] POST /suggest request received:', {
    bodyKeys: Object.keys(req.body),
    hasEntries: Array.isArray(req.body.entries),
    entriesLength: Array.isArray(req.body.entries) ? req.body.entries.length : 0,
    latestCommand: req.body.latestCommand,
    serverId: req.body.serverId,
    sessionId: req.body.sessionId
  });
  
  try {
    const { entries, latestCommand, serverId, sessionId } = req.body;
    console.log('[terminalRoutes] Calling terminalSuggestionService.getSuggestions...');
    const result = await terminalSuggestionService.getSuggestions({
      entries,
      latestCommand,
      serverId,
      sessionId
    });
    
    console.log('[terminalRoutes] Suggestion result received:', {
      hasResponse: !!result.response,
      hasJson: !!result.json,
      jsonType: result.json ? typeof result.json : 'undefined',
      jsonKeys: result.json ? Object.keys(result.json) : []
    });
    
    res.json(result);
  } catch (error) {
    console.error('[terminalRoutes] Error getting suggestions:', error);
    res.status(500).json({ error: 'Failed to get suggestions', details: error.message });
  }
});

// Add history entry and get suggestion in one call
router.post('/history-with-suggestion', async (req, res) => {
  try {
    const { serverId, command, output, sessionId } = req.body;
    
    if (!serverId || !command) {
      return res.status(400).json({ error: 'serverId and command are required' });
    }
    
    console.log('[terminalRoutes] Adding history entry:', { serverId, command, sessionId });
    
    // Save the history entry using the saveHistory method
    if (serverRepository.saveHistory) {
      await serverRepository.saveHistory(serverId, {
        command,
        output: output || '',
        chat_session_id: sessionId
      });
    } else {
      // Fallback to addHistory if saveHistory doesn't exist
      await serverRepository.addHistory(serverId, command, output || '', sessionId);
    }
    
    // Get the updated history
    const history = serverRepository.getServerHistory(serverId);
    
    // Get the last 6 entries for suggestion context
    const recentEntries = history.slice(0, 6).map(entry => ({
      command: entry.command,
      output: entry.output
    }));
    
    // Get suggestion based on the updated history
    const suggestion = await terminalSuggestionService.getSuggestions({
      entries: recentEntries,
      latestCommand: command,
      serverId,
      sessionId
    });
    
    res.json({
      history,
      suggestion
    });
  } catch (error) {
    console.error('[terminalRoutes] Error in history-with-suggestion:', error);
    res.status(500).json({ error: 'Failed to process history with suggestion', details: error.message });
  }
});

// Get alternative command suggestions
router.post('/suggest-alt', async (req, res) => {
  console.log('[terminalRoutes] POST /suggest-alt request received');
  
  try {
    const { entries, previousSuggestion } = req.body;
    console.log('[terminalRoutes] Calling terminalSuggestionService.getAlternativeSuggestions...');
    const result = await terminalSuggestionService.getAlternativeSuggestions({
      entries,
      previousSuggestion
    });
    console.log('[terminalRoutes] Got result from getAlternativeSuggestions:', 
      result ? 'success' : 'null or undefined');
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