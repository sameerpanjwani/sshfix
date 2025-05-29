const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const path = require('path');
const { Client: SSHClient } = require('ssh2');
const axios = require('axios');

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
`);

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

// AI Suggestion Endpoint
app.post('/api/ai', async (req, res) => {
  const { prompt, model } = req.body;
  try {
    let aiResponse = '';
    if (model === 'openai') {
      // OpenAI GPT-3.5/4
      const openaiApiKey = process.env.OPENAI_API_KEY;
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
      });
      aiResponse = response.data.choices[0].message.content;
    } else if (model === 'gemini') {
      // Google Gemini (via Vertex AI or API)
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const response = await axios.post(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + geminiApiKey,
        { contents: [{ parts: [{ text: prompt }] }] }
      );
      aiResponse = response.data.candidates[0].content.parts[0].text;
    } else if (model === 'claude') {
      // Anthropic Claude
      const claudeApiKey = process.env.CLAUDE_API_KEY;
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-opus-20240229',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      });
      aiResponse = response.data.content[0].text;
    } else {
      return res.status(400).json({ error: 'Invalid model' });
    }
    res.json({ response: aiResponse });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
}); 