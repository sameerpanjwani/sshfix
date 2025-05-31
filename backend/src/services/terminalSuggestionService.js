const axios = require('axios');
const serverRepository = require('../repositories/serverRepository');

// Cache for recent suggestions to avoid duplicate calls for the same input
const suggestionCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

class TerminalSuggestionService {
  async getSuggestions({ entries, latestCommand, serverId, sessionId }) {
    console.log('[TerminalSuggestionService] Getting suggestions for:', {
      entriesCount: entries?.length,
      latestCommand,
      serverId,
      sessionId
    });
    
    try {
      // Skip if no entries or latest command
      if (!entries || entries.length === 0 || !latestCommand) {
        console.log('[TerminalSuggestionService] Skipping suggestions due to missing data');
        return { 
          response: null,
          json: null,
          error: 'Missing required data'
        };
      }
      
      // Generate a cache key based on input
      const cacheKey = this._generateCacheKey(entries, latestCommand, serverId, sessionId);
      
      // Check cache first
      if (suggestionCache.has(cacheKey)) {
        console.log('[TerminalSuggestionService] Using cached suggestion');
        return suggestionCache.get(cacheKey);
      }
      
      // Get server info to provide context
      const server = serverRepository.getServer(serverId);
      if (!server) {
        console.error('[TerminalSuggestionService] Server not found:', serverId);
        return { error: 'Server not found' };
      }
      
      // Clean entries to only include command and output
      const cleanEntries = entries.map(entry => ({
        command: entry.command || '',
        output: typeof entry.output === 'string' ? entry.output.substring(0, 1000) : ''
      }));
      
      // Prepare prompt with session context
      const prompt = this._buildPrompt(cleanEntries, latestCommand, server, sessionId);
      
      // Use OpenAI or fallback to local processing
      let model = process.env.GEMINI_API_KEY ? 'gemini-1.5-flash' : 'local';
      
      if (model === 'gemini-1.5-flash') {
        const result = await this._callGemini(prompt, cleanEntries, latestCommand);
        
        // Cache the result
        suggestionCache.set(cacheKey, result);
        setTimeout(() => suggestionCache.delete(cacheKey), CACHE_TTL);
        
        return result;
      } else {
        // Local fallback (simple suggestion)
        const fallbackResult = this._generateLocalSuggestion(cleanEntries, latestCommand);
        
        // Cache the result
        suggestionCache.set(cacheKey, fallbackResult);
        setTimeout(() => suggestionCache.delete(cacheKey), CACHE_TTL);
        
        return fallbackResult;
      }
    } catch (error) {
      console.error('[TerminalSuggestionService] Error getting suggestions:', error);
      return { 
        error: error.message,
        prompt: null,
        response: null,
        json: null
      };
    }
  }

  _generateCacheKey(entries, latestCommand, serverId, sessionId) {
    const entriesKey = entries.map(e => `${e.command}|${e.output?.substring(0, 20)}`).join('_');
    return `${serverId}-${sessionId}-${latestCommand}-${entriesKey}`;
  }

  _buildPrompt(entries, latestCommand, server, sessionId) {
    const serverInfo = `Server: ${server.name} (${server.host})`;
    const sessionContext = sessionId ? `Session ID: ${sessionId}` : 'No session ID';
    
    const commandHistory = entries
      .map(entry => 
        `Command: ${entry.command}\nOutput: ${
          entry.output?.length > 200 
            ? entry.output.substring(0, 200) + '...' 
            : entry.output || 'No output'
        }`
      )
      .join('\n\n');
    
    return `
You are an expert terminal assistant helping a user with their terminal session.
${serverInfo}
${sessionContext}

Recent terminal commands and outputs:
${commandHistory}

Latest command: ${latestCommand}

Based on the command history and latest command, suggest:
1. The most helpful next command
2. A brief explanation of what that command would do
3. Alternative commands if relevant

Your response must be valid JSON with these fields:
{
  "nextCommand": "suggested command",
  "explanation": "brief explanation",
  "alternatives": ["alt1", "alt2"]
}
`;
  }

  async _callGemini(prompt, entries, latestCommand) {
    try {
      console.log('[TerminalSuggestionService] Calling Gemini API');
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY not set in environment variables');
      }
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          contents: [
            {
              parts: [
                { text: prompt }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024
          }
        }
      );
      
      const textResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[TerminalSuggestionService] Received Gemini response:', textResponse.substring(0, 100) + '...');
      
      // Parse JSON from response
      let jsonResponse = null;
      try {
        // Extract JSON if wrapped in backticks
        const jsonMatch = textResponse.match(/```(?:json)?([\s\S]*?)```/);
        const jsonText = jsonMatch ? jsonMatch[1].trim() : textResponse.trim();
        jsonResponse = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[TerminalSuggestionService] Error parsing JSON from response:', parseError);
      }
      
      return {
        response: textResponse,
        json: jsonResponse,
        prompt
      };
    } catch (error) {
      console.error('[TerminalSuggestionService] Error calling Gemini API:', error);
      
      // Return a more helpful error object
      return {
        error: error.message,
        status: error.response?.status,
        response: null,
        json: null,
        prompt
      };
    }
  }

  _generateLocalSuggestion(entries, latestCommand) {
    console.log('[TerminalSuggestionService] Generating local suggestion');
    
    // Get last command without the latest one
    const previousCommands = entries
      .slice(0, entries.length - 1)
      .map(e => e.command)
      .filter(Boolean);
    
    // Basic suggestions based on common patterns
    let suggestion;
    
    if (latestCommand.startsWith('cd ')) {
      suggestion = 'ls -la';
    } else if (latestCommand.includes('git clone')) {
      const repoName = latestCommand.split('/').pop().replace('.git', '');
      suggestion = `cd ${repoName}`;
    } else if (latestCommand === 'npm install' || latestCommand === 'yarn') {
      suggestion = 'npm start';
    } else if (latestCommand.startsWith('mkdir ')) {
      const dirName = latestCommand.replace('mkdir ', '');
      suggestion = `cd ${dirName}`;
    } else if (latestCommand === 'ls' || latestCommand === 'ls -la' || latestCommand === 'dir') {
      suggestion = 'cd dirname';
    } else {
      // Check for repeated command patterns
      const commonCommands = this._findCommonCommands(previousCommands);
      if (commonCommands.length > 0) {
        suggestion = commonCommands[0];
      } else {
        suggestion = 'echo "Command completed successfully"';
      }
    }
    
    // Build a response object similar to the API response
    return {
      response: null,
      json: {
        nextCommand: suggestion,
        explanation: 'Suggested based on command history patterns',
        alternatives: ['clear', 'history']
      },
      prompt: null
    };
  }

  _findCommonCommands(commands) {
    // Count frequency of each command
    const frequency = {};
    commands.forEach(cmd => {
      frequency[cmd] = (frequency[cmd] || 0) + 1;
    });
    
    // Sort by frequency
    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0]);
  }
}

module.exports = new TerminalSuggestionService(); 