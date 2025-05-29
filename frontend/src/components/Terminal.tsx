import React, { useEffect, useState, useRef } from 'react';
import { runSSHCommand } from '../api/ssh';
import axios from 'axios';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

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
  onHistoryUpdate?: (history: TerminalEntry[]) => void;
}

const InteractiveTerminal: React.FC<TerminalProps> = ({ serverId, quickCommand, onQuickCommandUsed, panelHeight = 400, onHistoryUpdate }) => {
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const historyRef = useRef<TerminalEntry[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastQuickCommandRef = useRef<string | null>(null);
  const pendingCommandRef = useRef<string | null>(null);
  const wsReadyRef = useRef(false);

  useEffect(() => {
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 15,
      theme: { background: '#181818', foreground: '#e0e0e0' },
      rows: 24,
      cols: 80
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    xtermRef.current = term;
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      term.open(containerRef.current);
      fitAddon.fit();
      term.focus();
      // Add resize observer to fit terminal on container resize
      resizeObserver = new window.ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);
    }
    // Show connecting message
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
    ws.onopen = () => {
      wsReadyRef.current = true;
      term.write('\x1b[32m[Connected to SSH]\x1b[0m\r\n');
      term.scrollToBottom();
      // If there is a pending quick command, send it now
      if (pendingCommandRef.current) {
        term.write(pendingCommandRef.current + '\r');
        ws.send(pendingCommandRef.current + '\n');
        lastQuickCommandRef.current = pendingCommandRef.current;
        if (typeof onQuickCommandUsed === 'function') onQuickCommandUsed();
        pendingCommandRef.current = null;
      }
    };
    ws.onmessage = (event) => {
      const data = event.data;
      term.write(data);
      term.scrollToBottom();
      outputBuffer += data;
      
      // Improved heuristic: detect command completion
      const lines = outputBuffer.split(/\r?\n/);
      const lastLine = lines[lines.length - 1];
      
      // Look for common shell prompts (more patterns)
      const promptPatterns = [
        /[$#%>] ?$/,           // Common Unix/Linux prompts
        />\s*$/,               // Windows prompt
        /\]\$\s*$/,            // Bash with brackets
        /\]#\s*$/,             // Root with brackets
        /❯\s*$/,               // Modern shells (zsh, fish)
        /➜\s*$/,               // Another modern prompt
      ];
      
      const hasPrompt = promptPatterns.some(pattern => pattern.test(lastLine));
      
      // Also check if output has been idle for a bit (backup detection)
      if (hasPrompt && commandBuffer.trim()) {
        // Clean up the command (remove trailing newlines/returns)
        const cleanCommand = commandBuffer.trim().replace(/[\r\n]+$/, '');
        
        // Only log if we have a meaningful command
        if (cleanCommand && cleanCommand.length > 0) {
          const entry = { 
            command: cleanCommand, 
            output: outputBuffer.trim(), 
            created_at: new Date().toISOString() 
          };
          
          historyRef.current = [...historyRef.current, entry];
          if (typeof onHistoryUpdate === 'function') onHistoryUpdate(historyRef.current);
          
          // Also send to backend to ensure it's persisted
          try {
            fetch(`http://localhost:4000/api/servers/${serverId}/history`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ command: cleanCommand, output: outputBuffer.trim() })
            });
          } catch (e) {
            console.error('Failed to log command to backend:', e);
          }
        }
        
        commandBuffer = '';
        outputBuffer = '';
      }
    };
    ws.onclose = () => {
      wsReadyRef.current = false;
      term.write('\r\n\x1b[31m[Disconnected]\x1b[0m\r\n');
      term.scrollToBottom();
    };
    // Send user input to backend only if WebSocket is open
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        commandBuffer += data;
      }
    });
    return () => {
      ws.close();
      term.dispose();
      // Clean up resize observer
      if (resizeObserver && containerRef.current) {
        resizeObserver.disconnect();
      }
    };
  }, [serverId]); // Only re-run when serverId changes

  // Handle quickCommand from parent (e.g., chat quick actions)
  useEffect(() => {
    if (
      quickCommand &&
      quickCommand !== lastQuickCommandRef.current
    ) {
      if (wsRef.current && wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN && xtermRef.current) {
        // Write the command to the terminal and send to backend
        xtermRef.current.write(quickCommand + '\r');
        wsRef.current.send(quickCommand + '\n');
        lastQuickCommandRef.current = quickCommand;
        if (typeof onQuickCommandUsed === 'function') onQuickCommandUsed();
      } else {
        // Queue the command to be sent when ws is ready
        pendingCommandRef.current = quickCommand;
      }
    }
  }, [quickCommand, onQuickCommandUsed]);

  return <div ref={containerRef} id="xterm-container" style={{ width: '100%', height: '100%', background: '#181818', borderRadius: 12, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} />;
};

export default InteractiveTerminal; 