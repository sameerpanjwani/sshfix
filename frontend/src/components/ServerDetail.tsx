import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getServer, getHistory, testServerConnection, getChatSessions } from '../api/servers';
import Chat from './Chat';
import InteractiveTerminal from './Terminal';
import axios from 'axios';

// Constants
const PANEL_HEIGHT = 700; // px, shared height for chat and terminal
const API_BASE = window.location.origin.includes('localhost') 
  ? 'http://localhost:4000/api' 
  : '/api';

// Define SessionInfo interface
interface SessionInfo {
  sessionId: string;
  startTime: string;
  label: string;
}

// Add these type definitions after the SessionInfo interface
interface TerminalEntry {
  command: string;
  output: string;
  created_at?: string;
  chat_session_id?: string | null;
}

interface TerminalSuggestion {
  response?: string;
  json?: any;
  prompt?: string;
  error?: string;
}

interface HistoryWithSuggestion {
  history: TerminalEntry[];
  suggestion: TerminalSuggestion;
}

const ServerDetail: React.FC = () => {
  const { id } = useParams();
  const [server, setServer] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testModal, setTestModal] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [quickCommand, setQuickCommand] = useState<string | null>(null);
  const [model, setModel] = useState<'openai' | 'gemini' | 'gemini-pro' | 'claude'>('openai');
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<string | null>(null);
  const [geminiSuggestions, setGeminiSuggestions] = useState<any[]>([]);
  const [terminalClearSignal, setTerminalClearSignal] = useState(0);
  const timeoutIdRef = useRef<number | null>(null); // For managing the timeout (browser uses number)

  // New state for chat sessions - now using numeric session IDs
  const [currentChatSessionId, setCurrentChatSessionId] = useState<number | null>(null);
  const [availableChatSessions, setAvailableChatSessions] = useState<SessionInfo[]>([]);

  // Refs to hold the latest session state for use in setTimeout
  const currentChatSessionIdRef = useRef(currentChatSessionId);
  const availableChatSessionsRef = useRef(availableChatSessions);

  useEffect(() => {
    currentChatSessionIdRef.current = currentChatSessionId;
  }, [currentChatSessionId]);

  useEffect(() => {
    availableChatSessionsRef.current = availableChatSessions;
  }, [availableChatSessions]);

  // Notify backend of current session when it changes
  useEffect(() => {
    if (id && currentChatSessionId !== null && !isNaN(currentChatSessionId) && currentChatSessionId > 0) {
      const sessionString = `server-${Number(id)}-session-${currentChatSessionId}`;
      const baseUrl = window.location.origin.includes('localhost') ? 'http://localhost:4000' : window.location.origin;
      
      console.log(`[ServerDetail.tsx] Sending session ID to backend: ${sessionString} (sessionId: ${currentChatSessionId})`);
      
      axios.post(`${baseUrl}/api/servers/${id}/set-chat-session`, {
        sessionId: sessionString
      }).then(() => {
        console.log(`[ServerDetail.tsx] Successfully set backend chat session to ${currentChatSessionId}`);
      }).catch(error => {
        console.error('[ServerDetail.tsx] Error setting chat session:', error);
      });
    } else {
      console.log(`[ServerDetail.tsx] Skipping session setup - id: ${id}, sessionId: ${currentChatSessionId}, valid: ${currentChatSessionId !== null && !isNaN(currentChatSessionId) && currentChatSessionId > 0}`);
    }
  }, [id, currentChatSessionId]);

  useEffect(() => {
    if (id) {
      const serverId = Number(id);
      setLoading(true);
      setCurrentChatSessionId(null); // Reset while loading new server data
      setAvailableChatSessions([]);
      setGeminiSuggestions([]); // Clear suggestions for new server
      setHistory([]); // Clear terminal history for new server

      Promise.all([
        getServer(serverId),
        getHistory(serverId),
        getChatSessions(serverId) // Fetch available chat sessions
      ]).then(([serverData, historyData, sessionsData]) => {
        setServer(serverData);
        setHistory(historyData);

        const loadedSessions = sessionsData || [];
        
        // Filter out sessions with non-numeric session IDs (legacy data)
        const numericSessions = loadedSessions.filter((s: SessionInfo) => {
          const parsed = parseInt(s.sessionId);
          return !isNaN(parsed) && parsed > 0;
        });

        console.log('[ServerDetail.tsx] Loaded sessions:', loadedSessions);
        console.log('[ServerDetail.tsx] Numeric sessions:', numericSessions);

        if (numericSessions.length > 0) {
          setAvailableChatSessions(numericSessions);
          const latestSessionId = parseInt(numericSessions[0].sessionId);
          console.log('[ServerDetail.tsx] Setting session ID to:', latestSessionId);
          setCurrentChatSessionId(latestSessionId); // Load most recent numeric session from DB
        } else {
          // No existing numeric sessions in DB, generate a new one client-side
          const newSessionId = Date.now(); // Use timestamp as unique ID
          console.log('[ServerDetail.tsx] Creating new session ID:', newSessionId);
          setCurrentChatSessionId(newSessionId);
          const newClientSession = { 
            sessionId: newSessionId.toString(), 
            startTime: new Date().toISOString(), 
            label: `Session ${newSessionId}` 
          };
          setAvailableChatSessions([newClientSession]);
        }
        setLoading(false);
      }).catch(error => {
        console.error("Error loading server details:", error);
        setLoading(false);
        // Handle error state appropriately, e.g., show error message to user
      });
    }
  }, [id]);

  const handleStartNewChatSession = () => {
    if (id) {
      const newSessionId = Date.now(); // Use timestamp as unique session ID
      setCurrentChatSessionId(newSessionId);
      const newSessionEntry = { 
        sessionId: newSessionId.toString(), 
        startTime: new Date().toISOString(), 
        label: `Session ${newSessionId}` 
      };
      setAvailableChatSessions(prevSessions => [
        newSessionEntry,
        ...prevSessions.filter(s => s.sessionId !== newSessionId.toString()) 
      ]);
      setGeminiSuggestions([]); // Clear suggestions for new session
      setTerminalClearSignal(prev => prev + 1); // Increment to trigger terminal clear
    }
  };

  const handleTestConnection = async () => {
    if (!id) return;
    setTesting(true);
    setTestModal(true);
    setTestResult(null);
    try {
      const result = await testServerConnection(Number(id));
      setTestResult(result);
    } catch (e: any) {
      let errorMsg = e?.response?.data?.error || e.message || 'Unknown error';
      let tips = ['Unexpected error.'];
      if (e?.response?.status === 404) {
        errorMsg = 'Backend endpoint not found (404).';
        tips = [
          'Is the backend server running?',
          'Is the /api/servers/:id/test endpoint implemented?',
          'Check your backend logs and code for typos or missing routes.',
          'Ensure the frontend is calling the correct backend URL.'
        ];
      } else if (errorMsg.includes('Network Error')) {
        tips = [
          'Could not reach backend. Is the backend server running?',
          'Check your network connection.',
          'Is the backend running on the expected port (default 4000)?',
          'Check browser console and backend logs for more info.'
        ];
      }
      setTestResult({ success: false, error: errorMsg, tips });
    }
    setTesting(false);
  };

  // Pass quickCommand to Terminal, then clear it after use
  const handleQuickCommand = (cmd: string) => {
    setQuickCommand(cmd);
  };

  // Handler to add Gemini suggestion as a chat message
  const handleGeminiSuggestion = (suggestion: any) => {
    setGeminiSuggestions(prev => [...prev, suggestion]);
  };

  // Helper to get last 6 terminal entries from history
  const getLastTerminalEntries = () => {
    return history.slice(-6);
  };

  // Add this helper function to format suggestions for the chat UI
  const formatSuggestionForChat = (suggestion: TerminalSuggestion) => {
    if (!suggestion) return null;
    
    try {
      const json = suggestion.json || {};
      
      // Extract relevant data from the suggestion
      const nextCommand = json.nextCommand || '';
      const explanation = json.explanation || '';
      const alternatives = Array.isArray(json.alternatives) ? json.alternatives : [];
      
      // Create a formatted message for the chat UI
      return {
        role: 'assistant',
        message: `**Terminal Suggestion**\n\n💡 Try: \`${nextCommand}\`\n\n${explanation}\n\n${
          alternatives.length > 0 
            ? `**Alternatives:**\n${alternatives.map((alt: string) => `- \`${alt}\``).join('\n')}`
            : ''
        }`,
        model: 'gemini',
        timestamp: new Date().toISOString(),
        isTerminalSuggestion: true
      };
    } catch (error) {
      console.error('[ServerDetail.tsx] Error formatting suggestion:', error);
      return null;
    }
  };

  // Handler for direct suggestions from Terminal component
  const handleDirectSuggestion = (suggestion: TerminalSuggestion) => {
    console.log('[ServerDetail.tsx] Received direct suggestion from Terminal:', suggestion);
    if (suggestion) {
      // Format the suggestion for display
      const formattedSuggestion = formatSuggestionForChat(suggestion);
      
      // Update state with the new suggestion
      if (formattedSuggestion) {
        setGeminiSuggestions(prev => {
          const newSuggestions = [...prev, formattedSuggestion].slice(-3); // Keep last 3
          return newSuggestions;
        });
      }
    }
  };

  // Enhanced onHistoryUpdate: update history and fetch Gemini suggestion
  const handleHistoryUpdate = async (newHistoryData: TerminalEntry[] | HistoryWithSuggestion) => {
    // Check if this is a combined history+suggestion response
    if ('history' in newHistoryData && 'suggestion' in newHistoryData) {
      const { history: newHistory, suggestion } = newHistoryData as HistoryWithSuggestion;
      setHistory(newHistory); // Store global history
      console.log('[ServerDetail.tsx] Found suggestion in history update', {
        suggestionExists: !!suggestion,
        suggestionJson: suggestion?.json,
        suggestionResponse: suggestion?.response?.substring(0, 100)
      });
      
      handleDirectSuggestion(suggestion);
      return;
    }
    
    // Otherwise, treat as a regular history array
    const newHistory = newHistoryData as TerminalEntry[];
    setHistory(newHistory); // Store global history
    console.log('[ServerDetail.tsx] Regular history update received, length:', newHistory.length);
    
    // Clear any existing timeout
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    
    // Set new timeout for debounced suggestion
    timeoutIdRef.current = setTimeout(async () => {
      try {
        console.log('[ServerDetail.tsx] Debounced history update triggered');
        
        // Skip if no history entries
        if (!newHistory || newHistory.length === 0) {
          console.log('[ServerDetail.tsx] No history entries available, skipping suggestions');
          return;
        }
        
        // Get current session ID
        const currentSession = currentChatSessionIdRef.current;
        if (!currentSession) {
          console.log('[ServerDetail.tsx] No current session ID available, skipping suggestions');
          return;
        }
        
        console.log('[ServerDetail.tsx] Using current session ID:', currentSession);
        
        // Use the most recent 6 entries regardless of session ID
        const entriesForSuggestion = newHistory.slice(-6).map(e => ({
          command: e.command || '',
          output: (e.output || '').slice(0, 1000) // Limit output length
        }));
        
        // Get latest command
        const latestCommand = newHistory[newHistory.length - 1]?.command || '';
        
        console.log('[ServerDetail.tsx] Using entries for suggestion:', entriesForSuggestion);
        console.log('[ServerDetail.tsx] Latest command:', latestCommand);
        
        // Get base URL
        const baseUrl = window.location.origin.includes('localhost') 
          ? 'http://localhost:4000' 
          : window.location.origin;
        
        // Call suggestion API with the current session ID
        console.log('[ServerDetail.tsx] Calling suggestion API at:', baseUrl + '/api/terminal/suggest');
        console.log('[ServerDetail.tsx] Request payload:', {
          entries: entriesForSuggestion,
          latestCommand,
          serverId: Number(id),
          sessionId: currentSession
        });
        
        const response = await axios.post(baseUrl + '/api/terminal/suggest', {
          entries: entriesForSuggestion,
          latestCommand,
          serverId: Number(id),
          sessionId: currentSession
        });
        
        // Update suggestions if we got a valid response
        if (response.data && (response.data.response || response.data.json)) {
          console.log('[ServerDetail.tsx] Got valid response from suggestion API:', {
            hasResponse: !!response.data.response,
            hasJson: !!response.data.json,
            jsonKeys: response.data.json ? Object.keys(response.data.json) : [],
            responsePreview: response.data.response ? response.data.response.substring(0, 100) : ''
          });
          
          // Before updating suggestions state, check what's currently there
          console.log('[ServerDetail.tsx] Current geminiSuggestions length:', geminiSuggestions.length);
          
          // Format the suggestion properly for display
          const formattedSuggestion = formatSuggestionForChat(response.data);
          console.log('[ServerDetail.tsx] Formatted suggestion:', formattedSuggestion);
          
          setGeminiSuggestions(prev => {
            const newSuggestions = [...prev, response.data].slice(-3); // Keep last 3
            console.log('[ServerDetail.tsx] Updated geminiSuggestions length will be:', newSuggestions.length);
            return newSuggestions;
          });
        } else if (response.data && response.data.error) {
          console.error('[ServerDetail.tsx] Backend error for terminal suggestion:', response.data.error);
        } else {
          console.log('[ServerDetail.tsx] Unexpected API response format:', response.data);
        }
      } catch (error) {
        console.error('[ServerDetail.tsx] Error fetching Gemini suggestion:', error);
        if (axios.isAxiosError(error)) {
          console.error('[ServerDetail.tsx] Axios error details:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
          });
        }
      }
    }, 1000); // Debounce 1 second
  };
  
  // Run onHistoryUpdate effect to get initial suggestions
  useEffect(() => {
    // Ensure we have a session ID for this server
    const ensureSessionId = async () => {
      if (!server?.id) return;
      
      // Create a timestamp-based session ID if none exists
      const sessionId = server.chat_session_id || Date.now().toString();
      
      console.log('[ServerDetail] Ensuring session ID for server', server.id, 'Current:', server.chat_session_id, 'Using:', sessionId);
      
      // Set session ID on server if needed
      if (!server.chat_session_id) {
        try {
          await axios.post(`${API_BASE}/servers/${server.id}/set-chat-session`, { sessionId });
          console.log('[ServerDetail] Set new session ID for server:', sessionId);
          // Update local server state with new session ID
          setServer((prev: any) => prev ? {...prev, chat_session_id: sessionId} : null);
        } catch (error) {
          console.error('[ServerDetail] Error setting session ID:', error);
        }
      }
    };
    
    ensureSessionId();
  }, [server?.id]);

  if (loading || !server) return <div>Loading...</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '32px auto', background: '#fff', borderRadius: 16, boxShadow: '0 4px 24px #0002', padding: 0 }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 32px 16px 32px', borderBottom: '1px solid #eee', borderTopLeftRadius: 16, borderTopRightRadius: 16, background: 'linear-gradient(90deg, #6cf 0%, #e0e7ff 100%)' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#213547' }}>Server: {server.name}</div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button style={{ borderRadius: 8, background: '#fff', color: '#6cf', fontWeight: 700, border: '1px solid #6cf', padding: '8px 20px', fontSize: 16, boxShadow: '0 1px 4px #0001' }} onClick={handleTestConnection}>Test Connection</button>
          <Link to="/" style={{ color: '#213547', textDecoration: 'underline', fontWeight: 500 }}>← Back to Servers</Link>
        </div>
      </div>
      {/* Server Info */}
      <div style={{ padding: '16px 32px', borderBottom: '1px solid #f0f0f0', background: '#f8fafc', display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center' }}>
        <div><b>Host:</b> {server.host}</div>
        <div><b>Username:</b> {server.username}</div>
        <div><b>Port:</b> {server.port}</div>
        <Link 
          to={`/server/${id}/db`} 
          target="_blank"
          rel="noopener noreferrer"
          style={{ 
            marginLeft: 'auto', 
            color: '#2563eb', 
            textDecoration: 'none', 
            background: '#e0e7ff', 
            padding: '6px 12px', 
            borderRadius: 6, 
            fontSize: 14, 
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          View DB Entries
          <span style={{ fontSize: 12 }}>↗</span>
        </Link>
      </div>
      {/* Main Area */}
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', minHeight: PANEL_HEIGHT, height: PANEL_HEIGHT }}>
        {/* Terminal (Left) */}
        <div style={{ flex: 1, minWidth: 340, borderRight: '1px solid #2a2a2a', padding: '16px 0', background: '#181818', borderBottomLeftRadius: 16, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <InteractiveTerminal
            serverId={Number(id)}
            panelHeight={PANEL_HEIGHT}
            quickCommand={pendingTerminalCommand || quickCommand}
            onQuickCommandUsed={() => {
              setPendingTerminalCommand(null);
              setQuickCommand(null);
            }}
            onHistoryUpdate={handleHistoryUpdate}
            clearSignal={terminalClearSignal}
            sessionId={server?.chat_session_id}
          />
        </div>
        {/* Chat (Right) */}
        <div style={{ flex: 1, minWidth: 340, padding: 32, background: '#f5f7fa', borderBottomRightRadius: 16, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <Chat
            onQuickCommand={handleQuickCommand}
            panelHeight={PANEL_HEIGHT}
            serverId={Number(id)}
            model={model}
            setModel={setModel}
            sendToTerminal={setPendingTerminalCommand}
            geminiSuggestions={geminiSuggestions}
            getLastTerminalEntries={getLastTerminalEntries}
            setGeminiSuggestions={setGeminiSuggestions}
            currentChatSessionId={currentChatSessionId?.toString() || null}
            onStartNewSession={handleStartNewChatSession}
          />
        </div>
      </div>
      {/* Test Connection Modal */}
      {testModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.25)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 32px #0004', padding: 32, minWidth: 340, maxWidth: 420, position: 'relative' }}>
            <button onClick={() => setTestModal(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}>&times;</button>
            <h2 style={{ marginTop: 0, color: testResult?.success ? '#22bb55' : '#e53e3e' }}>
              {testing ? 'Testing Connection...' : testResult?.success ? 'Connection Successful' : 'Connection Failed'}
            </h2>
            {testResult && (
              <>
                <div style={{ marginBottom: 8 }}><b>Server Type/OS:</b> <span style={{ color: '#213547' }}>{testResult.os || 'Unknown'}</span></div>
                {testResult.error && <div style={{ color: '#e53e3e', marginBottom: 8 }}><b>Error:</b> {testResult.error}</div>}
                <div style={{ marginBottom: 8 }}><b>Tips:</b>
                  <ul style={{ margin: '8px 0 0 18px', color: '#213547' }}>
                    {testResult.tips?.map((tip: string, i: number) => <li key={i}>{tip}</li>)}
                  </ul>
                </div>
              </>
            )}
            {testing && <div style={{ color: '#888', marginTop: 16 }}>Please wait...</div>}
          </div>
        </div>
      )}
      {/* Gemini Suggestions Tab Section */}
      {geminiSuggestions.length > 0 && (
        <div style={{ 
          marginBottom: 16, 
          background: '#f0f4ff', 
          borderRadius: 10, 
          boxShadow: '0 1px 4px #0001', 
          padding: 12, 
          border: '1px solid #b6d0ff', 
          position: 'relative',
          maxHeight: '300px',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, color: '#2563eb', fontSize: 16 }}>
              Terminal Suggestions ({geminiSuggestions.length})
            </div>
            <span 
              style={{ 
                fontSize: 13, 
                color: '#2563eb', 
                background: '#f8fafc', 
                borderRadius: 6, 
                padding: '2px 10px', 
                zIndex: 2, 
                cursor: 'pointer', 
                textDecoration: 'underline' 
              }} 
              onClick={() => console.log('Current suggestions:', geminiSuggestions)}
            >
              Debug Suggestions
            </span>
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {geminiSuggestions.map((suggestion, idx) => {
              console.log(`[DEBUG] Rendering suggestion ${idx}:`, suggestion);
              
              // Get data from various possible formats
              const json = suggestion.json || {};
              const nextCommand = json.nextCommand || '';
              const explanation = json.explanation || '';
              const alternatives = Array.isArray(json.alternatives) ? json.alternatives : [];
              
              return (
                <div 
                  key={idx} 
                  style={{ 
                    marginBottom: 12, 
                    background: '#fff', 
                    borderRadius: 8, 
                    padding: 10, 
                    boxShadow: '0 1px 2px #0001', 
                    border: '1px solid #e0e7ff',
                    position: 'relative' 
                  }}
                >
                  {/* Show suggestion details */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, color: '#1e3a8a', marginBottom: 4 }}>
                      Suggested Command:
                    </div>
                    <div 
                      style={{ 
                        background: '#f5f3ff', 
                        padding: '6px 12px', 
                        borderRadius: 6, 
                        fontFamily: 'monospace', 
                        cursor: 'pointer',
                        border: '1px solid #e9d5ff',
                        marginBottom: 8
                      }}
                      onClick={() => handleQuickCommand(nextCommand)}
                    >
                      {nextCommand || 'No command suggestion available'}
                    </div>
                    
                    {explanation && (
                      <div style={{ marginTop: 8, fontSize: 14, color: '#4b5563' }}>
                        {explanation}
                      </div>
                    )}
                    
                    {alternatives && alternatives.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontWeight: 600, color: '#1e3a8a', marginBottom: 4, fontSize: 14 }}>
                          Alternatives:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {alternatives.map((alt: string, i: number) => (
                            <div
                              key={i}
                              style={{
                                background: '#e0e7ff',
                                padding: '4px 10px',
                                borderRadius: 4,
                                fontSize: 13,
                                cursor: 'pointer',
                                color: '#4338ca'
                              }}
                              onClick={() => handleQuickCommand(alt)}
                            >
                              {alt}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ServerDetail; 