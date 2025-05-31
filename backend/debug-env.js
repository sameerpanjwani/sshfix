require('dotenv').config();
const terminalSuggestionService = require('./src/services/terminalSuggestionService');

// Check if environment variables are loaded
console.log('Environment variables:');
console.log('- GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'Configured (length: ' + process.env.GEMINI_API_KEY.length + ')' : 'Not configured');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured');
console.log('- CLAUDE_API_KEY:', process.env.CLAUDE_API_KEY ? 'Configured' : 'Not configured');

// Test the terminal suggestion service
async function testTerminalSuggestion() {
  try {
    console.log('\nTesting terminal suggestion service...');
    const result = await terminalSuggestionService.getSuggestions({
      entries: [
        { command: 'ls -la', output: 'total 123\ndrwxr-xr-x 2 user user 4096 May 10 12:34 .' },
        { command: 'ps aux', output: 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND' }
      ],
      latestCommand: 'ps aux',
      serverId: 1,
      sessionId: 123
    });
    console.log('Suggestion result:', result ? 'Success' : 'Failed');
    if (result) {
      console.log('Response content available:', result.response ? 'Yes' : 'No');
      console.log('JSON content available:', result.json ? 'Yes' : 'No');
    }
  } catch (error) {
    console.error('Error testing terminal suggestion:', error);
  }
}

testTerminalSuggestion(); 