const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const path = require('path');
const { Client: SSHClient } = require('ssh2');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const WebSocket = require('ws');
const { runMigrations } = require('./migrations');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'sshfix.db'));

// Run migrations
runMigrations();

// Global variable to track current chat session ID per server
const currentChatSessions = new Map(); // serverId -> sessionId

// Multer setup for image uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, base + '-' + Date.now() + ext);
  }
});
const imageFilter = (req, file, cb) => {
  if (!file.mimetype.match(/^image\/(png|jpeg|jpg|gif|webp)$/)) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};
const upload = multer({ storage, fileFilter: imageFilter, limits: { files: 5, fileSize: 5 * 1024 * 1024 } });

// Import routes
const serverRoutes = require('./src/routes/serverRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const terminalRoutes = require('./src/routes/terminalRoutes');

// Mount routes
app.use('/api/servers', serverRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/terminal', terminalRoutes);

// API: List servers
app.get('/api/servers', (req, res) => {
  const servers = db.prepare('SELECT * FROM servers').all();
  res.json(servers);
});

// API: Add server
app.post('/api/servers', (req, res) => {
  const { name, host, port, username, password, privateKey } = req.body;
  const stmt = db.prepare('INSERT INTO servers (name, host, port, username, password, privateKey) VALUES (?, ?, ?, ?, ?, ?)');
  const info = stmt.run(name, host, port || 22, username, password, privateKey);
  res.json({ id: info.lastInsertRowid });
});

// API: Get server by id
app.get('/api/servers/:id', (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Not found' });
  res.json(server);
});

// API: Delete server
app.delete('/api/servers/:id', (req, res) => {
  db.prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// API: List history for a server
app.get('/api/servers/:id/history', (req, res) => {
  const history = db.prepare('SELECT id, server_id, command, output, created_at, chat_session_id FROM history WHERE server_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(history);
});

// API: Add terminal history
app.post('/api/servers/:id/history', (req, res) => {
  const serverId = parseInt(req.params.id);
  const { command, output } = req.body;
  
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  try {
    // Get current chat session ID for this server
    const currentSession = db.prepare('SELECT chat_session_id FROM servers WHERE id = ?').get(serverId);
    const sessionId = currentSession?.chat_session_id || null;

    console.log('[HISTORY] Added command', JSON.stringify(command), 'to server', serverId, 'session', sessionId);

    // Insert with session ID
    const stmt = db.prepare('INSERT INTO history (server_id, command, output, chat_session_id, created_at) VALUES (?, ?, ?, ?, ?)');
    stmt.run(
      serverId,
      command,
      output || '',
      sessionId,
      new Date().toISOString()
    );

    // Get updated history
    const history = db.prepare(`
      SELECT * FROM history 
      WHERE server_id = ? 
      AND (chat_session_id = ? OR chat_session_id IS NULL)
      ORDER BY created_at DESC
    `).all(serverId, sessionId);

    res.json(history);
  } catch (error) {
    console.error('Error adding history:', error);
    res.status(500).json({ error: 'Failed to add history: ' + error.message });
  }
});

// API: Get context for a server
app.get('/api/servers/:id/context', (req, res) => {
  const context = db.prepare('SELECT key, value FROM context WHERE server_id = ?').all(req.params.id);
  res.json(context);
});

// API: Set context key/value
app.post('/api/servers/:id/context', (req, res) => {
  const { key, value } = req.body;
  // Upsert
  db.prepare('INSERT INTO context (server_id, key, value) VALUES (?, ?, ?) ON CONFLICT(server_id, key) DO UPDATE SET value = excluded.value')
    .run(req.params.id, key, value);
  res.json({ success: true });
});

// SSH Command Execution Endpoint
app.post('/api/servers/:id/ssh', async (req, res) => {
  const { command } = req.body;
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const conn = new SSHClient();
  let output = '';
  conn.on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        conn.end();
        return res.status(500).json({ error: err.message });
      }
      stream.on('close', (code, signal) => {
        conn.end();
        // Save to history
        db.prepare('INSERT INTO history (server_id, command, output) VALUES (?, ?, ?)')
          .run(server.id, command, output);
        res.json({ output });
      }).on('data', (data) => {
        output += data.toString();
      }).stderr.on('data', (data) => {
        output += data.toString();
      });
    });
  }).on('error', (err) => {
    res.status(500).json({ error: err.message });
  }).connect({
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password || undefined,
    privateKey: server.privateKey || undefined,
  });
});

// --- Add this utility at the top (after requires, before endpoints) ---
function cleanAIResponse(str) {
  if (!str) return str;
  // Remove code block markers
  str = str.trim();
  if (str.startsWith('```json')) str = str.replace(/^```json/, '').trim();
  if (str.startsWith('```')) str = str.replace(/^```/, '').trim();
  if (str.endsWith('```')) str = str.replace(/```$/, '').trim();
  // Remove leading/trailing newlines
  str = str.replace(/^[\r\n]+|[\r\n]+$/g, '');
  // Remove trailing commas before } or ]
  str = str.replace(/,(\s*[}\]])/g, '$1');
  // Unescape escaped quotes (if present)
  if (str.startsWith('"') && str.endsWith('"')) {
    try {
      str = JSON.parse(str);
    } catch {}
  }
  return str;
}

// API: Get chat history for a server, optionally by date
app.get('/api/servers/:id/chat', (req, res) => {
  const { date, sessionId } = req.query;
  const serverId = req.params.id;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId query parameter is required' });
  }

  let query = `SELECT id, role, message, created_at, ai_request_context FROM chat_history WHERE server_id = ? AND chat_session_id = ?`;
  const params = [serverId, sessionId];

  if (date) {
    query += ` AND DATE(created_at) = ?`;
    params.push(date);
  }
  query += ` ORDER BY created_at ASC`;

  const rows = db.prepare(query).all(...params);
  
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
    // ai_request_context is already selected, so it will be part of processedMsg if it exists
    return processedMsg;
  });
  res.json(result);
});

// API: Add chat message to history (This endpoint might be deprecated or simplified if /api/ai handles all new message creations)
// For now, ensure it also requires and uses chatSessionId if it's to be kept.
app.post('/api/servers/:id/chat', (req, res) => {
  const { role, message, chatSessionId } = req.body;
  const serverId = req.params.id;

  if (!role || !message) return res.status(400).json({ error: 'role and message required' });
  if (!serverId) return res.status(400).json({ error: 'serverId is required' });
  if (!chatSessionId) return res.status(400).json({ error: 'chatSessionId is required in body' });

  // User messages don't have ai_request_context. AI messages are now added via /api/ai.
  // This endpoint should primarily be for user messages if still used directly.
  let stmt;
  let info;
  if (role === 'user') {
    stmt = db.prepare('INSERT INTO chat_history (server_id, role, message, chat_session_id) VALUES (?, ?, ?, ?)');
    info = stmt.run(serverId, role, message, chatSessionId);
  } else {
    // Direct insertion of AI messages here might bypass ai_request_context logging. Prefer /api/ai for AI messages.
    return res.status(400).json({ error: 'AI messages should be created via /api/ai to include request context.'});
  }
  res.json({ id: info.lastInsertRowid });
});

// Update AI Suggestion Endpoint to use and store chat history
app.post('/api/ai', async (req, res) => {
  const { prompt, model, serverId, chatSessionId, withTerminalContext, newSession, systemPrompt, imageUrls, messageId, edit } = req.body;
  console.log('[AI ENDPOINT] Received model:', model, 'type:', typeof model, 'chatSessionId:', chatSessionId);
  console.log('[AI ENDPOINT] Received imageUrls:', imageUrls);

  if (!serverId) {
    return res.status(400).json({ error: 'serverId is required' });
  }
  
  if (!chatSessionId) {
    return res.status(400).json({ error: 'chatSessionId is required' });
  }

  const sessionIdToUse = chatSessionId.toString();
  console.log('[AI ENDPOINT] Using sessionId:', sessionIdToUse);

  try {
    let chatHistory = [];
    // Fetch chat history for the current server and session
    chatHistory = db.prepare('SELECT id, role, message FROM chat_history WHERE server_id = ? AND chat_session_id = ? ORDER BY created_at ASC').all(serverId, sessionIdToUse);
    // Exclude Gemini suggestion messages from AI context (if any were stored with session ID, though they shouldn't be)
    chatHistory = chatHistory.filter(m => m.role !== 'gemini-suggest');

    let terminalHistory = [];
    if (withTerminalContext) {
      // Get the timestamp of the first message in the current chat session
      const firstMessageInSession = db.prepare('SELECT MIN(created_at) as session_start_time FROM chat_history WHERE server_id = ? AND chat_session_id = ?').get(serverId, sessionIdToUse);
      const sessionStartTime = firstMessageInSession?.session_start_time || new Date(0).toISOString(); // Default to epoch if no messages in session yet
      
      // Fetch terminal history for the server created at or after the session start time
      terminalHistory = db.prepare('SELECT command, output FROM history WHERE server_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 10').all(serverId, sessionStartTime);
    }

    // Compose messages for AI API
    const messages = []; // This will be the full context sent to the AI
    // Add system prompt
    const defaultSystemPrompt =
      'You are an expert server assistant operating in a terminal environment. You can suggest shell commands for the user to run, and you will see the output of those commands. Your job is to help the user diagnose, fix, and automate server issues using the terminal. Always be safe, never suggest anything that could cause harm, data loss, or security issues. Explain your reasoning, ask for confirmation before any risky action, and help the user get things done efficiently.';
    // --- Add JSON output instruction ---
    const jsonInstruction = `IMPORTANT: You MUST always respond in valid JSON format with exactly these fields:
1. "answer": A string containing your explanation, analysis, and advice
2. "commands": An array of shell command strings that the user can run (provide practical, relevant commands even if not explicitly requested)
3. "explanations": An array of strings, where each string explains the corresponding command in the commands array. Each explanation should describe:
   1. What the command does
   2. Why it's relevant to the user's request or current context
   3. What output to expect
   4. Any potential errors to watch out for and how to handle them

Example response format:
{
  "answer": "I can see the issue. The disk is almost full at 98% capacity. Let me help you identify what is taking up space and clean it up.",
  "commands": ["df -h", "du -sh /* 2>/dev/null | sort -h", "find /var/log -name '*.log' -mtime +30 -size +100M"],
  "explanations": [
    "Shows disk space usage for all mounted filesystems in human-readable format. This will confirm which partitions are running low on space. Expect a table showing filesystem sizes, used space, and available space.",
    "Lists disk usage for all top-level directories, sorted by size. The 2>/dev/null suppresses permission denied errors. You'll see directories listed from smallest to largest, helping identify space hogs.",
    "Finds log files older than 30 days and larger than 100MB. These are often safe to compress or delete. The output will show paths to large, old log files that can be cleaned up."
  ]
}

ALWAYS include relevant commands in the "commands" array and matching explanations in the "explanations" array, even if the user didn't explicitly ask for them. Do NOT include any text outside the JSON object.`;
    messages.push({ role: 'system', content: (systemPrompt || defaultSystemPrompt) + '\n\n' + jsonInstruction });
    if (withTerminalContext && terminalHistory.length > 0) {
      messages.push({ role: 'system', content: 'Recent terminal activity:' });
      messages.push(...terminalHistory.reverse().map(h => {
        const cmd = h.command || '';
        const out = h.output || '';
        // Look for common error patterns in the output
        const hasError = /error|not found|invalid|cannot|failed|denied|permission|no such/i.test(out);
        const outputPrefix = hasError ? 'Error Output:' : 'Output:';
        // Increase truncation limit for error messages
        const truncateLimit = hasError ? 2000 : 1000;
        const truncatedOutput = out.length > truncateLimit ? out.substring(0, truncateLimit) + '...' : out;
        return { role: 'user', content: `$ ${cmd}\n${outputPrefix} ${truncatedOutput}` };
      }));
    }
    // If editing, replace the last user message in chatHistory
    let userMsg = prompt;
    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
      userMsg += '\n[The user attached images for analysis.]';
    }
    // Collect all image URLs from previous user messages
    function extractImageUrlsFromMarkdown(text) {
      const regex = /!\[image\]\(([^)]+)\)/g;
      const urls = [];
      let match;
      while ((match = regex.exec(text))) {
        urls.push(match[1]);
      }
      return urls;
    }
    let allPrevImageUrls = [];
    chatHistory.forEach(m => {
      if (m.role === 'user') {
        allPrevImageUrls.push(...extractImageUrlsFromMarkdown(m.message));
      }
    });
    allPrevImageUrls = [...new Set(allPrevImageUrls)];
    let chatHistoryForAI = chatHistory.map(m => ({ role: m.role, content: m.message }));
    if (edit && messageId) {
      const idx = chatHistory.findIndex(m => m.id === messageId && m.role === 'user');
      if (idx !== -1) {
        chatHistoryForAI[idx] = { role: 'user', content: userMsg };
      }
    }
    messages.push(...chatHistoryForAI);
    if (!edit) {
      messages.push({ role: 'user', content: userMsg });
    }
    // Estimate tokens (very rough: word count * 1.3)
    const contextText = messages.map(m => m.content).join('\n');
    const estimatedTokens = Math.round(contextText.split(/\s+/).length * 1.3);
    let aiResponse = '';
    let aiJson = null;
    // Helper to fetch and encode images
    async function fetchImagesAsBase64(urls) {
      const results = [];
      for (const url of urls) {
        try {
          const absUrl = url.startsWith('/uploads/') ? `${req.protocol}://${req.get('host')}${url}` : url;
          console.log('[fetchImagesAsBase64] Fetching:', absUrl);
          const resp = await axios.get(absUrl, { responseType: 'arraybuffer' });
          const contentType = resp.headers['content-type'] || 'image/png';
          const base64 = Buffer.from(resp.data, 'binary').toString('base64');
          results.push({ base64, contentType });
        } catch (err) {
          console.error('[fetchImagesAsBase64] Error fetching image:', url, err.message);
        }
      }
      return results;
    }
    if (model === 'openai') {
      // OpenAI GPT-4o with image support and JSON mode
      const openaiApiKey = process.env.OPENAI_API_KEY;
      let openaiMessages = messages.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content }));
      for (let i = 0; i < openaiMessages.length; i++) {
        if (openaiMessages[i].role === 'user') {
          const msg = openaiMessages[i];
          const urls = extractImageUrlsFromMarkdown(msg.content);
          if (urls.length > 0) {
            const images = await fetchImagesAsBase64(urls);
            const contentArr = [{ type: 'text', text: msg.content.replace(/!\[image\]\(([^)]+)\)/g, '').trim() }];
            for (const img of images) {
              contentArr.push({ type: 'image_url', image_url: { url: `data:${img.contentType};base64,${img.base64}` } });
            }
            openaiMessages[i] = { role: 'user', content: contentArr };
          }
        }
      }
      if (imageUrls && imageUrls.length > 0) {
        const images = await fetchImagesAsBase64(imageUrls);
        const contentArr = [{ type: 'text', text: userMsg }];
        for (const img of images) {
          contentArr.push({ type: 'image_url', image_url: { url: `data:${img.contentType};base64,${img.base64}` } });
        }
        openaiMessages[openaiMessages.length - 1] = { role: 'user', content: contentArr };
      }
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o',
        messages: openaiMessages,
        response_format: { type: 'json_object' },
      }, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
      });
      aiResponse = response.data.choices[0].message.content;
      try {
        aiJson = JSON.parse(cleanAIResponse(aiResponse));
      } catch (e) {
        aiJson = null;
      }
    } else if (
      model === 'gemini' ||
      model === 'gemini-pro' ||
      (typeof model === 'string' && model.toLowerCase().includes('gemini'))
    ) {
      // Gemini 2.5 with image support and JSON mode if possible
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const geminiModel = (model === 'gemini-pro' || (typeof model === 'string' && model.toLowerCase().includes('pro')))
        ? 'gemini-2.5-pro-preview-05-06'
        : 'gemini-2.5-flash-preview-04-17';
      console.log('[AI ENDPOINT] Using Gemini model:', geminiModel);
      let geminiMessages = messages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .map(m => ({
          role: m.role === 'ai' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
      // Prepend system prompt as first user message
      geminiMessages.unshift({
        role: 'user',
        parts: [{ text: (systemPrompt || defaultSystemPrompt) + '\n\n' + jsonInstruction }]
      });
      for (let i = 0; i < geminiMessages.length; i++) {
        if (geminiMessages[i].role === 'user') {
          const msg = geminiMessages[i];
          const urls = extractImageUrlsFromMarkdown(msg.parts[0].text);
          if (urls.length > 0) {
            const images = await fetchImagesAsBase64(urls);
            geminiMessages[i].parts = [
              { text: msg.parts[0].text.replace(/!\[image\]\(([^)]+)\)/g, '').trim() },
              ...images.map(img => ({ inline_data: { mime_type: img.contentType, data: img.base64 } }))
            ];
          }
        }
      }
      if (imageUrls && imageUrls.length > 0) {
        const images = await fetchImagesAsBase64(imageUrls);
        geminiMessages[geminiMessages.length - 1].parts = [
          { text: userMsg },
          ...images.map(img => ({ inline_data: { mime_type: img.contentType, data: img.base64 } }))
        ];
      }
      // Try to use responseMimeType for JSON output with increased maxOutputTokens
      let geminiPayload = {
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,  // Increased from 1024 to 8192
          stopSequences: []
        }
      };
      let response;
      try {
        response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=` + geminiApiKey,
          geminiPayload
        );
        aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        try {
          aiJson = JSON.parse(cleanAIResponse(aiResponse));
        } catch (e) {
          aiJson = null;
        }
      } catch (err) {
        // If the API errors, try again without responseMimeType
        geminiPayload = { 
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,  // Increased here too
            stopSequences: []
          }
        };
        response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=` + geminiApiKey,
          geminiPayload
        );
        aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        try {
          aiJson = JSON.parse(cleanAIResponse(aiResponse));
        } catch (e) {
          aiJson = null;
        }
      }
    } else if (model === 'claude') {
      // If prompt is empty (e.g., new session), do not call Claude API
      if (!prompt || prompt.trim() === '') {
        aiResponse = '';
        aiJson = null;
      } else {
        // Claude: force JSON output by prefilling assistant with '{'
        const claudeApiKey = process.env.CLAUDE_API_KEY;
        // Remove system messages, only use 'user' and 'ai' (as 'assistant')
        let claudeMessages = messages
          .filter(m => m.role === 'user' || m.role === 'ai')
          .map(m => {
            if (m.role === 'ai') {
              return { role: 'assistant', content: m.content.replace(/!\[.*?\]\(.*?\)/g, '') };
            } else {
              // For user messages, check for images
              const urls = extractImageUrlsFromMarkdown(m.content);
              if (urls.length > 0) {
                // Remove image markdown from text
                const text = m.content.replace(/!\[.*?\]\(.*?\)/g, '').trim();
                return { role: 'user', content: [{ type: 'text', text }, ...urls.map(url => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }))] };
              } else {
                return { role: 'user', content: m.content };
              }
            }
          });
        // Now, actually fetch and fill in the image data for user messages
        let userMsgIdx = 0;
        for (let i = 0; i < claudeMessages.length; i++) {
          const msg = claudeMessages[i];
          if (msg.role === 'user' && Array.isArray(msg.content)) {
            // Find the corresponding original user message
            const origUserMessages = messages.filter(m => m.role === 'user');
            const origMsg = origUserMessages[userMsgIdx];
            userMsgIdx++;
            if (!origMsg) continue;
            let imageIdx = 0;
            for (let j = 0; j < msg.content.length; j++) {
              if (msg.content[j].type === 'image') {
                const urls = extractImageUrlsFromMarkdown(origMsg.content);
                if (urls[imageIdx]) {
                  try {
                    const images = await fetchImagesAsBase64([urls[imageIdx]]);
                    if (images[0]) {
                      msg.content[j].source.media_type = images[0].contentType;
                      msg.content[j].source.data = images[0].base64;
                    }
                  } catch (e) {
                    msg.content.splice(j, 1);
                    j--;
                  }
                }
                imageIdx++;
              }
            }
          }
        }
        // If the current prompt has imageUrls, add them to the last user message
        if (imageUrls && imageUrls.length > 0) {
          const images = await fetchImagesAsBase64(imageUrls);
          const lastUserIdx = claudeMessages.map(m => m.role).lastIndexOf('user');
          if (lastUserIdx !== -1) {
            if (!Array.isArray(claudeMessages[lastUserIdx].content)) {
              // Convert to array if not already
              claudeMessages[lastUserIdx].content = [{ type: 'text', text: claudeMessages[lastUserIdx].content }];
            }
            for (let k = 0; k < images.length; k++) {
              claudeMessages[lastUserIdx].content.push({ type: 'image', source: { type: 'base64', media_type: images[k].contentType, data: images[k].base64 } });
            }
          }
        }
        // Prefill assistant with '{' to force JSON output
        claudeMessages.push({ role: 'assistant', content: '{' });
        const payload = {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: claudeMessages,
          system: (systemPrompt || defaultSystemPrompt) + '\n' + jsonInstruction,
        };
        const response = await axios.post('https://api.anthropic.com/v1/messages', payload, {
          headers: {
            'x-api-key': claudeApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            'X-Cache-Write': 'true',
          },
        });
        // Reconstruct JSON from response
        let text = '';
        if (response.data.content && Array.isArray(response.data.content)) {
          text = response.data.content.map(c => c.text).join('');
        } else if (response.data.content && response.data.content.text) {
          text = response.data.content.text;
        }
        aiResponse = '{' + text;
        try {
          aiJson = JSON.parse(cleanAIResponse(aiResponse));
        } catch (e) {
          aiJson = null;
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid model' });
    }
    // Store or update user prompt and AI response in chat_history if serverId is present
    if (serverId) {
      // Create the full user message with image markdown
      let fullUserMsg = prompt;
      if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
        fullUserMsg += '\n' + imageUrls.map(url => {
          const finalUrl = url.startsWith('/uploads/') ? url : `/uploads/${url.replace(/^.*[\\/]/, '')}`;
          return `![image](${finalUrl})`;
        }).join(' ');
      }
      
      const aiRequestContextString = JSON.stringify(messages);

      if (edit && messageId) {
        // When editing, we update the user message.
        // The AI response associated with this edit will be updated or created next.
        // We don't store ai_request_context for user messages.
        db.prepare('UPDATE chat_history SET message = ? WHERE id = ? AND role = ? AND server_id = ? AND chat_session_id = ?')
          .run(fullUserMsg, messageId, 'user', serverId, sessionIdToUse);
        
        // Find the AI message that immediately followed the user message being edited
        // (assuming AI response is always logged after user message)
        const aiMsgToUpdate = db.prepare(
          'SELECT id FROM chat_history WHERE server_id = ? AND chat_session_id = ? AND role = ? AND id > ? ORDER BY created_at ASC LIMIT 1'
        ).get(serverId, sessionIdToUse, 'ai', messageId);

        if (aiMsgToUpdate) {
          db.prepare('UPDATE chat_history SET message = ?, ai_request_context = ? WHERE id = ? AND role = ? AND server_id = ? AND chat_session_id = ?')
            .run(aiResponse, aiRequestContextString, aiMsgToUpdate.id, 'ai', serverId, sessionIdToUse);
        } else {
          // If no subsequent AI message, it might be a new AI response to an edited user message
          db.prepare('INSERT INTO chat_history (server_id, role, message, chat_session_id, ai_request_context) VALUES (?, ?, ?, ?, ?)')
            .run(serverId, 'ai', aiResponse, sessionIdToUse, aiRequestContextString);
        }
      } else {
        // For new messages, insert both user and AI messages
        // User message does not get ai_request_context
        db.prepare('INSERT INTO chat_history (server_id, role, message, chat_session_id) VALUES (?, ?, ?, ?)')
          .run(serverId, 'user', fullUserMsg, sessionIdToUse);
        // AI message gets the request context
        db.prepare('INSERT INTO chat_history (server_id, role, message, chat_session_id, ai_request_context) VALUES (?, ?, ?, ?, ?)')
          .run(serverId, 'ai', aiResponse, sessionIdToUse, aiRequestContextString);
      }
    }
    res.json({ response: aiResponse, json: aiJson, estimatedTokens });
  } catch (err) {
    console.error('AI endpoint error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error', details: err.response?.data || null });
  }
});

// Test SSH Connection Endpoint
app.post('/api/servers/:id/test', async (req, res) => {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  const conn = new SSHClient();
  let result = {
    success: false,
    error: null,
    os: null,
    tips: [],
    raw: null
  };
  let timeout;
  try {
    conn.on('ready', () => {
      // Try to detect OS
      conn.exec('uname -a || ver', (err, stream) => {
        if (err) {
          result.success = true;
          result.os = 'Unknown';
          result.tips.push('Connected, but could not detect OS.');
          conn.end();
          clearTimeout(timeout);
          return res.json(result);
        }
        let osOutput = '';
        stream.on('data', (data) => {
          osOutput += data.toString();
        }).on('close', () => {
          result.success = true;
          result.os = osOutput.trim();
          result.tips.push('SSH connection successful!');
          if (/ubuntu|debian|centos|fedora|linux|unix/i.test(osOutput)) {
            result.tips.push('Detected Linux/Unix server.');
          } else if (/windows|microsoft/i.test(osOutput)) {
            result.tips.push('Detected Windows server.');
          } else {
            result.tips.push('Could not confidently detect OS.');
          }
          conn.end();
          clearTimeout(timeout);
          return res.json(result);
        });
      });
    }).on('error', (err) => {
      result.error = err.message;
      if (/timed out|timeout/i.test(err.message)) {
        result.tips.push('Connection timed out. Check network/firewall and server IP/port.');
      } else if (/auth|password|key/i.test(err.message)) {
        result.tips.push('Authentication failed. Verify username, password, or private key.');
      } else if (/ECONNREFUSED|refused/i.test(err.message)) {
        result.tips.push('Connection refused. Is the SSH service running and accessible?');
      } else {
        result.tips.push('Check server address, port, credentials, and network connectivity.');
      }
      clearTimeout(timeout);
      return res.json(result);
    }).connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password || undefined,
      privateKey: server.privateKey || undefined,
      readyTimeout: 10000
    });
    // Manual timeout fallback
    timeout = setTimeout(() => {
      result.error = 'Connection timed out.';
      result.tips.push('Check network/firewall and server IP/port.');
      try { conn.end(); } catch {}
      return res.json(result);
    }, 12000);
  } catch (err) {
    result.error = err.message;
    result.tips.push('Unexpected error. Check server details and try again.');
    try { conn.end(); } catch {}
    return res.json(result);
  }
});

// Test New Server Connection Endpoint (before adding)
app.post('/api/servers/test-connection', async (req, res) => {
  const { host, port, username, password, privateKey } = req.body;
  
  const conn = new SSHClient();
  let result = {
    success: false,
    error: null,
    os: null,
    tips: [],
    raw: null
  };
  let timeout;
  try {
    conn.on('ready', () => {
      // Try to detect OS
      conn.exec('uname -a || ver', (err, stream) => {
        if (err) {
          result.success = true;
          result.os = 'Unknown';
          result.tips.push('Connected, but could not detect OS.');
          conn.end();
          clearTimeout(timeout);
          return res.json(result);
        }
        let osOutput = '';
        stream.on('data', (data) => {
          osOutput += data.toString();
        }).on('close', () => {
          result.success = true;
          result.os = osOutput.trim();
          result.tips.push('SSH connection successful!');
          if (/ubuntu|debian|centos|fedora|linux|unix/i.test(osOutput)) {
            result.tips.push('Detected Linux/Unix server.');
          } else if (/windows|microsoft/i.test(osOutput)) {
            result.tips.push('Detected Windows server.');
          } else {
            result.tips.push('Could not confidently detect OS.');
          }
          conn.end();
          clearTimeout(timeout);
          return res.json(result);
        });
      });
    }).on('error', (err) => {
      result.error = err.message;
      if (/timed out|timeout/i.test(err.message)) {
        result.tips.push('Connection timed out. Check network/firewall and server IP/port.');
      } else if (/auth|password|key/i.test(err.message)) {
        result.tips.push('Authentication failed. Verify username, password, or private key.');
      } else if (/ECONNREFUSED|refused/i.test(err.message)) {
        result.tips.push('Connection refused. Is the SSH service running and accessible?');
      } else {
        result.tips.push('Check server address, port, credentials, and network connectivity.');
      }
      clearTimeout(timeout);
      return res.json(result);
    }).connect({
      host,
      port: port || 22,
      username,
      password: password || undefined,
      privateKey: privateKey || undefined,
      readyTimeout: 10000
    });
    // Manual timeout fallback
    timeout = setTimeout(() => {
      result.error = 'Connection timed out.';
      result.tips.push('Check network/firewall and server IP/port.');
      try { conn.end(); } catch {}
      return res.json(result);
    }, 12000);
  } catch (err) {
    result.error = err.message;
    result.tips.push('Unexpected error. Check server details and try again.');
    try { conn.end(); } catch {}
    return res.json(result);
  }
});

// AI Key Availability Endpoint
app.get('/api/ai/available', (req, res) => {
  res.json({
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    claude: !!process.env.CLAUDE_API_KEY,
  });
});

// Image upload endpoint
app.post('/api/upload', upload.array('images', 5), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded' });
  }
  // Return URLs for uploaded images
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

// Serve uploaded images statically
app.use('/uploads', express.static(uploadDir));

// List chat sessions for a server (by date or session)
app.get('/api/servers/:id/chat-sessions', (req, res) => {
  const serverId = parseInt(req.params.id);
  try {
    const sessions = db.prepare(`
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

// Update chat session tracking endpoint
app.post('/api/servers/:id/set-chat-session', (req, res) => {
  const serverId = parseInt(req.params.id);
  const { sessionId } = req.body;
  
  console.log(`[CHAT SESSION] Received sessionId: "${sessionId}" for server ${serverId}`);
  
  // Extract numeric session ID from string (e.g., "server-1-session-123" -> 123)
  if (!sessionId || typeof sessionId !== 'string') {
    console.error(`[CHAT SESSION] Invalid sessionId: ${sessionId}`);
    return res.status(400).json({ error: 'Valid sessionId is required' });
  }
  
  const parts = sessionId.split('-');
  const lastPart = parts[parts.length - 1];
  const numericSessionId = parseInt(lastPart);
  
  if (isNaN(numericSessionId)) {
    console.error(`[CHAT SESSION] Could not parse numeric session ID from: ${sessionId}, lastPart: ${lastPart}`);
    return res.status(400).json({ error: 'Could not parse numeric session ID' });
  }
  
  currentChatSessions.set(serverId, numericSessionId);
  
  console.log(`[CHAT SESSION] Server ${serverId} now using session ${numericSessionId}`);
  res.json({ success: true });
});

// --- WebSocket Interactive Terminal ---
const server = app.listen(process.env.PORT || 4000, () => {
  console.log(`Backend server running on port ${process.env.PORT || 4000}`);
});

const wss = new WebSocket.Server({ server, path: '/ws/terminal' });
wss.on('connection', (ws, req) => {
  // Parse serverId from query string: /ws/terminal?serverId=123
  const url = new URL(req.url, `http://${req.headers.host}`);
  const serverId = url.searchParams.get('serverId');
  if (!serverId) {
    ws.close(1008, 'Missing serverId');
    return;
  }
  const serverRow = db.prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
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
        ECHO: true        // Ensure terminal echo is on
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
              const currentSessionId = currentChatSessions.get(Number(serverId));
              const sessionIdToUse = currentSessionId !== undefined && !isNaN(currentSessionId) ? currentSessionId : null;
              
              try {
                db.prepare('INSERT INTO history (server_id, command, output, chat_session_id) VALUES (?, ?, ?, ?)')
                  .run(serverId, cleanCommand, commandOutput, sessionIdToUse);
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
      password: serverRow.password
    });
  } catch (error) {
    console.error('[TERMINAL] Error initiating SSH connection:', error);
    ws.send(`\r\n\x1b[31m[Connection Error: ${error.message}]\x1b[0m\r\n`);
    ws.close();
  }
}); 