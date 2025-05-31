import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAISuggestion, getAIAvailability, uploadImages, editAISuggestion } from '../api/ai';
import { getChatHistory, addChatMessage, getChatSessions } from '../api/servers';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

// Define ChatMessage interface including ai_request_context
interface ChatMessage {
  id?: number;
  role: 'user' | 'ai' | 'system' | 'gemini-suggest';
  message: string;
  created_at: string;
  model?: string; // For AI messages, to show which model responded
  isGeminiSuggestion?: boolean;
  json?: any; // Parsed JSON from AI response
  ai_request_context?: string; // Full context sent to AI
  imageUrls?: string[]; // URLs of images associated with the user message for easier re-edit
}

const quickActions = [
  { label: 'List all files', value: 'ls -al' },
  { label: 'Find root folder', value: 'cd / && ls' },
  { label: 'Show running processes', value: 'ps aux' },
  { label: 'Check disk usage', value: 'df -h' },
];

interface ChatProps {
  onQuickCommand?: (command: string) => void;
  panelHeight?: number;
  serverId: number;
  model: 'openai' | 'gemini' | 'gemini-pro' | 'claude';
  setModel: (m: 'openai' | 'gemini' | 'gemini-pro' | 'claude') => void;
  sendToTerminal?: (cmd: string) => void;
  geminiSuggestions?: any[];
  getLastTerminalEntries?: () => any[];
  setGeminiSuggestions: (s: any[]) => void;
  currentChatSessionId?: string | null;
  onStartNewSession?: () => void;
}

const Chat: React.FC<ChatProps> = ({ onQuickCommand, panelHeight = 400, serverId, model, setModel, sendToTerminal, geminiSuggestions = [], getLastTerminalEntries, setGeminiSuggestions, currentChatSessionId, onStartNewSession }) => {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAIAvailable] = useState<{openai: boolean, gemini: boolean, claude: boolean} | null>(null);
  const [withTerminalContext, setWithTerminalContext] = useState(true);
  const [estimatedTokens, setEstimatedTokens] = useState<number | null>(null);
  const [newSession, setNewSession] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [editImages, setEditImages] = useState<File[]>([]);
  const [editImagePreviews, setEditImagePreviews] = useState<string[]>([]);
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);
  const [contextToShow, setContextToShow] = useState<string | null>(null);
  const [showExplanationModal, setShowExplanationModal] = useState(false);
  const [explanationToShow, setExplanationToShow] = useState('');
  const [explanationTitle, setExplanationTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAIAvailability().then(setAIAvailable);
  }, []);

  useEffect(() => {
    if (serverId && currentChatSessionId) {
      setLoading(true);
      setHistory([]); // Clear previous session's history before loading new one
      getChatHistory(serverId, currentChatSessionId)
        .then(data => {
          setHistory(data || []); 
          setLoading(false);
        })
        .catch(err => {
          console.error(`Failed to load chat history for session ${currentChatSessionId}:`, err);
          setHistory([]); // Ensure history is clear on error
          setLoading(false);
        });
    } else {
      setHistory([]); // Clear history if no serverId or sessionId, or if session ID is null
    }
  }, [serverId, currentChatSessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Handle image selection
  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 5 - images.length);
    if (arr.length === 0) return;
    setImages(prev => [...prev, ...arr].slice(0, 5));
  };

  // Generate previews
  useEffect(() => {
    if (images.length === 0) {
      setImagePreviews([]);
      return;
    }
    Promise.all(images.map(f => {
      return new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string);
        reader.readAsDataURL(f);
      });
    })).then(setImagePreviews);
  }, [images]);

  // Drag-and-drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file && file.type.startsWith('image/')) files.push(file);
      }
    }
    if (files.length) handleFiles(files);
  };

  const handleRemoveImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  // Utility to ensure image URL is correct
  const ensureUploadUrl = (url: string) => url.startsWith('/uploads/') ? url : `/uploads/${url.replace(/^.*[\\/]/, '')}`;

  const handleSend = async () => {
    if ((!prompt.trim() && images.length === 0) || !serverId || !currentChatSessionId) return;
    setLoading(true);
    
    let uploadedImageUrls: string[] = [];
    if (images.length > 0) {
      try {
        uploadedImageUrls = await uploadImages(images);
      } catch (e) {
        setLoading(false);
        alert('Image upload failed.');
        return;
      }
    }
    
    const userMessageContent = prompt;
    // Construct user message for optimistic UI update
    const optimisticUserMessage: ChatMessage = {
      // No ID yet, will get it after history refresh
      role: 'user',
      message: userMessageContent,
      created_at: new Date().toISOString(),
      imageUrls: uploadedImageUrls.map(ensureUploadUrl) 
    };
    setHistory(prev => [...prev, optimisticUserMessage]);
    
    // Clear input fields immediately
    setPrompt('');
    setImages([]);
    setImagePreviews([]);
    
    try {
      // Backend will save the user message and AI response with the chatSessionId
      const res = await getAISuggestion(
        userMessageContent, 
        model,
        serverId, 
        currentChatSessionId, // Pass currentChatSessionId
        withTerminalContext, 
        false, // newSession flag is deprecated here, session is managed by ID
        uploadedImageUrls, 
        false, // edit flag
        undefined // messageId for edit
      );

      // After AI response, refresh the entire chat history for the current session
      // This ensures we get all messages with correct IDs and ai_request_context
      if (serverId && currentChatSessionId) {
        const updatedHistory = await getChatHistory(serverId, currentChatSessionId);
        setHistory(updatedHistory || []);
        // Try to find the estimatedTokens from the last AI message if backend provides it
        const lastAiMsg = updatedHistory.findLast((m: ChatMessage) => m.role === 'ai');
        if (lastAiMsg && typeof (lastAiMsg as any).estimatedTokens === 'number') {
          setEstimatedTokens((lastAiMsg as any).estimatedTokens);
        } else {
          setEstimatedTokens(null);
        }
      }
    } catch (e: any) {
      let errorMsg = e?.response?.data?.error || e.message || 'Unknown error';
      const tip = e?.response?.status === 500 ? '\nAI service failed. Check API keys, backend logs, network.' : '';
      const aiErrorResponse: ChatMessage = {
        role: 'ai',
        message: errorMsg + tip,
        created_at: new Date().toISOString(),
      };
      // If AI call fails, ensure the optimistic user message is still in history, then add error.
      // This replaces the optimistic message with itself if it's still the last one, then adds error.
      setHistory(prev => prev.map(m => m === optimisticUserMessage ? optimisticUserMessage : m).concat([aiErrorResponse]));
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

  const handleNewSessionClick = () => {
    if (onStartNewSession) {
      onStartNewSession(); // This will trigger a change in currentChatSessionId prop
      // The useEffect for [serverId, currentChatSessionId] will then clear and fetch history.
      setEstimatedTokens(null);
      setGeminiSuggestions([]); 
      setPrompt('');
      setImages([]);
      setImagePreviews([]);
    }
  };

  const noAIConfigured = aiAvailable && !aiAvailable.openai && !aiAvailable.gemini && !aiAvailable.claude;

  const startEdit = (msg: any, idx: number) => {
    setEditingMsgId(msg.id);
    // Remove markdown image links from prompt for editing
    const text = msg.message.replace(/!\[image\]\([^)]*\)/g, '').trim();
    setEditPrompt(text);
    // Extract image URLs from markdown
    const urls = (msg.message.match(/!\[image\]\(([^)]*)\)/g) || []).map((m: string) => ensureUploadUrl(m.match(/!\[image\]\(([^)]*)\)/)?.[1] || '')).filter(Boolean) as string[];
    setEditImageUrls(urls);
    setEditImages([]);
    setEditImagePreviews([]);
  };

  const cancelEdit = () => {
    setEditingMsgId(null);
    setEditPrompt('');
    setEditImages([]);
    setEditImagePreviews([]);
    setEditImageUrls([]);
  };

  const handleEditFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, 5 - editImages.length - editImageUrls.length);
    if (arr.length === 0) return;
    setEditImages(prev => [...prev, ...arr].slice(0, 5 - editImageUrls.length));
  };

  useEffect(() => {
    if (editImages.length === 0) {
      setEditImagePreviews([]);
      return;
    }
    Promise.all(editImages.map(f => {
      return new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string);
        reader.readAsDataURL(f);
      });
    })).then(setEditImagePreviews);
  }, [editImages]);

  const handleRemoveEditImage = (idx: number, isUrl = false) => {
    if (isUrl) {
      setEditImageUrls(prev => prev.filter((_, i) => i !== idx));
    } else {
      setEditImages(prev => prev.filter((_, i) => i !== idx));
    }
  };

  const handleEditSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingMsgId || !serverId || !currentChatSessionId) return;
    if (!editPrompt.trim() && editImages.length === 0 && editImageUrls.length === 0) {
      alert("Cannot save an empty message.");
      return;
    }
    setLoading(true);
    let uploadedEditImageUrls: string[] = [];
    if (editImages.length > 0) {
      try {
        uploadedEditImageUrls = await uploadImages(editImages);
      } catch (err) {
        alert('Image upload failed during edit.');
        setLoading(false);
        return;
      }
    }
    const finalImageUrlsForEdit = [...editImageUrls, ...uploadedEditImageUrls];
    const messageContentForEdit = editPrompt;
    try {
      await editAISuggestion(
        messageContentForEdit,
        model,
        serverId,
        currentChatSessionId, // Pass currentChatSessionId
        editingMsgId,
        finalImageUrlsForEdit
      );
      // After successful edit, refresh chat history for the current session
      if (serverId && currentChatSessionId) {
        const updatedHistory = await getChatHistory(serverId, currentChatSessionId);
        setHistory(updatedHistory || []);
        const lastAiMsg = updatedHistory.findLast((m: ChatMessage) => m.role === 'ai');
        if (lastAiMsg && typeof (lastAiMsg as any).estimatedTokens === 'number') {
          setEstimatedTokens((lastAiMsg as any).estimatedTokens);
        } else {
          setEstimatedTokens(null);
        }
      }
    } catch (err: any) {
      let errorMsg = err?.response?.data?.error || err.message || 'Unknown error';
      alert(`Error saving edit: ${errorMsg}`);
    }
    setEditingMsgId(null);
    setEditPrompt('');
    setEditImages([]);
    setEditImagePreviews([]);
    setEditImageUrls([]);
    setLoading(false);
  };

  // Function to show context modal
  const showAiContext = (context: string | undefined) => {
    if (context) {
      try {
        // Attempt to parse and pretty-print if it's JSON
        const parsedContext = JSON.parse(context);
        setContextToShow(JSON.stringify(parsedContext, null, 2));
      } catch (e) {
        // If not JSON, show as is
        setContextToShow(context);
      }
      setShowContextModal(true);
    }
  };

  function parseAIResponse(msg: string, json: any): { answer: string, commands: string[] } {
    if (json && typeof json === 'object' && (json.answer || json.commands)) {
      return { answer: json.answer || '', commands: json.commands || [] };
    }
    // Try to parse as JSON if not already
    try {
      const parsed = JSON.parse(msg);
      if (parsed && (parsed.answer || parsed.commands)) {
        return { answer: parsed.answer || '', commands: parsed.commands || [] };
      }
    } catch {}
    // Fallback: treat as plain text
    return { answer: msg, commands: [] };
  }

  // Add handler for command click
  const handleCommandClick = (cmd: string) => {
    if (typeof sendToTerminal === 'function') {
      sendToTerminal(cmd);
    } else {
      alert('Send to terminal: ' + cmd);
    }
  };

  // Handler for alternative suggestion
  async function handleAlternativeSuggestion() {
    // Get the last Gemini suggestion and last 3 terminal entries
    const lastSuggestion = geminiSuggestions[geminiSuggestions.length - 1];
    if (!lastSuggestion || !getLastTerminalEntries) return;
    const entries = getLastTerminalEntries();
    // Call backend for alternative suggestion
    const baseUrl = window.location.origin.includes('localhost') ? 'http://localhost:4000' : window.location.origin;
    const res = await fetch(baseUrl + '/api/terminal/suggest-alt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries, previousSuggestion: lastSuggestion })
    });
    const data = await res.json();
    setGeminiSuggestions(geminiSuggestions.map((s, i) => i === geminiSuggestions.length - 1 ? { ...s, altSuggestion: data.json || { answer: data.response, commands: [] } } : s));
  }

  const handleOpenHistoryModal = async () => {
    setShowHistoryModal(true);
    setLoadingSessions(true);
    try {
      const sessions = await getChatSessions(serverId);
      setChatSessions(sessions);
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleLoadSession = async (session: any) => {
    setLoading(true);
    setShowHistoryModal(false);
    const hist = await getChatHistory(serverId, session.date);
    setHistory(hist);
    setPrompt('');
    setEstimatedTokens(null);
    setGeminiSuggestions([]);
    setLoading(false);
  };

  // Add formatContextForDisplay function
  const formatContextForDisplay = (context: string): string => {
    try {
      // First try to parse as JSON
      const parsed = JSON.parse(context);
      
      // If it's an array of messages (AI context)
      if (Array.isArray(parsed)) {
        return parsed.map(msg => {
          if (msg.role === 'system') {
            return `System:\n${msg.content}\n`;
          } else if (msg.role === 'user') {
            return `User:\n${msg.content}\n`;
          } else if (msg.role === 'ai' || msg.role === 'assistant') {
            return `AI:\n${msg.content}\n`;
          }
          return `${msg.role}:\n${msg.content}\n`;
        }).join('\n');
      }
      
      // If it's a Gemini prompt object
      if (parsed.contents) {
        return parsed.contents.map((content: any) => {
          const text = content.parts?.map((part: any) => part.text).filter(Boolean).join('\n') || '';
          return `${content.role === 'model' ? 'AI' : 'User'}:\n${text}\n`;
        }).join('\n');
      }
      
      // If it's some other JSON structure, pretty print it
      return JSON.stringify(parsed, null, 2);
    } catch {
      // If not JSON, try to format as terminal history
      const lines = context.split('\n');
      let formattedContext = '';
      let currentCommand = '';
      
      for (const line of lines) {
        if (line.startsWith('$ ')) {
          if (currentCommand) formattedContext += '\n';
          currentCommand = line.substring(2);
          formattedContext += `Command: ${currentCommand}\n`;
        } else if (line.includes('Output:') || line.includes('Error Output:')) {
          formattedContext += line + '\n';
        } else if (line.trim()) {
          formattedContext += '  ' + line + '\n';
        }
      }
      
      return formattedContext || context;
    }
  };

  return (
    <div
      style={{ background: '#f5f7fa', borderRadius: 12, padding: 16, minHeight: 320, boxShadow: '0 2px 8px #0001', display: 'flex', flexDirection: 'column', height: '100%' }}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onPaste={handlePaste}
    >
      {noAIConfigured && (
        <div style={{ background: '#fff3cd', color: '#856404', borderRadius: 8, padding: 12, marginBottom: 12, border: '1px solid #ffeeba', fontWeight: 500 }}>
          ⚠️ No AI API keys configured on the backend. AI features will not work.
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <button onClick={handleNewSessionClick} style={{ borderRadius: 8, background: '#fff', color: '#6cf', fontWeight: 700, border: '1px solid #6cf', padding: '6px 16px', fontSize: 14, boxShadow: '0 1px 4px #0001' }} disabled={loading}>New Chat Session</button>
        <button onClick={handleOpenHistoryModal} style={{ borderRadius: 8, background: '#fff', color: '#2563eb', fontWeight: 700, border: '1px solid #2563eb', padding: '6px 16px', fontSize: 14, boxShadow: '0 1px 4px #0001' }} disabled={loading}>Load Chat History</button>
        {estimatedTokens !== null && (
          <div style={{ position: 'absolute', top: 16, right: 24, color: '#888', fontSize: 13, fontWeight: 500, zIndex: 2 }}>
            <span>Estimated tokens: {typeof estimatedTokens === 'number' ? estimatedTokens : 0}</span>
          </div>
        )}
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {quickActions.map((action, i) => (
          <button key={i} style={{ borderRadius: 6, background: '#e0e7ff', color: '#222', fontWeight: 500, border: 'none', padding: '6px 12px', cursor: 'pointer' }} onClick={() => handleQuickAction(action.value)}>{action.label}</button>
        ))}
      </div>
      {/* Gemini Suggestions Tab Section */}
      {geminiSuggestions.length > 0 && (
        <div style={{ marginBottom: 16, background: '#f0f4ff', borderRadius: 10, boxShadow: '0 1px 4px #0001', padding: 12, border: '1px solid #b6d0ff', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, color: '#2563eb', fontSize: 16 }}>Gemini Suggestions</div>
            <span style={{ fontSize: 13, color: '#2563eb', background: '#f8fafc', borderRadius: 6, padding: '2px 10px', zIndex: 2, cursor: 'pointer', textDecoration: 'underline' }} onClick={handleAlternativeSuggestion}>Alternative suggestion</span>
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {geminiSuggestions.slice(-3).reverse().map((s, idx) => {
              const answer = s.json?.answer || s.response || '';
              const commands: string[] = s.json?.commands || [];
              const explanations: string[] = s.json?.explanations || [];
              return (
                <div key={idx} style={{ marginBottom: 12, background: '#fff', borderRadius: 8, padding: 10, boxShadow: '0 1px 2px #0001', border: '1px solid #e0e7ff', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ color: '#222', marginBottom: 4 }}>{answer}</div>
                    {/* (i) icon for Gemini suggestion context */}
                    {s.prompt && (
                      <span
                        style={{ cursor: 'pointer', color: '#6366f1', marginLeft: 8, fontSize: 18 }}
                        title="View full context sent to Gemini"
                        onClick={() => {
                          const formattedContext = formatContextForDisplay(s.prompt);
                          setContextToShow(formattedContext);
                          setShowContextModal(true);
                        }}
                      >
                        i
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    {commands.map((cmd, cmdIdx) => (
                      <div key={cmdIdx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          onClick={() => handleCommandClick(cmd)}
                          style={{
                            flex: 1,
                            padding: '4px 8px',
                            border: '1px solid #e0e7ff',
                            borderRadius: 4,
                            background: '#f5f3ff',
                            color: '#4f46e5',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'monospace'
                          }}
                        >
                          {cmd}
                        </button>
                        {explanations[cmdIdx] && (
                          <button
                            onClick={() => {
                              setExplanationTitle(cmd);
                              setExplanationToShow(explanations[cmdIdx]);
                              setShowExplanationModal(true);
                            }}
                            style={{
                              border: 'none',
                              background: 'none',
                              color: '#6366f1',
                              cursor: 'pointer',
                              padding: '4px',
                              borderRadius: '50%',
                              width: 24,
                              height: 24,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 14
                            }}
                            title="View command explanation"
                          >
                            ?
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
                    Gemini Flash • {new Date(s.created_at || Date.now()).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, padding: 8, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px #0001', maxHeight: panelHeight }}>
        {history.map((msg, i) => {
          const isAI = msg.role === 'ai';
          let answer = msg.message;
          let commands: string[] = [];
          let explanations: string[] = [];
          
          if (isAI && msg.json !== undefined) {
            // If we store json in history, use it
            answer = msg.json.answer || msg.message;
            commands = msg.json.commands || [];
            explanations = msg.json.explanations || [];
          } else if (isAI) {
            try {
              const parsed = JSON.parse(msg.message);
              answer = parsed.answer || msg.message;
              commands = parsed.commands || [];
              explanations = parsed.explanations || [];
            } catch {
              answer = msg.message;
              commands = [];
              explanations = [];
            }
          }

          return (
            <div key={msg.id || i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10, opacity: msg.isGeminiSuggestion ? 0.95 : 1 }}>
              <div style={{ 
                maxWidth: '85%', 
                padding: '8px 12px', 
                borderRadius: 12,
                background: msg.role === 'user' ? '#6366f1' : '#f3f4f6',
                color: msg.role === 'user' ? '#fff' : '#111',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {answer}
                {isAI && commands.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {commands.map((cmd, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                        <button
                          onClick={() => handleCommandClick(cmd)}
                          style={{
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: 6,
                            padding: '4px 8px',
                            cursor: 'pointer',
                            color: '#111',
                            fontFamily: 'monospace',
                            fontSize: '0.9em',
                            marginRight: 8,
                            flex: 1
                          }}
                        >
                          {cmd}
                        </button>
                        {explanations[idx] && (
                          <span
                            style={{ cursor: 'pointer', color: '#6366f1', marginLeft: 4, fontSize: 18 }}
                            title="View command explanation"
                            onClick={() => {
                              setExplanationTitle(cmd);
                              setExplanationToShow(explanations[idx]);
                              setShowExplanationModal(true);
                            }}
                          >
                            ?
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                {msg.role === 'user'
                  ? 'You'
                  : msg.model === 'gemini' || msg.isGeminiSuggestion
                    ? 'Gemini AI'
                    : `${model === 'openai' ? 'OpenAI' : model === 'gemini' ? 'Gemini' : model === 'gemini-pro' ? 'Gemini Pro' : model === 'claude' ? 'Claude' : 'AI'} AI`}
                {' • ' + new Date(msg.created_at).toLocaleString()}
                {msg.role === 'ai' && msg.ai_request_context && (
                  <span 
                    onClick={() => showAiContext(msg.ai_request_context)}
                    style={{ cursor: 'pointer', marginLeft: 8, fontWeight: 'bold', color: '#007bff' }} 
                    title="View AI Prompt Context"
                  >
                    (i)
                  </span>
                )}
              </div>
              {editingMsgId === msg.id && (
                <form onSubmit={handleEditSubmit} style={{ marginTop: 8, background: '#f0f4ff', borderRadius: 8, padding: 12, boxShadow: '0 1px 4px #0001' }}>
                  <textarea value={editPrompt} onChange={e => setEditPrompt(e.target.value)} rows={2} style={{ width: '100%', borderRadius: 8, border: '1px solid #ccc', padding: 8, fontFamily: 'inherit', resize: 'none' }} placeholder="Edit your message..." title="Edit your message" />
                  <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
                    {editImageUrls.map((url, idx) => (
                      <div key={url} style={{ position: 'relative' }}>
                        <img src={ensureUploadUrl(url)} alt="old attachment" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }} onClick={() => setModalImage(url)} />
                        <button type="button" onClick={() => handleRemoveEditImage(idx, true)} style={{ position: 'absolute', top: -8, right: -8, background: '#fff', border: '1px solid #e53e3e', color: '#e53e3e', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer' }}>×</button>
                      </div>
                    ))}
                    {editImagePreviews.map((src, idx) => (
                      <div key={src} style={{ position: 'relative' }}>
                        <img src={src} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }} onClick={() => setModalImage(src)} />
                        <button type="button" onClick={() => handleRemoveEditImage(idx, false)} style={{ position: 'absolute', top: -8, right: -8, background: '#fff', border: '1px solid #e53e3e', color: '#e53e3e', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer' }}>×</button>
                      </div>
                    ))}
                  </div>
                  <input type="file" accept="image/*" multiple style={{ display: 'none' }} id="edit-attach" onChange={e => e.target.files && handleEditFiles(e.target.files)} title="Attach images for edit" />
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button type="button" onClick={() => document.getElementById('edit-attach')?.click()} style={{ borderRadius: 8, background: '#e0e7ff', color: '#222', fontWeight: 700, padding: '6px 12px', minWidth: 0 }}>📎</button>
                    <button type="submit" style={{ borderRadius: 8, background: '#6cf', color: '#222', fontWeight: 700, padding: '6px 16px', minWidth: 80 }}>Save</button>
                    <button type="button" onClick={cancelEdit} style={{ borderRadius: 8, background: '#fff', color: '#e53e3e', fontWeight: 700, border: '1px solid #e53e3e', padding: '6px 16px', minWidth: 80 }}>Cancel</button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <label htmlFor="model-select">AI Model: </label>
          <select
            id="model-select"
            value={model}
            onChange={e => setModel(e.target.value as 'openai' | 'gemini' | 'gemini-pro' | 'claude')}
            style={{ marginRight: 8 }}
            title="AI Model"
          >
            <option value="openai" disabled={aiAvailable ? !aiAvailable.openai : false}>OpenAI GPT-4o</option>
            <option value="gemini" disabled={aiAvailable ? !aiAvailable.gemini : false}>Gemini Flash 2.5</option>
            <option value="gemini-pro" disabled={aiAvailable ? !aiAvailable.gemini : false}>Gemini 2.5 Pro</option>
            <option value="claude" disabled={aiAvailable ? !aiAvailable.claude : false}>Claude Sonnet 4</option>
          </select>
        </div>
        <span style={{ fontSize: 13, color: '#888', background: '#f8fafc', borderRadius: 6, padding: '2px 10px', zIndex: 2 }}>
          Estimated tokens: {typeof estimatedTokens === 'number' ? estimatedTokens : 0}
        </span>
      </div>
      {imagePreviews.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {imagePreviews.map((src, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={src} alt="preview" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #ccc', cursor: 'pointer' }} onClick={() => setModalImage(src)} />
              <button onClick={() => handleRemoveImage(i)} style={{ position: 'absolute', top: -8, right: -8, background: '#fff', border: '1px solid #e53e3e', color: '#e53e3e', borderRadius: '50%', width: 20, height: 20, fontSize: 12, cursor: 'pointer' }}>×</button>
            </div>
          ))}
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        ref={fileInputRef}
        onChange={e => e.target.files && handleFiles(e.target.files)}
        title="Attach images"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Ask the AI..."
          rows={2}
          style={{ flex: 1, borderRadius: 8, border: '1px solid #ccc', padding: 8, fontFamily: 'inherit', resize: 'none' }}
          disabled={loading || !!noAIConfigured}
        />
        <button onClick={handleSend} disabled={loading || (!prompt && images.length === 0) || !!noAIConfigured} style={{ borderRadius: 8, background: '#6cf', color: '#222', fontWeight: 700, padding: '8px 16px', minWidth: 80 }}>{loading ? '...' : 'Send'}</button>
        <button type="button" onClick={() => fileInputRef.current?.click()} style={{ borderRadius: 8, background: '#e0e7ff', color: '#222', fontWeight: 700, padding: '8px 12px', minWidth: 0 }}>📎</button>
      </div>
      {modalImage && (
        <div onClick={() => setModalImage(null)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
            <img src={modalImage.startsWith('data:') ? modalImage : ensureUploadUrl(modalImage)} alt="full preview" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 12, boxShadow: '0 4px 32px #0008' }} />
            <button onClick={() => setModalImage(null)} style={{ position: 'absolute', top: 8, right: 8, background: '#fff', border: '1px solid #e53e3e', color: '#e53e3e', borderRadius: '50%', width: 32, height: 32, fontSize: 20, cursor: 'pointer', boxShadow: '0 2px 8px #0004' }}>×</button>
          </div>
        </div>
      )}
      {/* Chat History Modal */}
      {showHistoryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.25)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 32px #0004', padding: 32, minWidth: 340, maxWidth: 420, position: 'relative' }}>
            <button onClick={() => setShowHistoryModal(false)} style={{ position: 'absolute', top: 12, right: 16, background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}>&times;</button>
            <h2 style={{ marginTop: 0, color: '#2563eb' }}>Select Chat Session</h2>
            {loadingSessions ? (
              <div style={{ color: '#888', marginTop: 16 }}>Loading...</div>
            ) : chatSessions.length === 0 ? (
              <div style={{ color: '#888', marginTop: 16 }}>No chat sessions found.</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {chatSessions.map((s, i) => (
                  <li key={s.sessionId} style={{ marginBottom: 12, borderBottom: '1px solid #eee', paddingBottom: 8 }}>
                    <button onClick={() => handleLoadSession(s)} style={{ background: '#e0e7ff', border: 'none', borderRadius: 8, padding: '8px 12px', width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 600, color: '#2563eb' }}>{s.date}</div>
                      <div style={{ color: '#222', fontSize: 13, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.firstLine || <i>No user message</i>}</div>
                      <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>Messages: {s.messagesCount}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {/* Context Modal */}
      {showContextModal && contextToShow && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '24px',
            borderRadius: '12px',
            maxWidth: '90%',
            maxHeight: '90%',
            overflow: 'auto',
            position: 'relative',
            width: '800px',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', color: '#2563eb', paddingRight: '24px' }}>AI Context</h3>
            <div style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'monospace',
              fontSize: '14px',
              lineHeight: '1.5',
              backgroundColor: '#f8fafc',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              color: '#1e293b'
            }}>
              {formatContextForDisplay(contextToShow)}
            </div>
            <button
              onClick={() => setShowContextModal(false)}
              style={{
                position: 'absolute',
                right: '16px',
                top: '16px',
                border: 'none',
                background: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#64748b',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={e => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
              onMouseOut={e => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              ×
            </button>
          </div>
        </div>
      )}
      {/* Explanation Modal */}
      {showExplanationModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: 20,
            borderRadius: 8,
            maxWidth: '80%',
            maxHeight: '80%',
            overflow: 'auto',
            position: 'relative'
          }}>
            <h3 style={{ marginTop: 0, color: '#4f46e5' }}>{explanationTitle}</h3>
            <p style={{ whiteSpace: 'pre-wrap', margin: '10px 0' }}>{explanationToShow}</p>
            <button
              onClick={() => setShowExplanationModal(false)}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                border: 'none',
                background: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#6b7280'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat; 