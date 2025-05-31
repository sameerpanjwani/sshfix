// This is a test script to check if terminal suggestions are working properly
const axios = require('axios');
const dotenv = require('dotenv');
const terminalSuggestionService = require('./src/services/terminalSuggestionService');

// Load environment variables
dotenv.config();

async function testSuggestionEndpoint() {
  console.log('Testing terminal suggestion service directly...');
  console.log('GEMINI_API_KEY exists:', !!process.env.GEMINI_API_KEY);
  console.log('GEMINI_API_KEY first few chars:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 10) + '...' : 'none');
  
  const testEntries = [
    { command: 'ls -la', output: 'total 36\ndrwxr-xr-x 5 user user 4096 Jul 15 12:34 .\ndrwxr-xr-x 3 user user 4096 Jul 15 12:34 ..\n-rw-r--r-- 1 user user  220 Jul 15 12:34 .bash_profile' },
    { command: 'cd backend', output: '' },
    { command: 'node index.js', output: 'Server running on port 4000' }
  ];
  
  // Test direct service call
  try {
    console.log('\n[TEST] Calling terminalSuggestionService.getSuggestions directly...');
    const directResult = await terminalSuggestionService.getSuggestions({
      entries: testEntries,
      latestCommand: 'node index.js',
      serverId: 1,
      sessionId: Date.now()
    });
    
    console.log('\n[SUCCESS] Direct service call result:');
    console.log(JSON.stringify(directResult, null, 2));
  } catch (error) {
    console.error('\n[ERROR] Error in direct service call:');
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from Gemini API');
      console.error('Request:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
  
  // Test Gemini API directly
  try {
    console.log('\n[TEST] Testing Gemini API directly with a simple prompt...');
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = 'gemini-2.5-flash-preview-04-17';
    
    const geminiPayload = {
      contents: [{ parts: [{ text: "Say hello" }] }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
        stopSequences: []
      }
    };

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
      geminiPayload,
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    console.log('\n[SUCCESS] Direct Gemini API call result:');
    console.log('Status:', response.status);
    console.log('Text output:', response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No text received');
  } catch (error) {
    console.error('\n[ERROR] Error testing Gemini API directly:');
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error message:', error.message);
    }
  }
  
  // Test API endpoint via HTTP
  try {
    console.log('\n[TEST] Calling /api/terminal/suggest endpoint via HTTP...');
    const apiResult = await axios.post('http://localhost:4000/api/terminal/suggest', {
      entries: testEntries,
      latestCommand: 'node index.js',
      serverId: 1,
      sessionId: Date.now()
    });
    
    console.log('\n[SUCCESS] API endpoint call result:');
    console.log(JSON.stringify(apiResult.data, null, 2));
  } catch (error) {
    console.error('\n[ERROR] Error in API endpoint call:');
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error message:', error.message);
    }
  }
}

// Run the test
testSuggestionEndpoint().catch(error => {
  console.error('[FATAL ERROR]', error);
}); 