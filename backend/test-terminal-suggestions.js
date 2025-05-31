require('dotenv').config();
const axios = require('axios');
const serverRepository = require('./src/repositories/serverRepository');
const terminalSuggestionService = require('./src/services/terminalSuggestionService');
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

console.log('\n=== TESTING TERMINAL SUGGESTIONS FEATURE ===');
console.log('Using SESSION_ID:', SESSION_ID);

// Direct database access for debugging
const db = new Database(path.join(__dirname, 'sshfix.db'));

// Main test function
async function testTerminalSuggestions() {
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

    console.log('\n[STEP 3] Testing direct suggestion service call');
    // Test getting a suggestion directly from the service
    const directSuggestionResult = await terminalSuggestionService.getSuggestions({
      entries: TEST_TERMINAL_ENTRIES,
      latestCommand: TEST_TERMINAL_ENTRIES[TEST_TERMINAL_ENTRIES.length - 1].command,
      serverId: SERVER_ID,
      sessionId: SESSION_ID
    });
    
    const hasSuggestion = directSuggestionResult && 
                          (directSuggestionResult.json || directSuggestionResult.response);
    
    console.log('[INFO] Direct suggestion service call successful:', hasSuggestion);
    if (directSuggestionResult.json) {
      console.log('[INFO] Suggestion JSON:', JSON.stringify(directSuggestionResult.json, null, 2).substring(0, 200) + '...');
    }
    
    console.log('\n[STEP 4] Testing the terminal history-with-suggestion endpoint');
    // Test the combined history and suggestion endpoint
    const historyWithSuggestionResponse = await axios.post(`${API_BASE}/terminal/history-with-suggestion`, {
      serverId: SERVER_ID,
      command: 'ls -la',
      output: 'test output',
      sessionId: SESSION_ID
    });
    
    const hasEndpointSuggestion = historyWithSuggestionResponse.data && 
                                 historyWithSuggestionResponse.data.suggestion &&
                                 (historyWithSuggestionResponse.data.suggestion.json || 
                                  historyWithSuggestionResponse.data.suggestion.response);
    
    console.log('[INFO] History-with-suggestion endpoint response:', 
                JSON.stringify(historyWithSuggestionResponse.data).substring(0, 200) + '...');
    console.log('[INFO] Endpoint returned suggestion:', hasEndpointSuggestion);
    
    console.log('\n[STEP 5] Testing the standalone suggest endpoint');
    // Test the dedicated suggestion endpoint
    const suggestResponse = await axios.post(`${API_BASE}/terminal/suggest`, {
      entries: TEST_TERMINAL_ENTRIES,
      latestCommand: TEST_TERMINAL_ENTRIES[TEST_TERMINAL_ENTRIES.length - 1].command,
      serverId: SERVER_ID,
      sessionId: SESSION_ID
    });
    
    const hasStandaloneSuggestion = suggestResponse.data && 
                                   (suggestResponse.data.json || suggestResponse.data.response);
    
    console.log('[INFO] Standalone suggest endpoint response:', 
                JSON.stringify(suggestResponse.data).substring(0, 200) + '...');
    console.log('[INFO] Endpoint returned suggestion:', hasStandaloneSuggestion);
    
    // Debug network request for frontend
    console.log('\n[DEBUG] Network request for frontend testing:');
    console.log(`curl -X POST ${API_BASE}/terminal/suggest -H "Content-Type: application/json" -d '{"entries":${JSON.stringify(TEST_TERMINAL_ENTRIES)},"latestCommand":"${TEST_TERMINAL_ENTRIES[TEST_TERMINAL_ENTRIES.length - 1].command}","serverId":${SERVER_ID},"sessionId":"${SESSION_ID}"}'`);
    
    return hasSuggestion && hasEndpointSuggestion && hasStandaloneSuggestion;
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
testTerminalSuggestions()
  .then(passed => {
    console.log(`\n[RESULT] Terminal suggestions test: ${passed ? 'PASSED' : 'FAILED'}`);
    if (passed) {
      console.log('[SUCCESS] Terminal suggestions feature is working properly on the backend');
      console.log('[NEXT STEPS] Check frontend integration:');
      console.log('1. Make sure Terminal.tsx is calling onHistoryUpdate after each command');
      console.log('2. Verify ServerDetail.tsx is receiving suggestions in handleHistoryUpdate');
      console.log('3. Check that geminiSuggestions state is being updated in ServerDetail.tsx');
      console.log('4. Confirm the suggestions are being displayed in the UI');
    } else {
      console.log('[FAILURE] Terminal suggestions feature is not working properly');
    }
    process.exit(passed ? 0 : 1);
  })
  .catch(error => {
    console.error('[FATAL ERROR]', error);
    process.exit(1);
  }); 