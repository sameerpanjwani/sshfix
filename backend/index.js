const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const path = require('path');
const { Client: SSHClient } = require('ssh2');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new Database(path.join(__dirname, 'sshfix.db'));

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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  const history = db.prepare('SELECT * FROM history WHERE server_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(history);
});

// API: Add history entry
app.post('/api/servers/:id/history', (req, res) => {
  const { command, output } = req.body;
  const stmt = db.prepare('INSERT INTO history (server_id, command, output) VALUES (?, ?, ?)');
  const info = stmt.run(req.params.id, command, output);
  res.json({ id: info.lastInsertRowid });
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

// API: Get chat history for a server, optionally by date
app.get('/api/servers/:id/chat', (req, res) => {
  const { date } = req.query;
  let rows;
  if (date) {
    // Get all messages for the given date (YYYY-MM-DD)
    rows = db.prepare(`SELECT * FROM chat_history WHERE server_id = ? AND DATE(created_at) = ? ORDER BY created_at ASC`).all(req.params.id, date);
  } else {
    // Get all messages
    rows = db.prepare(`SELECT * FROM chat_history WHERE server_id = ? ORDER BY created_at ASC`).all(req.params.id);
  }
  res.json(rows);
});

// API: Add chat message to history
app.post('/api/servers/:id/chat', (req, res) => {
  const { role, message } = req.body;
  if (!role || !message) return res.status(400).json({ error: 'role and message required' });
  const stmt = db.prepare('INSERT INTO chat_history (server_id, role, message) VALUES (?, ?, ?)');
  const info = stmt.run(req.params.id, role, message);
  res.json({ id: info.lastInsertRowid });
});

// Update AI Suggestion Endpoint to use and store chat history
app.post('/api/ai', async (req, res) => {
  const { prompt, model, serverId, withTerminalContext, newSession, systemPrompt, imageUrls, messageId, edit } = req.body;
  console.log('[AI ENDPOINT] Received imageUrls:', imageUrls);
  try {
    if (newSession && serverId) {
      db.prepare('DELETE FROM chat_history WHERE server_id = ?').run(serverId);
    }
    let chatHistory = [];
    if (serverId) {
      chatHistory = db.prepare('SELECT id, role, message FROM chat_history WHERE server_id = ? ORDER BY created_at ASC').all(serverId);
      // Exclude Gemini suggestion messages from AI context
      chatHistory = chatHistory.filter(m => m.role !== 'gemini-suggest');
    }
    let terminalHistory = [];
    if (withTerminalContext && serverId) {
      terminalHistory = db.prepare('SELECT command, output FROM history WHERE server_id = ? ORDER BY created_at DESC LIMIT 3').all(serverId);
    }
    // Compose messages for AI API
    const messages = [];
    // Add system prompt
    const defaultSystemPrompt =
      'You are an expert server assistant operating in a terminal environment. You can suggest shell commands for the user to run, and you will see the output of those commands. Your job is to help the user diagnose, fix, and automate server issues using the terminal. Always be safe, never suggest anything that could cause harm, data loss, or security issues. Explain your reasoning, ask for confirmation before any risky action, and help the user get things done efficiently.';
    // --- Add JSON output instruction ---
    const jsonInstruction = 'Always respond in JSON with two fields: "answer" (string, your explanation and advice) and "commands" (array of shell commands the user could run, if any). Example: {"answer": "...", "commands": ["ls -la", "cat /etc/passwd"]}. Do not include any markdown or extra text.';
    messages.push({ role: 'system', content: (systemPrompt || defaultSystemPrompt) + '\n' + jsonInstruction });
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
        aiJson = JSON.parse(aiResponse);
      } catch (e) {
        aiJson = null;
      }
    } else if (model === 'gemini') {
      // Gemini 2.5 with image support and JSON mode if possible
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const geminiModel = 'gemini-2.5-flash-preview-04-17';
      let geminiMessages = messages
        .filter(m => m.role === 'user' || m.role === 'ai')
        .map(m => ({
          role: m.role === 'ai' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));
      // Prepend system prompt as first user message
      geminiMessages.unshift({
        role: 'user',
        parts: [{ text: (systemPrompt || defaultSystemPrompt) + '\n' + jsonInstruction }]
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
          aiJson = JSON.parse(aiResponse);
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
          aiJson = JSON.parse(aiResponse);
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
          aiJson = JSON.parse(aiResponse);
        } catch (e) {
          aiJson = null;
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid model' });
    }
    // Store or update user prompt and AI response in chat_history if serverId is present
    if (serverId) {
      if (edit && messageId) {
        db.prepare('UPDATE chat_history SET message = ? WHERE id = ? AND role = ?').run(prompt, messageId, 'user');
        const aiMsg = db.prepare('SELECT id FROM chat_history WHERE server_id = ? AND id > ? AND role = ? ORDER BY id ASC LIMIT 1').get(serverId, messageId, 'ai');
        if (aiMsg) {
          db.prepare('UPDATE chat_history SET message = ? WHERE id = ? AND role = ?').run(aiResponse, aiMsg.id, 'ai');
        }
      } else {
        db.prepare('INSERT INTO chat_history (server_id, role, message) VALUES (?, ?, ?)').run(serverId, 'user', prompt);
        db.prepare('INSERT INTO chat_history (server_id, role, message) VALUES (?, ?, ?)').run(serverId, 'ai', aiResponse);
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
app.post('/api/ai/terminal-suggest', async (req, res) => {
  const { command, output } = req.body;
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = 'gemini-2.5-flash-preview-04-17';
    const prompt = `The user just ran this command in the terminal:\n\n$ ${command}\n\nOutput:\n${output}\n\nSuggest the next best command or troubleshooting step as JSON: {"answer": "...", "commands": ["..."]}`;
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
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=` + geminiApiKey,
      geminiPayload
    );
    let aiResponse = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let aiJson = null;
    try {
      aiJson = JSON.parse(aiResponse);
    } catch (e) {
      aiJson = null;
    }
    res.json({
      response: aiResponse,
      json: aiJson,
      model: 'gemini',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Terminal Suggestion error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error', details: err.response?.data || null });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
}); 