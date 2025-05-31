const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { runMigrations } = require('./migrations');
const terminalService = require('./src/services/terminalService');

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize database and run migrations
runMigrations();

// Import routes
const serverRoutes = require('./src/routes/serverRoutes');
const chatRoutes = require('./src/routes/chatRoutes');
const terminalRoutes = require('./src/routes/terminalRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const aiRoutes = require('./src/routes/aiRoutes');

// Mount routes
app.use('/api/servers', serverRoutes);
app.use('/api', chatRoutes);
app.use('/api/terminal', terminalRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/ai', aiRoutes);

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Start server and setup WebSocket
const server = app.listen(process.env.PORT || 4000, () => {
  console.log(`Backend server running on port ${process.env.PORT || 4000}`);
});

// Setup WebSocket terminal service
terminalService.setupWebSocketServer(server); 