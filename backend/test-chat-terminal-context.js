require('dotenv').config();
const axios = require('axios');
const serverRepository = require('./src/repositories/serverRepository');
const chatRepository = require('./src/repositories/chatRepository');
const aiService = require('./src/services/aiService');
const Database = require('better-sqlite3');
const path = require('path');

// Constants
const SERVER_ID = 1;
const SESSION_ID = Date.now().toString();
const API_BASE = 'http://localhost:4000/api';

// Test terminal commands and outputs
const TEST_TERMINAL_ENTRIES = [
  { 
    command: 'ls -la', 
    output: 'total 36\ndrwxr-xr-x 5 user user 4096 Jul 15 12:34 .\ndrwxr-xr-x 3 user user 4096 Jul 15 12:34 ..' 
  },
  { 
    command: 'cd backend', 
    output: '' 
  },
  { 
    command: 'node index.js', 
    output: 'Server running on port 4000' 
  }
];

console.log('\n=== TESTING TERMINAL CONTEXT IN CHAT CONVERSATIONS ===');
console.log('Using SESSION_ID:', SESSION_ID);

// Direct database access for debugging
const db = new Database(path.join(__dirname, 'sshfix.db'));

// Main test function
async function testTerminalContextInChat() {
  try {
    console.log('\n[STEP 1] Setting up test session ID for server');
    // Set session ID for the server
    await axios.post(`${API_BASE}/servers/${SERVER_ID}/set-chat-session`, 
      { sessionId: SESSION_ID },
      { headers: { 'Content-Type': 'application/json' }}
    );
    console.log('[SUCCESS] Set session ID for server');

    console.log('\n[STEP 2] Adding terminal history with the session ID');
    // Add test terminal entries
    for (const entry of TEST_TERMINAL_ENTRIES) {
      await axios.post(`${API_BASE}/servers/${SERVER_ID}/history`, {
        ...entry,
        chat_session_id: SESSION_ID,
        created_at: new Date().toISOString()
      });
    }
    console.log('[SUCCESS] Added terminal history entries');
    
    // Verify terminal entries were added with correct session ID
    const terminalHistory = serverRepository.getSessionHistory(SERVER_ID, SESSION_ID);
    console.log(`[INFO] Found ${terminalHistory.length} terminal history entries for session`);
    
    if (terminalHistory.length === 0) {
      console.error('[ERROR] No terminal history found with the session ID');
      return false;
    }

    console.log('\n[STEP 3] Sending a chat request with withTerminalContext=true');
    // Send a chat request that should include terminal context
    const chatPrompt = "What was the last command I ran?";
    const aiResponse = await aiService.processAIRequest({
      prompt: chatPrompt,
      model: 'gemini', // Using Gemini as default, will fall back to local if no API key
      serverId: SERVER_ID,
      chatSessionId: SESSION_ID,
      withTerminalContext: true,
      systemPrompt: null,
      imageUrls: [],
      messageId: null,
      edit: false,
      req: { headers: {} }
    });
    
    console.log('[SUCCESS] Received AI response');
    
    // Get the AI request context from the database
    const chatHistory = await chatRepository.getChatHistory(SERVER_ID, SESSION_ID);
    const lastAiMessage = chatHistory.find(msg => msg.role === 'ai');
    
    if (!lastAiMessage || !lastAiMessage.ai_request_context) {
      console.error('[ERROR] Could not find AI message with request context');
      return false;
    }
    
    console.log('\n[STEP 4] Analyzing AI request context');
    // Parse the context to see if it includes terminal history
    let contextIncludesTerminalHistory = false;
    try {
      const context = JSON.parse(lastAiMessage.ai_request_context);
      
      // Look for terminal commands in system messages
      const systemMessages = context.filter(msg => msg.role === 'system');
      
      if (systemMessages.length > 1) {
        // The second system message usually contains terminal context
        const terminalContextMsg = systemMessages[1]?.content || '';
        
        // Check if each terminal command is included in the context
        contextIncludesTerminalHistory = TEST_TERMINAL_ENTRIES.every(entry => 
          terminalContextMsg.includes(entry.command)
        );
        
        console.log('[INFO] Context includes terminal commands:', contextIncludesTerminalHistory);
        
        // Print the terminal context portion for inspection
        console.log('\n--- Terminal Context Sent to AI ---');
        console.log(terminalContextMsg.substring(0, 500) + (terminalContextMsg.length > 500 ? '...' : ''));
        console.log('-----------------------------------\n');
      } else {
        console.log('[WARNING] Expected multiple system messages, but found only:', systemMessages.length);
      }
    } catch (error) {
      console.error('[ERROR] Failed to parse AI request context:', error);
      return false;
    }
    
    return contextIncludesTerminalHistory;
  } catch (error) {
    console.error('[ERROR] Test failed:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Run the test
testTerminalContextInChat()
  .then(passed => {
    console.log(`\n[RESULT] Terminal context in chat test: ${passed ? 'PASSED' : 'FAILED'}`);
    if (passed) {
      console.log('[SUCCESS] Terminal history is properly included in AI context');
    } else {
      console.log('[FAILURE] Terminal history is not properly included in AI context');
    }
    process.exit(passed ? 0 : 1);
  })
  .catch(error => {
    console.error('[FATAL ERROR]', error);
    process.exit(1);
  }); 