import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getServer, getHistory, testServerConnection, getChatSessions } from '../api/servers';
import Chat from './Chat';
import InteractiveTerminal from './Terminal';
import axios from 'axios';

const PANEL_HEIGHT = 700; // px, shared height for chat and terminal

// Define SessionInfo interface
interface SessionInfo {
  sessionId: string;
  startTime: string;
  label: string;
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

  // Enhanced onHistoryUpdate: update history and fetch Gemini suggestion
  const handleHistoryUpdate = async (newHistory: any[]) => {
    setHistory(newHistory); // Store global history
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    timeoutIdRef.current = setTimeout(async () => {
      try {
        const capturedSessionId = currentChatSessionIdRef.current;
        const capturedAvailableSessions = availableChatSessionsRef.current;
        
        if (capturedSessionId === null) {
          console.log('[ServerDetail.tsx] No current session ID, skipping suggestions');
          return;
        }
        
        const currentSession = capturedAvailableSessions.find(s => s.sessionId === capturedSessionId.toString());
        
        if (!currentSession) {
          console.log('[ServerDetail.tsx] No current session found, skipping suggestions');
          return;
        }
        
        console.log(`[ServerDetail.tsx] Using session-based filtering for session ${capturedSessionId}`);
        
        const sessionIdStr = currentSession.sessionId?.toString();
        const sessionHistory = newHistory.filter(e => 
          e.chat_session_id?.toString() === sessionIdStr
        );
        const entriesForSuggestion = sessionHistory.slice(-6).reverse().map(e => ({
          command: e.command || '',
          output: (e.output || '').slice(0, 1000)
        }));

        if (entriesForSuggestion.length === 0) {
          console.log('[ServerDetail.tsx] No commands available for suggestions');
          return;
        }

        const baseUrl = window.location.origin.includes('localhost') ? 'http://localhost:4000' : window.location.origin;
        const latestCommand = newHistory.length > 0 ? (newHistory[newHistory.length - 1].command || '') : '';
        
        console.log(`[ServerDetail.tsx] Sending suggestion request for session ${capturedSessionId}`);
        
        const response = await axios.post(baseUrl + '/api/ai/terminal-suggest', {
          entries: entriesForSuggestion,
          latestCommand: latestCommand,
          serverId: Number(id),
          sessionId: capturedSessionId
        });
        
        if (response.data && (response.data.response || response.data.json)) {
          setGeminiSuggestions(prev => {
            const newSuggestions = [...prev, response.data].slice(-3); // Keep last 3
            return newSuggestions;
          });
        } else if (response.data && response.data.error) {
          console.error('[ServerDetail.tsx] Backend error for terminal suggestion:', response.data.error);
        }
      } catch (error) {
        console.error('[ServerDetail.tsx] Error fetching Gemini suggestion:', error);
      }
    }, 300);
  };
  
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
      <div style={{ padding: '16px 32px', borderBottom: '1px solid #f0f0f0', background: '#f8fafc', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div><b>Host:</b> {server.host}</div>
        <div><b>Username:</b> {server.username}</div>
        <div><b>Port:</b> {server.port}</div>
      </div>
      {/* Main Area */}
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', minHeight: PANEL_HEIGHT, height: PANEL_HEIGHT }}>
        {/* Chat (Left) */}
        <div style={{ flex: 1, minWidth: 340, borderRight: '1px solid #f0f0f0', padding: 32, background: '#f5f7fa', borderBottomLeftRadius: 16, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
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
        {/* Terminal (Right) */}
        <div style={{ flex: 1, minWidth: 340, padding: 32, background: '#181818', borderBottomRightRadius: 16, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
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
    </div>
  );
};

export default ServerDetail; 