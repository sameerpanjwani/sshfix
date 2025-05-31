require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const database = require('./config/database');
const serverRoutes = require('./routes/serverRoutes');
const chatRoutes = require('./routes/chatRoutes');
const terminalService = require('./services/terminalService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../backend/uploads')));

// API Routes
app.use('/api/servers', serverRoutes);
app.use('/api/chat', chatRoutes);

// WebSocket handling for terminal sessions
wss.on('connection', (ws, req) => {
    const serverId = new URL(req.url, 'http://localhost').searchParams.get('serverId');
    
    if (!serverId) {
        ws.close();
        return;
    }

    terminalService.initializeSession(ws, serverId);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Initialize database and start server
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        // Connect to database
        await database.connect();
        
        // Initialize database tables
        await database.initialize();
        
        // Start server
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

        // Graceful shutdown
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

function shutdown() {
    console.log('Shutting down gracefully...');
    
    // Close all terminal sessions
    terminalService.closeAllSessions();
    
    // Close database connection
    database.close()
        .then(() => {
            console.log('Database connection closed');
            process.exit(0);
        })
        .catch(err => {
            console.error('Error closing database:', err);
            process.exit(1);
        });
}

startServer(); 