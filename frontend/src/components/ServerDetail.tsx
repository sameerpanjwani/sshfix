import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getServer, getHistory, testServerConnection } from '../api/servers';
import Chat from './Chat';
import Terminal from './Terminal';

const PANEL_HEIGHT = 700; // px, shared height for chat and terminal

const ServerDetail: React.FC = () => {
  const { id } = useParams();
  const [server, setServer] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testModal, setTestModal] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [quickCommand, setQuickCommand] = useState<string | null>(null);
  const [model, setModel] = useState<'openai' | 'gemini' | 'claude'>('openai');
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<string | null>(null);
  const [geminiSuggestions, setGeminiSuggestions] = useState<any[]>([]);

  useEffect(() => {
    if (id) {
      getServer(Number(id)).then(setServer);
      getHistory(Number(id)).then(setHistory);
      setLoading(false);
    }
  }, [id]);

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
      <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', minHeight: PANEL_HEIGHT }}>
        {/* Chat (Left) */}
        <div style={{ flex: 1, minWidth: 340, borderRight: '1px solid #f0f0f0', padding: 32, background: '#f5f7fa', borderBottomLeftRadius: 16, height: PANEL_HEIGHT }}>
          <Chat
            onQuickCommand={handleQuickCommand}
            panelHeight={PANEL_HEIGHT}
            serverId={Number(id)}
            model={model}
            setModel={setModel}
            sendToTerminal={setPendingTerminalCommand}
            geminiSuggestions={geminiSuggestions}
          />
        </div>
        {/* Terminal (Right) */}
        <div style={{ flex: 1, minWidth: 340, padding: 32, background: '#181818', borderBottomRightRadius: 16, height: PANEL_HEIGHT }}>
          <Terminal
            serverId={Number(id)}
            initialHistory={history}
            quickCommand={pendingTerminalCommand || quickCommand}
            onQuickCommandUsed={() => {
              setPendingTerminalCommand(null);
              setQuickCommand(null);
            }}
            panelHeight={PANEL_HEIGHT}
            onGeminiSuggestion={handleGeminiSuggestion}
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