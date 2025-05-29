import React, { useEffect, useState } from 'react';
import { runSSHCommand } from '../api/ssh';
import axios from 'axios';

interface TerminalEntry {
  command: string;
  output: string;
  created_at: string;
}

interface TerminalProps {
  serverId: number;
  initialHistory?: TerminalEntry[];
  quickCommand?: string | null;
  onQuickCommandUsed?: () => void;
  panelHeight?: number;
  onGeminiSuggestion?: (suggestion: any) => void;
}

const Terminal: React.FC<TerminalProps> = ({ serverId, initialHistory = [], quickCommand, onQuickCommandUsed, panelHeight = 400, onGeminiSuggestion }) => {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<TerminalEntry[]>(initialHistory);
  const [loading, setLoading] = useState(false);

  const handleRun = async (cmd?: string) => {
    const toRun = cmd ?? command;
    if (!toRun) return;
    setLoading(true);
    try {
      const res = await runSSHCommand(serverId, toRun);
      const entry = { command: toRun, output: res.output, created_at: new Date().toISOString() };
      setHistory([...history, entry]);
      setCommand('');
      // Call Gemini suggestion endpoint with last 3 terminal entries
      if (res.output && typeof onGeminiSuggestion === 'function') {
        try {
          const baseUrl = window.location.origin.includes('localhost') ? 'http://localhost:4000' : window.location.origin;
          // Get last 2 from history, plus the new one
          const last2 = history.slice(-2);
          const entries = [...last2, { command: toRun, output: res.output }];
          const suggestRes = await axios.post(baseUrl + '/api/ai/terminal-suggest', { entries, latestCommand: toRun });
          if (suggestRes.data && suggestRes.data.response) {
            onGeminiSuggestion(suggestRes.data);
          }
        } catch (err) {
          // Ignore Gemini errors for now
        }
      }
    } catch (e: any) {
      setHistory([...history, { command: toRun, output: e.message, created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // Run quickCommand if provided
  useEffect(() => {
    if (quickCommand) {
      handleRun(quickCommand);
      if (onQuickCommandUsed) onQuickCommandUsed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickCommand]);

  const handleClearTerminal = () => {
    setHistory([]);
  };

  return (
    <div style={{ background: '#181818', color: '#e0e0e0', borderRadius: 12, padding: 16, fontFamily: 'monospace', minHeight: 320, boxShadow: '0 2px 8px #0002', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button onClick={handleClearTerminal} style={{ borderRadius: 6, background: '#fff', color: '#e53e3e', fontWeight: 700, border: '1px solid #e53e3e', padding: '4px 12px', fontSize: 13, boxShadow: '0 1px 4px #0001' }}>Clear Terminal</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, maxHeight: panelHeight }}>
        {history.map((h, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div><span style={{ color: '#6cf' }}>$ {h.command}</span></div>
            <div style={{ whiteSpace: 'pre-wrap', color: '#b5e853' }}>{h.output}</div>
            <div style={{ fontSize: 10, color: '#888' }}>{new Date(h.created_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1, borderRadius: 6, border: '1px solid #333', background: '#222', color: '#fff', padding: '8px 12px', fontFamily: 'monospace' }}
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="Enter command..."
          onKeyDown={e => { if (e.key === 'Enter') handleRun(); }}
          disabled={loading}
        />
        <button style={{ borderRadius: 6, background: '#6cf', color: '#222', fontWeight: 700, padding: '8px 16px' }} onClick={() => handleRun()} disabled={loading}>{loading ? '...' : 'Run'}</button>
      </div>
    </div>
  );
};

export default Terminal; 