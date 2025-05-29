import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAISuggestion, getAIAvailability } from '../api/ai';
import { getChatHistory, addChatMessage } from '../api/servers';

const quickActions = [
  { label: 'List all files', value: 'ls -al' },
  { label: 'Find root folder', value: 'cd / && ls' },
  { label: 'Show running processes', value: 'ps aux' },
  { label: 'Check disk usage', value: 'df -h' },
];

interface ChatProps {
  onQuickCommand?: (command: string) => void;
}

const Chat: React.FC<ChatProps> = ({ onQuickCommand }) => {
  const { id } = useParams();
  const serverId = id ? Number(id) : undefined;
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<'openai' | 'gemini' | 'claude'>('openai');
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAIAvailable] = useState<{openai: boolean, gemini: boolean, claude: boolean} | null>(null);
  const [withTerminalContext, setWithTerminalContext] = useState(false);
  const [estimatedTokens, setEstimatedTokens] = useState<number | null>(null);
  const [newSession, setNewSession] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAIAvailability().then(setAIAvailable);
  }, []);

  useEffect(() => {
    if (serverId) {
      getChatHistory(serverId).then(setHistory);
    }
  }, [serverId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSend = async () => {
    if (!prompt || !serverId) return;
    setLoading(true);
    // Add user message
    await addChatMessage(serverId, 'user', prompt);
    setHistory([...history, { role: 'user', message: prompt, created_at: new Date().toISOString() }]);
    setPrompt('');
    // Get AI response
    try {
      const res = await getAISuggestion(prompt, model, serverId, withTerminalContext, newSession);
      await addChatMessage(serverId, 'ai', res.response);
      setHistory([...history, { role: 'user', message: prompt, created_at: new Date().toISOString() }, { role: 'ai', message: res.response, created_at: new Date().toISOString() }]);
      setEstimatedTokens(res.estimatedTokens || null);
      setNewSession(false); // Reset after first message in new session
    } catch (e: any) {
      let errorMsg = e?.response?.data?.error || e.message || 'Unknown error';
      let tip = '';
      if (e?.response?.status === 500) {
        tip = '\nAI service failed. Check your API keys, backend logs, and network connectivity.';
      }
      setHistory([
        ...history,
        { role: 'user', message: prompt, created_at: new Date().toISOString() },
        { role: 'ai', message: errorMsg + (tip ? `\n${tip}` : ''), created_at: new Date().toISOString() }
      ]);
      setEstimatedTokens(null);
    }
    setLoading(false);
  };

  const handleQuickAction = (value: string) => {
    setPrompt(value);
    if (onQuickCommand) {
      onQuickCommand(value); // Send directly to terminal
      setPrompt('');
    }
  };

  const handleNewSession = async () => {
    if (!serverId) return;
    setLoading(true);
    setNewSession(true);
    setHistory([]);
    setEstimatedTokens(null);
    await getChatHistory(serverId).then(setHistory); // Should be empty after backend clears
    setLoading(false);
  };

  const noAIConfigured = aiAvailable && !aiAvailable.openai && !aiAvailable.gemini && !aiAvailable.claude;

  return (
    <div style={{ background: '#f5f7fa', borderRadius: 12, padding: 16, minHeight: 320, boxShadow: '0 2px 8px #0001', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {noAIConfigured && (
        <div style={{ background: '#fff3cd', color: '#856404', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #ffeeba', fontWeight: 500 }}>
          ⚠️ No AI API keys configured on the backend. AI features will not work.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="with-terminal-context" checked={withTerminalContext} onChange={e => setWithTerminalContext(e.target.checked)} />
          <label htmlFor="with-terminal-context" style={{ fontWeight: 500 }}>Include terminal context</label>
        </div>
        <button onClick={handleNewSession} style={{ borderRadius: 8, background: '#fff', color: '#6cf', fontWeight: 700, border: '1px solid #6cf', padding: '6px 16px', fontSize: 14, boxShadow: '0 1px 4px #0001' }} disabled={loading}>New Chat Session</button>
        {estimatedTokens !== null && (
          <span style={{ color: '#888', fontSize: 13 }}>Estimated tokens: {estimatedTokens}</span>
        )}
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {quickActions.map((action, i) => (
          <button key={i} style={{ borderRadius: 6, background: '#e0e7ff', color: '#222', fontWeight: 500, border: 'none', padding: '6px 12px', cursor: 'pointer' }} onClick={() => handleQuickAction(action.value)}>{action.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, padding: 8, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px #0001' }}>
        {history.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{
              background: msg.role === 'user' ? '#6cf' : '#e0e7ff',
              color: msg.role === 'user' ? '#fff' : '#222',
              borderRadius: 16,
              padding: '8px 16px',
              maxWidth: '70%',
              boxShadow: '0 1px 4px #0001',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              fontWeight: 500
            }}>{msg.message}</div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{msg.role === 'user' ? 'You' : 'AI'} • {new Date(msg.created_at).toLocaleTimeString()}</div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label htmlFor="model-select">AI Model: </label>
        <select id="model-select" value={model} onChange={e => setModel(e.target.value as any)} style={{ borderRadius: 6, padding: '4px 8px', marginLeft: 8 }}>
          <option value="openai" disabled={aiAvailable ? !aiAvailable.openai : false}>OpenAI GPT-4o</option>
          <option value="gemini" disabled={aiAvailable ? !aiAvailable.gemini : false}>Gemini 1.5 Flash</option>
          <option value="claude" disabled={aiAvailable ? !aiAvailable.claude : false}>Claude 3 Sonnet</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Ask the AI..."
          rows={2}
          style={{ flex: 1, borderRadius: 8, border: '1px solid #ccc', padding: 8, fontFamily: 'inherit', resize: 'none' }}
          disabled={loading || !!noAIConfigured}
        />
        <button onClick={handleSend} disabled={loading || !prompt || !!noAIConfigured} style={{ borderRadius: 8, background: '#6cf', color: '#222', fontWeight: 700, padding: '8px 16px', minWidth: 80 }}>{loading ? '...' : 'Send'}</button>
      </div>
    </div>
  );
};

export default Chat; 