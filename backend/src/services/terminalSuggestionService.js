const axios = require('axios');
const serverRepository = require('../repositories/serverRepository');

class TerminalSuggestionService {
  async getSuggestions({ entries, latestCommand, serverId, sessionId }) {
    console.log('[TERMINAL-SUGGEST] Received latestCommand:', latestCommand);
    console.log('[TERMINAL-SUGGEST] Received serverId:', serverId, 'sessionId:', sessionId);
    
    // If we have serverId and sessionId, fetch session-specific history from database
    let contextEntries = entries; // fallback to provided entries
    let actualLatestCommand = latestCommand;
    
    if (serverId && sessionId !== null && sessionId !== undefined && !isNaN(sessionId)) {
      try {
        // Get unique commands by using GROUP BY and taking the most recent output for each command
        const sessionHistory = await serverRepository.getSessionHistory(serverId, sessionId);
        
        if (sessionHistory.length > 0) {
          contextEntries = sessionHistory.map(h => ({
            command: h.command || '',
            output: (h.output || '').slice(0, 1000)
          }));
          // Use the most recent command from database
          actualLatestCommand = sessionHistory[0]?.command || latestCommand;
          console.log('[TERMINAL-SUGGEST] Using latest command from DB:', actualLatestCommand);
        }
      } catch (dbError) {
        console.error('[TERMINAL-SUGGEST] Database error:', dbError);
      }
    }
    
    console.log('[TERMINAL-SUGGEST] Final entries for context:', JSON.stringify(contextEntries, null, 2));
    console.log('[TERMINAL-SUGGEST] Final latest command:', actualLatestCommand);

    // Build prompt for Gemini
    let prompt = this.buildPrompt(contextEntries);

    return this.callGeminiAPI(prompt);
  }

  async getAlternativeSuggestions({ entries, previousSuggestion }) {
    if (!Array.isArray(entries) || entries.length === 0 || !previousSuggestion) {
      throw new Error('Missing entries or previousSuggestion');
    }

    const prompt = this.buildAlternativePrompt(entries, previousSuggestion);
    return this.callGeminiAPI(prompt);
  }

  buildPrompt(entries) {
    let prompt = `You are a helpful Linux system administrator assistant. Based on the recent terminal command history below, suggest the next logical command that the user might want to run.

Recent command history (most recent last):
`;

    // Add commands in chronological order (oldest to newest)
    const chronologicalEntries = [...entries].reverse();
    chronologicalEntries.forEach((entry, i) => {
      const cmd = entry.command || '';
      const out = entry.output || '';
      prompt += `\n${i + 1}. Command: ${cmd}\n`;
      if (out.trim()) {
        // Look for common error patterns in the output
        const hasError = /error|not found|invalid|cannot|failed|denied|permission|no such/i.test(out);
        const outputPrefix = hasError ? 'Error Output' : 'Output';
        // Increase truncation limit for error messages
        const truncateLimit = hasError ? 2000 : 1000;
        const truncatedOutput = out.length > truncateLimit ? out.substring(0, truncateLimit) + '...' : out;
        // Format output with proper indentation and line breaks
        const lines = truncatedOutput.split('\n');
        const formattedOutput = lines
          .filter(line => line.trim()) // Remove empty lines
          .map(line => `   ${line.trim()}`) // Indent each line
          .join('\n');
        prompt += `   ${outputPrefix}:\n${formattedOutput}\n`;
      }
    });

    prompt += '\n\nBased on this command history, suggest the next logical command that would help the user.';
    return prompt;
  }

  buildAlternativePrompt(entries, previousSuggestion) {
    let prompt = 'The user just ran these recent commands in the terminal (oldest to newest):\n';
    
    // Show commands in chronological order
    const chronologicalEntries = [...entries].reverse();
    chronologicalEntries.forEach((e, idx) => {
      const cmd = this.escapeForPrompt(e.command);
      const out = this.escapeForPrompt(e.output);
      // Look for common error patterns in the output
      const hasError = /error|not found|invalid|cannot|failed|denied|permission|no such/i.test(out);
      const outputPrefix = hasError ? 'Error Output:' : 'Output:';
      // Increase truncation limit for error messages
      const truncateLimit = hasError ? 2000 : 1000;
      const truncatedOutput = out.length > truncateLimit ? out.substring(0, truncateLimit) + '...' : out;
      prompt += `\n${idx + 1}. $ ${cmd}\n   ${outputPrefix} ${truncatedOutput}`;
    });

    const prev = typeof previousSuggestion === 'object' ? 
      JSON.stringify(previousSuggestion.json || previousSuggestion.response || previousSuggestion) : 
      this.escapeForPrompt(previousSuggestion);
    
    prompt += `\n\nThe previous suggestion was: ${prev}\n`;
    prompt += `\nBased on the most recent command "${this.escapeForPrompt(entries[0]?.command || '')}" and its output, suggest an alternative next best command or troubleshooting step. If you see any errors in the output, suggest commands that would help fix those errors or provide alternatives that would work better.

Provide your response as a JSON object with:
- "answer": A brief explanation of what the suggested command does, mentioning any errors seen and how to fix them
- "commands": An array of 1-3 suggested commands (just the command strings)
- "explanations": An array of strings, where each string explains the corresponding command in the commands array. Each explanation should describe:
  1. What the command does
  2. Why it's relevant after the previous command (especially if fixing an error)
  3. What output to expect
  4. Any potential errors to watch out for and how to handle them

Do not repeat the previous suggestion's commands.`;

    return prompt;
  }

  escapeForPrompt(str) {
    if (!str || typeof str !== 'string') return 'N/A';
    return str.replace(/[`$\\]/g, match => '\\' + match).replace(/\u0000/g, '');
  }

  async callGeminiAPI(prompt) {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }

    const geminiModel = 'gemini-2.5-flash-preview-04-17';
    const geminiPayload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
        stopSequences: []
      }
    };

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=` + geminiApiKey,
        geminiPayload,
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (response.status !== 200) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[TERMINAL-SUGGEST] Raw Gemini response:', rawText);

      const jsonText = this.extractJSON(rawText);
      console.log('[TERMINAL-SUGGEST] Extracted JSON:', jsonText);
      
      if (!jsonText) {
        console.error('[TERMINAL-SUGGEST] Could not extract JSON from response');
        return {
          response: "Here are some suggested commands based on your recent activity",
          json: {
            answer: "Here are some suggested commands based on your recent activity",
            commands: ["ls -l", "pwd", "df -h"],
            explanations: [
              "List files with details",
              "Show current directory",
              "Show disk usage"
            ]
          },
          prompt: prompt,
          error: 'Failed to parse Gemini response, using fallback suggestions'
        };
      }
      
      try {
        const parsedJson = JSON.parse(jsonText);
        
        if (!parsedJson.answer || !Array.isArray(parsedJson.commands)) {
          throw new Error('Invalid response format - missing required fields');
        }
        
        // Clean up explanations
        if (Array.isArray(parsedJson.explanations)) {
          parsedJson.explanations = parsedJson.explanations.map(exp => {
            if (typeof exp === 'string') return exp;
            if (typeof exp === 'object') {
              return Object.values(exp).join(' ');
            }
            return String(exp);
          });
        }
        
        // Ensure explanations exist and match commands length
        if (!Array.isArray(parsedJson.explanations) || parsedJson.explanations.length !== parsedJson.commands.length) {
          parsedJson.explanations = parsedJson.commands.map(cmd => {
            if (cmd.startsWith('ls')) return 'List directory contents with detailed information. This shows file permissions, sizes, and timestamps. Expect a detailed listing of files and directories.';
            if (cmd.startsWith('cd')) return 'Change directory to explore contents. This moves you into the specified directory. Expect to be in the new directory after execution.';
            if (cmd.startsWith('ps')) return 'Show running processes and their status. This displays information about active processes. Expect a list of processes with details like CPU and memory usage.';
            if (cmd.startsWith('top')) return 'Monitor system processes in real-time. This shows a dynamic view of system resource usage. Expect an interactive display of process information that updates regularly.';
            if (cmd.startsWith('df')) return 'Show disk space usage. This displays filesystem space utilization. Expect a list of mounted filesystems with their total, used, and available space.';
            if (cmd.startsWith('du')) return 'Show directory space usage. This calculates disk usage of directories. Expect a list of directories with their total sizes.';
            return `Execute the ${cmd} command. This will run in your current shell context. Check the output carefully before running any further commands.`;
          });
        }
        
        return {
          response: parsedJson.answer,
          json: parsedJson,
          prompt: prompt
        };
      } catch (parseError) {
        console.error('[TERMINAL-SUGGEST] JSON parse error:', parseError);
        
        // Try to salvage partial response
        const commandMatch = jsonText.match(/"commands":\s*\[(.*?)\]/s);
        const answerMatch = jsonText.match(/"answer":\s*"([^"]+)"/);
        
        const salvaged = {
          answer: answerMatch ? answerMatch[1] : "Here are some suggested commands based on your recent activity",
          commands: commandMatch ? 
            commandMatch[1].split(',')
              .map(s => s.trim().replace(/^"|"$/g, ''))
              .filter(s => s && !s.includes('"')) : 
            ["ls -l", "pwd", "df -h"],
          explanations: ["List files with details", "Show current directory", "Show disk usage"]
        };
        
        return {
          response: salvaged.answer,
          json: salvaged,
          prompt: prompt,
          error: 'Partial parse of Gemini response'
        };
      }
    } catch (error) {
      console.error('[TERMINAL-SUGGEST] Error:', error?.response?.data || error);
      throw new Error('Failed to get suggestions: ' + (error?.response?.data?.error || error.message));
    }
  }

  extractJSON(text) {
    // First try to find JSON between code blocks
    let match = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (match) return match[1].trim();
    
    // If no code blocks, try to find outermost { }
    match = text.match(/\{[\s\S]*\}/);
    if (match) return match[0].trim();
    
    // If still no match, return null
    return null;
  }
}

module.exports = new TerminalSuggestionService(); 