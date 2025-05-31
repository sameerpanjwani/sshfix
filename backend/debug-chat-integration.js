require('dotenv').config();
const serverRepository = require('./src/repositories/serverRepository');
const chatRepository = require('./src/repositories/chatRepository');
const Database = require('better-sqlite3');
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const terminalSuggestionService = require('./src/services/terminalSuggestionService');

// Direct database access for debugging
const db = new Database(path.join(__dirname, 'sshfix.db'));

// List all tables
console.log("Listing all tables in the database:");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
tables.forEach(table => {
  console.log(`- ${table.name}`);
});

console.log("\n----------------------------------------");

// Check server table structure
console.log("\nServer table structure:");
const serverColumns = db.prepare("PRAGMA table_info(servers)").all();
console.log(serverColumns.map(col => `${col.name} (${col.type})`).join(', '));

// Check history table structure
console.log("\nHistory table structure:");
const historyColumns = db.prepare("PRAGMA table_info(history)").all();
console.log(historyColumns.map(col => `${col.name} (${col.type})`).join(', '));

// Check chat_history table structure
console.log("\nChat history table structure:");
const chatHistoryColumns = db.prepare("PRAGMA table_info(chat_history)").all();
console.log(chatHistoryColumns.map(col => `${col.name} (${col.type})`).join(', '));

console.log("\n----------------------------------------");

// List servers with their session IDs
console.log("\nServers with session IDs:");
const servers = db.prepare("SELECT id, name, host, username, chat_session_id FROM servers").all();
servers.forEach(server => {
  console.log(`Server ${server.id}: ${server.name} (${server.host}) - Session ID: ${server.chat_session_id}`);
});

console.log("\n----------------------------------------");

// Check recent terminal history entries with session IDs
console.log("\nRecent terminal history with session IDs (last 10 entries):");
const history = db.prepare("SELECT id, server_id, command, substr(output, 1, 50) as output_sample, created_at, chat_session_id FROM history ORDER BY created_at DESC LIMIT 10").all();
history.forEach(entry => {
  console.log(`History ${entry.id}: Server ${entry.server_id}, Session ${entry.chat_session_id || 'NULL'}`);
  console.log(`  Command: ${entry.command}`);
  console.log(`  Output sample: ${entry.output_sample}${entry.output_sample.length >= 50 ? '...' : ''}`);
  console.log(`  Created: ${entry.created_at}`);
});

console.log("\n----------------------------------------");

// Check chat sessions for each server
console.log("\nChat sessions by server:");
servers.forEach(server => {
  console.log(`\nServer ${server.id} (${server.name}) sessions:`);
  
  // Using the repository function
  try {
    const sessions = db.prepare(`
      SELECT DISTINCT 
        chat_session_id as sessionId,
        MIN(created_at) as startTime,
        COUNT(*) as messageCount
      FROM chat_history 
      WHERE server_id = ? 
      GROUP BY chat_session_id 
      ORDER BY MIN(created_at) DESC
    `).all(server.id);
    
    if (sessions.length === 0) {
      console.log("  No chat sessions found");
    } else {
      sessions.forEach(session => {
        console.log(`  Session ${session.sessionId}: ${session.messageCount} messages, started ${session.startTime}`);
      });
    }
  } catch (error) {
    console.error(`  Error getting sessions for server ${server.id}:`, error);
  }
});

console.log("\n----------------------------------------");

// Test retrieving session history
console.log("\nTesting session history retrieval for each server's current session:");
servers.forEach(server => {
  if (server.chat_session_id) {
    console.log(`\nServer ${server.id} (${server.name}) - Session ${server.chat_session_id}:`);
    try {
      const sessionHistory = serverRepository.getSessionHistory(server.id, server.chat_session_id);
      console.log(`  Found ${sessionHistory.length} history entries`);
      sessionHistory.forEach((entry, i) => {
        console.log(`  ${i+1}. Command: ${entry.command}`);
        console.log(`     Output: ${entry.output?.substring(0, 50)}${entry.output?.length > 50 ? '...' : ''}`);
      });
    } catch (error) {
      console.error(`  Error retrieving session history:`, error);
    }
  } else {
    console.log(`\nServer ${server.id} (${server.name}) has no current session`);
  }
});

// Check if there's any mismatch between history.chat_session_id and servers.chat_session_id
console.log("\n----------------------------------------");
console.log("\nChecking for session ID mismatches:");
servers.forEach(server => {
  if (server.chat_session_id) {
    const historyWithSession = db.prepare("SELECT COUNT(*) as count FROM history WHERE server_id = ? AND chat_session_id = ?").get(server.id, server.chat_session_id);
    const historyTotal = db.prepare("SELECT COUNT(*) as count FROM history WHERE server_id = ?").get(server.id);
    
    console.log(`Server ${server.id} (${server.name}):`);
    console.log(`  Total history entries: ${historyTotal.count}`);
    console.log(`  History entries with current session ID (${server.chat_session_id}): ${historyWithSession.count}`);
    console.log(`  Percentage match: ${historyTotal.count > 0 ? Math.round(historyWithSession.count / historyTotal.count * 100) : 0}%`);
  }
});

// Constants
const SERVER_ID = 1;
const SESSION_ID = Date.now();
const API_BASE = 'http://localhost:4000/api';

// Test entries
const TEST_ENTRIES = [
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

// Helper function to open database connection
async function openDb() {
  return open({
    filename: './sshfix.db',
    driver: sqlite3.Database
  });
}

// Helper function to check if a table exists
async function tableExists(db, tableName) {
  const result = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName]);
  return !!result;
}

// Test database setup and check for duplicates
async function testDatabaseSetup() {
  console.log('\n[TEST] Checking database setup and looking for duplicates...');
  
  const db = await openDb();
  
  // Check if history table exists
  const historyExists = await tableExists(db, 'history');
  console.log(`History table exists: ${historyExists}`);
  
  if (historyExists) {
    // Check for session ID column
    try {
      const tableInfo = await db.all(`PRAGMA table_info(history)`);
      const hasSessionId = tableInfo.some(col => col.name === 'chat_session_id');
      console.log(`History table has session ID column: ${hasSessionId}`);
      
      if (!hasSessionId) {
        console.error('[ERROR] chat_session_id column missing! This is required for session tracking.');
      }
    } catch (error) {
      console.error('[ERROR] Failed to check history schema:', error);
    }
    
    // Check for duplicates
    try {
      const duplicates = await db.all(`
        SELECT command, output, COUNT(*) as count
        FROM history
        WHERE server_id = ?
        GROUP BY command, output
        HAVING count > 1
      `, [SERVER_ID]);
      
      if (duplicates.length > 0) {
        console.error('[ERROR] Found duplicate entries in history:');
        duplicates.forEach(dup => {
          console.error(`  Command: ${dup.command.substring(0, 50)}... (appears ${dup.count} times)`);
        });
      } else {
        console.log('[SUCCESS] No duplicate entries found in history');
      }
      
      // Get recent entries
      const recentEntries = await db.all(`
        SELECT id, command, output, chat_session_id, created_at
        FROM history
        WHERE server_id = ?
        ORDER BY id DESC
        LIMIT 10
      `, [SERVER_ID]);
      
      console.log('\n[INFO] Recent history entries:');
      recentEntries.forEach(entry => {
        console.log(`  ID: ${entry.id}, Command: ${entry.command.substring(0, 30)}..., Session ID: ${entry.chat_session_id || 'NULL'}`);
      });
    } catch (error) {
      console.error('[ERROR] Failed to check for duplicates:', error);
    }
  }
  
  await db.close();
}

// Add test entries to database with proper session ID
async function addTestEntries() {
  console.log('\n[TEST] Adding test entries with session ID...');
  
  try {
    // Insert entries one by one to simulate real usage
    for (const entry of TEST_ENTRIES) {
      const response = await axios.post(`${API_BASE}/servers/${SERVER_ID}/history`, {
        ...entry,
        chat_session_id: SESSION_ID,
        created_at: new Date().toISOString()
      });
      
      console.log(`[SUCCESS] Added entry: ${entry.command}`);
    }
    
    console.log('[SUCCESS] All test entries added with session ID:', SESSION_ID);
  } catch (error) {
    console.error('[ERROR] Failed to add test entries:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else {
      console.error('Error message:', error.message);
    }
  }
}

// Test direct suggestion service
async function testDirectSuggestion() {
  console.log('\n[TEST] Testing terminal suggestion service directly...');
  
  try {
    const result = await terminalSuggestionService.getSuggestions({
      entries: TEST_ENTRIES,
      latestCommand: TEST_ENTRIES[TEST_ENTRIES.length - 1].command,
      serverId: SERVER_ID,
      sessionId: SESSION_ID
    });
    
    console.log('[SUCCESS] Direct service call result:');
    console.log(JSON.stringify(result, null, 2));
    return true;
  } catch (error) {
    console.error('[ERROR] Direct service call failed:', error);
    return false;
  }
}

// Test suggestion API endpoint
async function testSuggestionAPI() {
  console.log('\n[TEST] Testing suggestion API endpoint...');
  
  try {
    const response = await axios.post(`${API_BASE}/terminal/suggest`, {
      entries: TEST_ENTRIES,
      latestCommand: TEST_ENTRIES[TEST_ENTRIES.length - 1].command,
      serverId: SERVER_ID,
      sessionId: SESSION_ID
    });
    
    console.log('[SUCCESS] API endpoint call result:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('[ERROR] API endpoint call failed:');
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else {
      console.error('Error message:', error.message);
    }
    return false;
  }
}

// Test session tracking
async function testSessionTracking() {
  console.log('\n[TEST] Testing session tracking...');
  const sessionId = SESSION_ID;
  
  try {
    // 1. First update the server to use our session ID
    const setSessionResponse = await axios.post(`${API_BASE}/servers/${SERVER_ID}/set-chat-session`, 
      { sessionId: String(sessionId) }, // Ensure sessionId is a string and properly formatted as JSON
      { 
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log('[SUCCESS] Set session response:', setSessionResponse.data);
    
    // 2. Now add some entries with our session ID
    for (const entry of TEST_ENTRIES) {
      await axios.post(`${API_BASE}/servers/${SERVER_ID}/history`, {
        ...entry,
        chat_session_id: sessionId,
        created_at: new Date().toISOString()
      });
    }
    console.log('[SUCCESS] Added test entries with session ID:', sessionId);
    
    // 3. Get history entries for our session
    const response = await axios.get(`${API_BASE}/servers/${SERVER_ID}/history`);
    const allEntries = response.data;
    
    // 4. Filter entries by our session ID
    const sessionEntries = allEntries.filter(entry => 
      entry.chat_session_id === sessionId || 
      entry.chat_session_id === `${sessionId}` ||
      entry.chat_session_id === `${sessionId}.0`
    );
    
    console.log(`[INFO] Found ${sessionEntries.length} entries for session ID ${sessionId}`);
    console.log(`[INFO] Total history entries: ${allEntries.length}`);
    
    if (sessionEntries.length === 0) {
      console.log('[WARNING] No entries found with our session ID!');
      
      // Show the first few entries to debug
      console.log('[DEBUG] First 3 history entries session IDs:');
      allEntries.slice(0, 3).forEach(entry => {
        console.log(`  Entry ID ${entry.id}: "${entry.command.substring(0, 10)}...", Session: "${entry.chat_session_id}"`);
        console.log(`  Types - Entry session ID: ${typeof entry.chat_session_id}, Test session ID: ${typeof sessionId}`);
        console.log(`  Comparison: "${entry.chat_session_id}" === "${sessionId}" -> ${entry.chat_session_id === sessionId}`);
      });
      
      return false;
    }
    
    return sessionEntries.length >= TEST_ENTRIES.length;
  } catch (error) {
    console.error('[ERROR] Session tracking test failed:');
    console.error('Error message:', error.message || error);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    return false;
  }
}

// Check frontend components
async function testBrowserIntegration() {
  console.log('\n[TEST] Browser integration check...');
  console.log('[INFO] For frontend debugging, add these console logs to your browser:');
  console.log(`
  // Add to browser console for debugging
  let originalFetch = window.fetch;
  window.fetch = function(...args) {
    console.log('Fetch called with:', args);
    return originalFetch.apply(this, args);
  };
  
  // For axios debugging
  let originalPost = axios.post;
  axios.post = function(...args) {
    console.log('Axios POST called with:', args);
    return originalPost.apply(this, args);
  };
  `);
  
  console.log('\n[INFO] Frontend check points:');
  console.log('1. Verify Terminal.tsx is calling onHistoryUpdate after each command');
  console.log('2. Verify ServerDetail.tsx handleHistoryUpdate function is being called');
  console.log('3. Verify the axios.post call to /api/terminal/suggest is being made');
  console.log('4. Check browser network tab for the actual request');
  console.log('5. Verify geminiSuggestions state is being updated in ServerDetail.tsx');
}

// Main test function
async function runTests() {
  console.log('Starting integrated testing for terminal suggestions and chat sessions...');
  console.log('SESSION_ID for this test:', SESSION_ID);
  
  let testsPassed = 0;
  let totalTests = 4;
  
  // Test database setup and check for duplicates
  await testDatabaseSetup();
  
  // Test adding entries with session ID
  if (await addTestEntries()) {
    testsPassed++;
  }
  
  // Test direct suggestion service
  if (await testDirectSuggestion()) {
    testsPassed++;
  }
  
  // Test suggestion API endpoint
  if (await testSuggestionAPI()) {
    testsPassed++;
  }
  
  // Test session tracking
  if (await testSessionTracking()) {
    testsPassed++;
  }
  
  // Check browser integration
  await testBrowserIntegration();
  
  console.log(`\n[SUMMARY] Tests passed: ${testsPassed}/${totalTests}`);
  
  if (testsPassed === totalTests) {
    console.log('[SUCCESS] All tests passed! The issue is likely in the frontend component integration.');
    console.log('[SUGGESTION] Check the browser console for errors when terminal commands are executed.');
  } else {
    console.log('[WARNING] Some tests failed. Fix the backend issues before investigating frontend.');
  }
}

// Run all tests
runTests().catch(error => {
  console.error('[FATAL ERROR]', error);
}); 