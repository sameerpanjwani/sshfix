const fs = require('fs').promises;
const path = require('path');

/**
 * Clean and format AI response text
 * @param {string} text - Raw response from AI
 * @returns {string} Cleaned and formatted text
 */
function cleanAIResponse(text) {
    // Remove any system prompts or special tokens
    text = text.replace(/^(system:|assistant:|user:)/gim, '').trim();
    
    // Remove excessive newlines
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // Clean up code blocks
    text = text.replace(/```\s*\n/g, '```\n');
    
    return text;
}

/**
 * Process and save an image from AI response
 * @param {Buffer|string} imageData - Raw image data or base64 string
 * @param {string} [format='png'] - Image format
 * @returns {Promise<string>} Path to saved image
 */
async function processAIImage(imageData, format = 'png') {
    try {
        const uploadsDir = path.join(__dirname, '../../backend/uploads');
        
        // Ensure uploads directory exists
        await fs.mkdir(uploadsDir, { recursive: true });
        
        // Generate unique filename
        const filename = `ai-image-${Date.now()}.${format}`;
        const filepath = path.join(uploadsDir, filename);
        
        // Convert base64 to buffer if needed
        const buffer = Buffer.isBuffer(imageData) 
            ? imageData 
            : Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        
        // Save the image
        await fs.writeFile(filepath, buffer);
        
        return filepath;
    } catch (error) {
        console.error('Error processing AI image:', error);
        throw error;
    }
}

/**
 * Extract code blocks from AI response
 * @param {string} text - AI response text
 * @returns {Array<{language: string, code: string}>} Array of code blocks
 */
function extractCodeBlocks(text) {
    const codeBlocks = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        codeBlocks.push({
            language: match[1] || 'plaintext',
            code: match[2].trim()
        });
    }

    return codeBlocks;
}

/**
 * Format command output for AI context
 * @param {string} command - Executed command
 * @param {string} output - Command output
 * @returns {string} Formatted context
 */
function formatCommandContext(command, output) {
    return `Command: ${command}\nOutput:\n${output}\n`;
}

module.exports = {
    cleanAIResponse,
    processAIImage,
    extractCodeBlocks,
    formatCommandContext
}; 