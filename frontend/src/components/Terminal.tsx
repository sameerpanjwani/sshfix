import React, { useEffect, useState, useRef } from 'react';
import { runSSHCommand } from '../api/ssh';
import axios from 'axios';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

// Add API base URL constant at the top
const API_BASE = window.location.origin.includes('localhost') 
  ? 'http://localhost:4000/api'
  : '/api';

interface TerminalEntry {
  command: string;
  output: string;
  created_at: string;
  chat_session_id?: string | null;
}

interface TerminalProps {
  serverId: number;
  initialHistory?: TerminalEntry[];
  quickCommand?: string | null;
  onQuickCommandUsed?: () => void;
  panelHeight?: number;
  onGeminiSuggestion?: (suggestion: any) => void;
  onHistoryUpdate?: (history: TerminalEntry[]) => void;
  clearSignal?: number;
  sessionId?: string | null;
}

const InteractiveTerminal: React.FC<TerminalProps> = ({ serverId, quickCommand, onQuickCommandUsed, panelHeight = 400, onHistoryUpdate, clearSignal, sessionId }) => {
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<TerminalEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastQuickCommandRef = useRef<string | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const wsReadyRef = useRef(false);
  const lastForcedHistoryCommandRef = useRef<string | null>(null);

  // Add click handler to ensure terminal focus
  const handleContainerClick = () => {
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  useEffect(() => {
    if (clearSignal && clearSignal > 0 && xtermRef.current) {
      xtermRef.current.clear();
    }
  }, [clearSignal]);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#181818',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
        black: '#000000',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#d19a66',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#d19a66',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff'
      },
      rows: 24,
      cols: 80,
      convertEol: true,
      cursorStyle: 'block',
      scrollback: 1000,
      allowTransparency: true
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    xtermRef.current = term;
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      term.open(containerRef.current);
      fitAddon.fit();
      term.focus();
      resizeObserver = new window.ResizeObserver(() => {
        if (xtermRef.current && xtermRef.current.core) {
          try {
            fitAddon.fit();
            term.focus();
          } catch (e) {
            console.error("Error during fitAddon.fit() in ResizeObserver:", e);
          }
        }
      });
      resizeObserver.observe(containerRef.current);
    }

    term.write('\x1b[33m[Connecting to SSH...]\x1b[0m\r\n');
    
    // Fix WebSocket URL for dev/prod
    const wsUrl = import.meta.env.MODE === 'development'
      ? `ws://localhost:4000/ws/terminal?serverId=${serverId}`
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/terminal?serverId=${serverId}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    wsReadyRef.current = false;
    let commandBuffer = '';
    let outputBuffer = '';
    const outputMap = new Map<string, string>();
    const currentCommand = { value: '' };

    ws.onopen = () => {
      wsReadyRef.current = true;
      term.write('\x1b[32m[Connected to SSH]\x1b[0m\r\n');
      term.scrollToBottom();
      
      // If there is a pending quick command, send it now
      if (pendingCommandRef.current) {
        const cmd = pendingCommandRef.current;
        term.write(cmd);
        term.write('\r\n');
        ws.send(cmd + '\n');
        lastQuickCommandRef.current = cmd;
        if (typeof onQuickCommandUsed === 'function') onQuickCommandUsed();
        pendingCommandRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      const data = event.data;
      term.write(data);
      outputBuffer += data;
      
      // Update output map for current command
      if (currentCommand.value) {
        outputMap.set(currentCommand.value, (outputMap.get(currentCommand.value) || '') + data);
      }
      
      const lines = outputBuffer.split(/\r?\n/);
      const lastLine = lines[lines.length - 1];
      
      const promptPatterns = [
        /[$#%>] ?$/,
        />\s*$/,
        /\]\$\s*$/,
        /\]#\s*$/,
        /❯\s*$/,
        /➜\s*$/,
        /PS [^>]*>\s*$/,  // Windows PowerShell prompt
        /^[A-Z]:\\.*>\s*$/  // Windows cmd.exe prompt
      ];
      
      const hasPrompt = promptPatterns.some(pattern => pattern.test(lastLine));
      
      if (hasPrompt && commandBuffer.trim()) {
        const cleanCommand = commandBuffer.trim().replace(/[\r\n]+$/, '');
        
        if (cleanCommand && cleanCommand.length > 0) {
          const commandOutput = outputMap.get(cleanCommand) || outputBuffer;
          
          // Create new history entry with session ID
          const newEntry = { 
            command: cleanCommand, 
            output: commandOutput, 
            created_at: new Date().toISOString(),
            chat_session_id: sessionId
          };
          
          historyRef.current = [...historyRef.current, newEntry];
          
          // Log command to backend
          console.log('[Terminal.tsx] Sending history with session ID:', sessionId);
          
          axios.post(`${API_BASE}/terminal/history-with-suggestion`, {
            serverId,
            command: cleanCommand, 
            output: commandOutput,
            sessionId: sessionId || Date.now().toString()
          })
            .then(response => {
              console.log('[Terminal.tsx] Got response from history-with-suggestion:', {
                historyLength: response.data.history?.length,
                hasSuggestion: !!response.data.suggestion,
                suggestionJson: response.data.suggestion?.json ? 
                  Object.keys(response.data.suggestion.json) : [],
                suggestionResponse: response.data.suggestion?.response ? 
                  response.data.suggestion.response.substring(0, 100) : null
              });
              
              if (typeof onHistoryUpdate === 'function') {
                console.log('[Terminal.tsx] Calling onHistoryUpdate with history+suggestion data');
                onHistoryUpdate(response.data);
              } else {
                console.error('[Terminal.tsx] onHistoryUpdate function is not defined!');
              }
            })
            .catch(error => {
              console.error('[Terminal.tsx] Error in history-with-suggestion:', error);
              
              // Fallback to original history endpoint if new endpoint fails
              axios.post(`${API_BASE}/servers/${serverId}/history`, {
                ...newEntry,
                chat_session_id: sessionId
              })
                .then(() => axios.get(`${API_BASE}/servers/${serverId}/history`))
                .then(response => {
                  if (typeof onHistoryUpdate === 'function') {
                    console.log('[Terminal.tsx] Calling onHistoryUpdate with fallback history data');
                    onHistoryUpdate(response.data);
                  } else {
                    console.error('[Terminal.tsx] onHistoryUpdate function is not defined in fallback!');
                  }
                })
                .catch(err => console.error('[Terminal.tsx] Fallback history update failed:', err));
            });
          
          // Clear command from output map
          outputMap.delete(cleanCommand);
        }
        
        // Reset buffers
        commandBuffer = '';
        outputBuffer = '';
        currentCommand.value = '';
      }
    };

    ws.onclose = () => {
      wsReadyRef.current = false;
      term.write('\r\n\x1b[31m[Disconnected]\x1b[0m\r\n');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      term.write('\r\n\x1b[31m[WebSocket Error]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        commandBuffer += data;
        
        if (data === '\r' || data === '\n') {
          const newCommand = commandBuffer.trim();
          if (newCommand) {
            currentCommand.value = newCommand;
            outputMap.set(newCommand, '');
          }
        }
      } else {
        console.warn('WebSocket not ready, command not sent:', data);
      }
    });

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      term.dispose();
      if (resizeObserver && containerRef.current) {
        resizeObserver.disconnect();
      }
    };
  }, [serverId]);

  // Handle quickCommand from parent
  useEffect(() => {
    if (quickCommand && quickCommand !== lastQuickCommandRef.current) {
      if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
        const cmd = quickCommand + '\n';
        xtermRef.current.write(cmd);
        wsRef.current.send(cmd);
        lastQuickCommandRef.current = quickCommand;
        if (typeof onQuickCommandUsed === 'function') onQuickCommandUsed();
        
        // Log command immediately
        axios.post(`${API_BASE}/servers/${serverId}/history`, { 
          command: quickCommand, 
          output: '',
          chat_session_id: sessionId 
        }).catch(err => {
          console.error('[Terminal.tsx] Error logging quick command:', err);
        });
      } else {
        pendingCommandRef.current = quickCommand;
      }
    }
  }, [quickCommand, serverId, sessionId]);

  return (
    <div 
      ref={containerRef} 
      id="xterm-container" 
      style={{ 
        width: '100%', 
        height: '100%', 
        background: '#181818', 
        borderRadius: 12, 
        overflow: 'hidden',
        padding: '0 16px',
        textAlign: 'left'
      }}
      onClick={handleContainerClick}
      onFocus={() => xtermRef.current?.focus()}
      tabIndex={-1}
    />
  );
};

export default InteractiveTerminal; 