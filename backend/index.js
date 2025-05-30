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

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'sshfix.db'));

// --- Simple Migration System ---
console.log('[DB_MIGRATE] Initializing migration system...');

// 1. Ensure schema_migrations table exists
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // console.log('[DB_MIGRATE] schema_migrations table ensured.');
} catch (e) {
  console.error('[DB_MIGRATE] FATAL: Could not create schema_migrations table:', e.message);
  process.exit(1); // Exit if we can't manage migrations
}

// 2. Define Migrations
const migrations = [
  {
    version: 1,
    name: 'add_ai_request_context_to_chat_history',
    query: `ALTER TABLE chat_history ADD COLUMN ai_request_context TEXT NULL`
  },
  {
    version: 2,
    name: 'add_chat_session_id_to_chat_history',
    query: `ALTER TABLE chat_history ADD COLUMN chat_session_id TEXT NOT NULL DEFAULT 'default_session_0'`
  },
  {
    version: 3,
    name: 'add_chat_session_id_to_history',
    query: `ALTER TABLE history ADD COLUMN chat_session_id INTEGER NULL`
  },
  {
    version: 4,
    name: 'cleanup_legacy_string_session_ids',
    query: `DELETE FROM chat_history WHERE chat_session_id NOT GLOB '[0-9]*' OR LENGTH(chat_session_id) < 10`
  }
];

// Global variable to track current chat session ID per server
const currentChatSessions = new Map(); // serverId -> sessionId

// 3. Apply Pending Migrations
try {
  for (const migration of migrations) {
    const isAppliedStmt = db.prepare('SELECT version FROM schema_migrations WHERE version = ?');
    const isApplied = isAppliedStmt.get(migration.version.toString());
  
    if (!isApplied) {
      console.log(`[DB_MIGRATE] Applying migration: ${migration.name}...`);
      try {
        db.transaction(() => {
          try {
            db.prepare(migration.query).run();
          } catch (innerErr) {
            // If ALTER TABLE fails due to duplicate column, it means it was applied manually or by an older version of this code.
            if (innerErr.message.includes('duplicate column name')) {
              console.warn(`[DB_MIGRATE] Warning during ${migration.name}: Column already exists. Assuming applied.`);
            } else {
              throw innerErr; // Re-throw other errors
            }
          }
          // If statement ran (or was duplicate), record the migration
          db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version.toString());
          console.log(`[DB_MIGRATE] Successfully applied and recorded migration: ${migration.name}`);
        })();
      } catch (err) {
        console.error(`[DB_MIGRATE] Failed to apply migration ${migration.name}:`, err);
        throw err;
      }
    } else {
      console.log(`[DB_MIGRATE] Migration ${migration.name} already applied, skipping.`);
    }
  }
  console.log('[DB_MIGRATE] All migrations checked.');
} catch (err) {
  console.error('[DB_MIGRATE] Migration failed:', err);
  process.exit(1);
}
// --- End of Simple Migration System ---


// Create tables if not exist
// Servers table: id, name, host, port, username, password, privateKey, created_at
// History table: id, server_id, command, output, created_at
// Context table: id, server_id, key, value
// Add chat_history table for per-server chat logs
// chat_history: id, server_id, role, message, created_at

db.exec(`
CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  password TEXT,
  privateKey TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  command TEXT NOT NULL,
  output TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id)
);
CREATE TABLE IF NOT EXISTS context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  key TEXT NOT NULL,
  value TEXT,
  FOREIGN KEY(server_id) REFERENCES servers(id)
);
CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  role TEXT NOT NULL, -- 'user' or 'ai'
  message TEXT NOT NULL,
  chat_session_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ai_request_context TEXT,
  FOREIGN KEY(server_id) REFERENCES servers(id)
);
`);

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

// API: Add history entry
app.post('/api/servers/:id/history', (req, res) => {
  const serverId = parseInt(req.params.id);
  const { command, output } = req.body;
  const currentSessionId = currentChatSessions.get(serverId);
  
  // If no session is set, use null (which is fine for the database)
  const sessionIdToUse = currentSessionId !== undefined && !isNaN(currentSessionId) ? currentSessionId : null;
  
  try {
    const stmt = db.prepare(`
      INSERT INTO history (server_id, command, output, chat_session_id, created_at) 
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    const result = stmt.run(serverId, command, output, sessionIdToUse);
    
    console.log(`[HISTORY] Added command "${command}" to server ${serverId}, session ${sessionIdToUse}`);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (error) {
    console.error('Error adding history:', error);
    res.status(500).json({ error: 'Failed to add history entry' });
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
    const jsonInstruction = `IMPORTANT: You MUST always respond in valid JSON format with exactly two fields:
1. "answer": A string containing your explanation, analysis, and advice
2. "commands": An array of shell command strings that the user can run (provide practical, relevant commands even if not explicitly requested)

Example response format:
{
  "answer": "I can see the issue. The disk is almost full at 98% capacity. Let me help you identify what is taking up space and clean it up.",
  "commands": ["df -h", "du -sh /* 2>/dev/null | sort -h", "find /var/log -name '*.log' -mtime +30 -size +100M"]
}

ALWAYS include relevant commands in the "commands" array, even if the user didn't explicitly ask for them. Do NOT include any text outside the JSON object.`;
    messages.push({ role: 'system', content: (systemPrompt || defaultSystemPrompt) + '\n\n' + jsonInstruction });
    if (withTerminalContext && terminalHistory.length > 0) {
      messages.push({ role: 'system', content: 'Recent terminal activity:' });
      messages.push(...terminalHistory.reverse().map(h => ({ role: 'user', content: `$ ${h.command}\n${h.output}` })));
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
      // Try to use responseMimeType for JSON output
      let geminiPayload = {
        contents: geminiMessages,
        generationConfig: {
          responseMimeType: 'application/json',
        },
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
        // If the API errors, fallback to prompt-based JSON
        geminiPayload = { contents: geminiMessages };
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

// --- Terminal Suggestion Endpoint (Gemini Flash) ---
// Accepts up to 6 recent terminal entries for context
app.post('/api/ai/terminal-suggest', async (req, res) => {
  try {
    const { entries, latestCommand, serverId, sessionId } = req.body;
    
    console.log('[TERMINAL-SUGGEST BACKEND] Received latestCommand:', latestCommand);
    console.log('[TERMINAL-SUGGEST BACKEND] Received serverId:', serverId, 'sessionId:', sessionId);
    
    // If we have serverId and sessionId, fetch session-specific history from database
    let contextEntries = entries; // fallback to provided entries
    let actualLatestCommand = latestCommand; // Store the actual latest command
    
    if (serverId && sessionId !== null && sessionId !== undefined && !isNaN(sessionId)) {
      try {
        // Get unique commands by using GROUP BY and taking the most recent output for each command
        const sessionHistory = db.prepare(`
          WITH RankedHistory AS (
            SELECT 
              command,
              output,
              created_at,
              ROW_NUMBER() OVER (PARTITION BY command ORDER BY created_at DESC) as rn
            FROM history 
            WHERE server_id = ? AND chat_session_id = ?
          )
          SELECT command, output, created_at
          FROM RankedHistory
          WHERE rn = 1
          ORDER BY created_at DESC 
          LIMIT 6
        `).all(serverId, sessionId);
        
        if (sessionHistory.length > 0) {
          contextEntries = sessionHistory.map(h => ({
            command: h.command || '',
            output: (h.output || '').slice(0, 1000)
          }));
          // Use the most recent command from database
          actualLatestCommand = sessionHistory[0]?.command || latestCommand;
          console.log('[TERMINAL-SUGGEST BACKEND] Using latest command from DB:', actualLatestCommand);
        }
      } catch (dbError) {
        console.error('[TERMINAL-SUGGEST BACKEND] Database error:', dbError);
      }
    }
    
    console.log('[TERMINAL-SUGGEST BACKEND] Final entries for context:', JSON.stringify(contextEntries, null, 2));
    console.log('[TERMINAL-SUGGEST BACKEND] Final latest command:', actualLatestCommand);

    // Build prompt for Gemini with enhanced command explanation requirements
    let prompt = `You are a helpful Linux system administrator assistant. Based on the recent terminal command history below, suggest the next logical command that the user might want to run.

Recent command history (most recent last):
`;

    // Add commands in chronological order (oldest to newest)
    const chronologicalEntries = [...contextEntries].reverse();
    chronologicalEntries.forEach((entry, i) => {
      const cmd = entry.command || '';
      const out = entry.output || '';
      prompt += `${i + 1}. Command: ${cmd}\n`;
      if (out.trim()) {
        // Truncate long outputs
        const truncatedOutput = out.length > 500 ? out.substring(0, 500) + '...' : out;
        prompt += `   Output: ${truncatedOutput}\n`;
      }
      prompt += '\n';
    });

    prompt += `Based on this command history, what would be a logical next command? Focus especially on the most recent command: "${actualLatestCommand}"

Provide your response as a JSON object with:
- "answer": A brief explanation of what the suggested command does
- "commands": An array of 1-3 suggested commands (just the command strings)
- "explanations": An array of detailed explanations for each command, matching the order of the commands array. Each explanation should describe:
  1. What the command does
  2. Why it's relevant after the previous command
  3. What output to expect

Example response:
{
  "answer": "After checking disk usage with df, let's examine which directories are using the most space",
  "commands": ["du -sh /*", "ncdu /", "ls -laSh"],
  "explanations": [
    "The 'du -sh /*' command shows disk usage for each top-level directory, helping identify large directories.",
    "ncdu is an interactive disk usage analyzer that lets you browse directories and see what's taking up space. You can navigate with arrow keys.",
    "ls -laSh sorts files by size (largest first) and shows sizes in human-readable format. This helps spot large files in the current directory."
  ]
}`;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      console.error('[TERMINAL-SUGGEST BACKEND] GEMINI_API_KEY not found in environment');
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=' + GEMINI_API_KEY,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
          stopSequences: ["}"]
        }
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (response.status !== 200) {
      console.error('[TERMINAL-SUGGEST BACKEND] Gemini API error:', response.status, response.data);
      return res.status(500).json({ error: 'Failed to get suggestions from Gemini' });
    }

    const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[TERMINAL-SUGGEST BACKEND] Raw Gemini response:', rawText);

    // Clean and parse the response
    let cleanedText = rawText.trim();
    // Remove code block markers if present
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.replace(/^```json\n?/, '').replace(/```$/, '');
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```\n?/, '').replace(/```$/, '');
    }
    cleanedText = cleanedText.trim();
    
    try {
      const parsedJson = JSON.parse(cleanedText + '}'); // Add closing brace if missing
      if (!parsedJson.answer || !Array.isArray(parsedJson.commands) || !Array.isArray(parsedJson.explanations)) {
        throw new Error('Invalid response format');
      }
      res.json({
        response: parsedJson.answer,
        json: parsedJson,
        prompt: prompt // Include prompt for debugging
      });
    } catch (parseError) {
      console.error('[TERMINAL-SUGGEST BACKEND] JSON parse error:', parseError, 'cleanedText:', cleanedText);
      // Try to salvage the response if possible
      const fallbackJson = {
        answer: "Here are some suggested commands based on your recent activity",
        commands: ["ls -l", "pwd", "df -h"],
        explanations: [
          "List files with detailed information including permissions and sizes",
          "Show current working directory path",
          "Show disk space usage in human-readable format"
        ]
      };
      res.json({
        response: fallbackJson.answer,
        json: fallbackJson,
        prompt: prompt,
        error: 'Failed to parse Gemini response, using fallback suggestions'
      });
    }
    
  } catch (error) {
    console.error('[TERMINAL-SUGGEST BACKEND] Error:', error?.response?.data || error);
    res.status(500).json({ 
      error: 'Failed to get suggestions',
      details: error?.response?.data?.error || error.message
    });
  }
});

// --- Alternative Terminal Suggestion Endpoint (Gemini Flash) ---
// Accepts up to 6 recent terminal entries for context
app.post('/api/ai/terminal-suggest-alt', async (req, res) => {
  const { entries, previousSuggestion } = req.body;
  function escapeForPrompt(str) {
    if (!str || typeof str !== 'string') return 'N/A';
    return str.replace(/[`$\\]/g, match => '\\' + match).replace(/\u0000/g, '');
  }
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = 'gemini-2.5-flash-preview-04-17';
    let prompt = '';
    if (Array.isArray(entries) && entries.length > 0 && previousSuggestion) {
      prompt = 'The user just ran these recent commands in the terminal (oldest to newest):\n';
      // Show commands in chronological order
      const chronologicalEntries = [...entries].reverse();
      chronologicalEntries.forEach((e, idx) => {
        const cmd = escapeForPrompt(e.command);
        const out = escapeForPrompt(e.output);
        prompt += `\n${idx + 1}. $ ${cmd}\n   Output: ${out}`;
      });
      const prev = typeof previousSuggestion === 'object' ? JSON.stringify(previousSuggestion.json || previousSuggestion.response || previousSuggestion) : escapeForPrompt(previousSuggestion);
      prompt += `\n\nThe previous suggestion was: ${prev}\n`;
      prompt += `\nBased on the most recent command "${escapeForPrompt(entries[0]?.command || '')}", suggest an alternative next best command or troubleshooting step as JSON: {"answer": "...", "commands": ["..."]}. Do not repeat the previous suggestion.`;
    } else {
      return res.status(400).json({ error: 'Missing entries or previousSuggestion' });
    }
    const geminiMessages = [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ];
    const geminiPayload = {
      contents: geminiMessages,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };
    let response;
    let aiResponse = '';
    let aiJson = null;
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
      // If the API errors, fallback to prompt-based JSON
      geminiPayload = { contents: geminiMessages };
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
    res.json({
      response: aiResponse,
      json: aiJson,
      model: 'gemini',
      created_at: new Date().toISOString(),
      prompt: prompt
    });
  } catch (err) {
    console.error('Terminal Alternative Suggestion error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error', details: err.response?.data || null });
  }
});

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
  let lastPrompt = '';
  let isShellReady = false;
  conn.on('ready', () => {
    conn.shell({ term: 'xterm-color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) {
        ws.send(`Shell error: ${err.message}`);
        ws.close();
        conn.end();
        return;
      }
      shellStream = stream;
      isShellReady = true;
      stream.on('data', (data) => {
        const text = data.toString('utf8');
        ws.send(text);
        outputBuffer += text;
        // Detect command completion by prompt (simple heuristic: $ or # at line start)
        const lines = outputBuffer.split(/\r?\n/);
        const lastLine = lines[lines.length - 1];
        if (/[$#] $/.test(lastLine)) {
          // Command likely finished, log it
          if (commandBuffer.trim()) {
            const currentSessionId = currentChatSessions.get(Number(serverId));
            // Validate session ID before using it
            const sessionIdToUse = currentSessionId !== undefined && !isNaN(currentSessionId) ? currentSessionId : null;
            
            try {
              db.prepare('INSERT INTO history (server_id, command, output, chat_session_id) VALUES (?, ?, ?, ?)')
                .run(serverId, commandBuffer.trim(), outputBuffer, sessionIdToUse);
              console.log(`[TERMINAL] Logged command with session ID: ${sessionIdToUse}`);
            } catch (error) {
              console.error('[TERMINAL] Failed to log command:', error);
            }
            
            commandBuffer = '';
            outputBuffer = '';
          }
        }
      });
      stream.on('close', () => {
        ws.close();
        conn.end();
      });
      stream.stderr?.on('data', (data) => {
        ws.send(data.toString('utf8'));
        outputBuffer += data.toString('utf8');
      });
    });
  }).on('error', (err) => {
    ws.send(`SSH error: ${err.message}`);
    ws.close();
  }).connect({
    host: serverRow.host,
    port: serverRow.port,
    username: serverRow.username,
    password: serverRow.password || undefined,
    privateKey: serverRow.privateKey || undefined,
  });
  ws.on('message', (msg) => {
    if (!isShellReady || !shellStream) return;
    shellStream.write(msg);
    // Buffer command for logging (simple: accumulate until Enter) 
    if (typeof msg === 'string' && msg.endsWith('\n')) {
      commandBuffer += msg;
    } else if (typeof msg === 'string') {
      commandBuffer += msg;
    }
  });
  ws.on('close', () => {
    if (shellStream) shellStream.end();
    conn.end();
  });
}); 