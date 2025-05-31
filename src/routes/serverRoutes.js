const express = require('express');
const router = express.Router();
const serverRepository = require('../repositories/serverRepository');
const sshService = require('../services/sshService');
const upload = require('../config/multer');
const path = require('path');
const fs = require('fs');

// Get all servers
router.get('/', async (req, res) => {
    try {
        const servers = await serverRepository.getAllServers();
        res.json(servers);
    } catch (error) {
        console.error('Error fetching servers:', error);
        res.status(500).json({ error: 'Failed to fetch servers' });
    }
});

// Get server by ID
router.get('/:id', async (req, res) => {
    try {
        const server = await serverRepository.getServerById(req.params.id);
        if (!server) {
            return res.status(404).json({ error: 'Server not found' });
        }
        res.json(server);
    } catch (error) {
        console.error('Error fetching server:', error);
        res.status(500).json({ error: 'Failed to fetch server' });
    }
});

// Create new server
router.post('/', async (req, res) => {
    try {
        const server = await serverRepository.createServer(req.body);
        res.status(201).json(server);
    } catch (error) {
        console.error('Error creating server:', error);
        res.status(500).json({ error: 'Failed to create server' });
    }
});

// Update server
router.put('/:id', async (req, res) => {
    try {
        const server = await serverRepository.updateServer(req.params.id, req.body);
        if (!server) {
            return res.status(404).json({ error: 'Server not found' });
        }
        res.json(server);
    } catch (error) {
        console.error('Error updating server:', error);
        res.status(500).json({ error: 'Failed to update server' });
    }
});

// Delete server
router.delete('/:id', async (req, res) => {
    try {
        await serverRepository.deleteServer(req.params.id);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting server:', error);
        res.status(500).json({ error: 'Failed to delete server' });
    }
});

// Execute command on server
router.post('/:id/execute', async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) {
            return res.status(400).json({ error: 'Command is required' });
        }

        const result = await sshService.executeCommand(req.params.id, command);
        res.json(result);
    } catch (error) {
        console.error('Error executing command:', error);
        res.status(500).json({ error: 'Failed to execute command' });
    }
});

// Upload file to server
router.post('/:id/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { remotePath } = req.body;
        if (!remotePath) {
            return res.status(400).json({ error: 'Remote path is required' });
        }

        await sshService.uploadFile(
            req.params.id,
            req.file.path,
            remotePath
        );

        res.json({ message: 'File uploaded successfully' });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Download file from server
router.post('/:id/download', async (req, res) => {
    try {
        const { remotePath } = req.body;
        if (!remotePath) {
            return res.status(400).json({ error: 'Remote path is required' });
        }

        const localPath = path.join(__dirname, '../../backend/uploads', 
            `download-${Date.now()}-${path.basename(remotePath)}`);

        await sshService.downloadFile(
            req.params.id,
            remotePath,
            localPath
        );

        res.download(localPath, path.basename(remotePath), (err) => {
            // Clean up downloaded file after sending
            fs.unlink(localPath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('Error cleaning up downloaded file:', unlinkErr);
                }
            });
        });
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Get command history
router.get('/:id/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const history = await serverRepository.getCommandHistory(req.params.id, limit);
        res.json(history);
    } catch (error) {
        console.error('Error fetching command history:', error);
        res.status(500).json({ error: 'Failed to fetch command history' });
    }
});

module.exports = router; 