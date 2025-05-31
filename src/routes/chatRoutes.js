const express = require('express');
const router = express.Router();
const chatRepository = require('../repositories/chatRepository');
const aiService = require('../services/aiService');
const upload = require('../config/multer');
const { v4: uuidv4 } = require('uuid');

// Get chat history for a session
router.get('/history/:sessionId', async (req, res) => {
    try {
        const history = await chatRepository.getSessionHistory(
            req.params.sessionId,
            parseInt(req.query.limit) || 50
        );
        res.json(history);
    } catch (error) {
        console.error('Error fetching chat history:', error);
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

// Get recent chat sessions
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await chatRepository.getRecentSessions(
            parseInt(req.query.limit) || 10
        );
        res.json(sessions);
    } catch (error) {
        console.error('Error fetching chat sessions:', error);
        res.status(500).json({ error: 'Failed to fetch chat sessions' });
    }
});

// Process chat message with OpenAI
router.post('/openai', async (req, res) => {
    try {
        const { sessionId, message, options } = req.body;
        
        // Save user message
        await chatRepository.addMessage(
            sessionId || uuidv4(),
            'user',
            message
        );

        // Get chat history for context
        const history = await chatRepository.getSessionHistory(sessionId);
        
        // Process with OpenAI
        const response = await aiService.processWithOpenAI(history, options);
        
        // Save assistant response
        const savedResponse = await chatRepository.addMessage(
            sessionId,
            'assistant',
            response
        );

        res.json(savedResponse);
    } catch (error) {
        console.error('Error processing OpenAI chat:', error);
        res.status(500).json({ error: 'Failed to process chat message' });
    }
});

// Process chat message with Gemini
router.post('/gemini', async (req, res) => {
    try {
        const { sessionId, message, options } = req.body;
        
        // Save user message
        await chatRepository.addMessage(
            sessionId || uuidv4(),
            'user',
            message
        );

        // Get chat history for context
        const history = await chatRepository.getSessionHistory(sessionId);
        
        // Process with Gemini
        const response = await aiService.processWithGemini(history, options);
        
        // Save assistant response
        const savedResponse = await chatRepository.addMessage(
            sessionId,
            'assistant',
            response
        );

        res.json(savedResponse);
    } catch (error) {
        console.error('Error processing Gemini chat:', error);
        res.status(500).json({ error: 'Failed to process chat message' });
    }
});

// Process chat message with Claude
router.post('/claude', async (req, res) => {
    try {
        const { sessionId, message, options } = req.body;
        
        // Save user message
        await chatRepository.addMessage(
            sessionId || uuidv4(),
            'user',
            message
        );

        // Get chat history for context
        const history = await chatRepository.getSessionHistory(sessionId);
        
        // Process with Claude
        const response = await aiService.processWithClaude(history, options);
        
        // Save assistant response
        const savedResponse = await chatRepository.addMessage(
            sessionId,
            'assistant',
            response
        );

        res.json(savedResponse);
    } catch (error) {
        console.error('Error processing Claude chat:', error);
        res.status(500).json({ error: 'Failed to process chat message' });
    }
});

// Generate image with DALL-E
router.post('/generate-image', async (req, res) => {
    try {
        const { prompt, options } = req.body;
        const imagePath = await aiService.generateImage(prompt, options);
        res.json({ imagePath });
    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).json({ error: 'Failed to generate image' });
    }
});

// Analyze image with GPT-4 Vision
router.post('/analyze-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const analysis = await aiService.analyzeImage(
            req.file.path,
            req.body.prompt || 'Describe this image'
        );

        res.json({ analysis });
    } catch (error) {
        console.error('Error analyzing image:', error);
        res.status(500).json({ error: 'Failed to analyze image' });
    }
});

// Delete chat history for a session
router.delete('/history/:sessionId', async (req, res) => {
    try {
        await chatRepository.deleteSessionHistory(req.params.sessionId);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting chat history:', error);
        res.status(500).json({ error: 'Failed to delete chat history' });
    }
});

module.exports = router; 