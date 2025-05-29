import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAISuggestion, getAIAvailability, uploadImages } from '../api/ai';
import { getChatHistory, addChatMessage } from '../api/servers';

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
  model: string;
  sendToTerminal?: (cmd: string) => void;
}

const Chat: React.FC<ChatProps> = ({ onQuickCommand, panelHeight = 400, serverId, model, sendToTerminal }) => {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiAvailable, setAIAvailable] = useState<{openai: boolean, gemini: boolean, claude: boolean} | null>(null);
  const [withTerminalContext, setWithTerminalContext] = useState(false);
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
    if ((!prompt && images.length === 0) || !serverId) return;
    setLoading(true);
    let imageUrls: string[] = [];
    if (images.length > 0) {
      try {
        imageUrls = await uploadImages(images);
      } catch (e) {
        setLoading(false);
        alert('Image upload failed.');
        return;
      }
    }
    // Only add markdown for successfully uploaded images
    let userMsg = prompt;
    if (imageUrls.length > 0) {
      userMsg += '\n' + imageUrls.map(url => `![image](${ensureUploadUrl(url)})`).join(' ');
    }
    await addChatMessage(serverId, 'user', userMsg);
    setHistory([...history, { role: 'user', message: userMsg, created_at: new Date().toISOString() }]);
    setPrompt('');
    setImages([]);
    setImagePreviews([]);
    // Always send imageUrls to backend, even if empty
    try {
      const res = await getAISuggestion(prompt, model as 'openai' | 'gemini' | 'claude', serverId, withTerminalContext, newSession, imageUrls);
      await addChatMessage(serverId, 'ai', res.response);
      setHistory([...history, { role: 'user', message: userMsg, created_at: new Date().toISOString() }, { role: 'ai', message: res.response, created_at: new Date().toISOString() }]);
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
        { role: 'user', message: userMsg, created_at: new Date().toISOString() },
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

  const handleClearChat = async () => {
    if (!serverId) return;
    setLoading(true);
    setHistory([]);
    setEstimatedTokens(null);
    // Clear chat history in backend (reuse newSession logic)
    await getAISuggestion('', model as 'openai' | 'gemini' | 'claude', serverId, false, true); // send empty prompt with newSession
    await getChatHistory(serverId).then(setHistory);
    setLoading(false);
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

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMsgId || !serverId) return;
    setLoading(true);
    let imageUrls: string[] = [...editImageUrls];
    if (editImages.length > 0) {
      try {
        const uploaded = await uploadImages(editImages);
        imageUrls = [...imageUrls, ...uploaded];
      } catch (e) {
        setLoading(false);
        alert('Image upload failed.');
        return;
      }
    }
    // Only add markdown for successfully uploaded images
    let userMsg = editPrompt;
    if (imageUrls.length > 0) {
      userMsg += '\n' + imageUrls.map(url => `![image](${ensureUploadUrl(url)})`).join(' ');
    }
    // Always send imageUrls to backend, even if empty
    try {
      const res = await getAISuggestion(editPrompt, model as 'openai' | 'gemini' | 'claude', serverId, withTerminalContext, false, imageUrls, true, editingMsgId);
      // Update history in-place
      setHistory((hist: any[]) => hist.map((m: any, i: number) => {
        if (m.id === editingMsgId) return { ...m, message: userMsg };
        // Update the next AI message after this user message
        if (i > 0 && hist[i - 1]?.id === editingMsgId && m.role === 'ai') return { ...m, message: res.response };
        return m;
      }));
      setEstimatedTokens(res.estimatedTokens || null);
      cancelEdit();
    } catch (e: any) {
      alert('Edit failed: ' + (e?.response?.data?.error || e.message));
      setLoading(false);
    }
    setLoading(false);
  };

  // --- Add helper to parse AI response ---
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" id="with-terminal-context" checked={withTerminalContext} onChange={e => setWithTerminalContext(e.target.checked)} />
          <label htmlFor="with-terminal-context" style={{ fontWeight: 500 }}>Include terminal context</label>
        </div>
        <button onClick={handleNewSession} style={{ borderRadius: 8, background: '#fff', color: '#6cf', fontWeight: 700, border: '1px solid #6cf', padding: '6px 16px', fontSize: 14, boxShadow: '0 1px 4px #0001' }} disabled={loading}>New Chat Session</button>
        <button onClick={handleClearChat} style={{ borderRadius: 8, background: '#fff', color: '#e53e3e', fontWeight: 700, border: '1px solid #e53e3e', padding: '6px 16px', fontSize: 14, boxShadow: '0 1px 4px #0001' }} disabled={loading}>Clear Chat</button>
        {estimatedTokens !== null && (
          <span style={{ color: '#888', fontSize: 13 }}>Estimated tokens: {estimatedTokens}</span>
        )}
      </div>
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {quickActions.map((action, i) => (
          <button key={i} style={{ borderRadius: 6, background: '#e0e7ff', color: '#222', fontWeight: 500, border: 'none', padding: '6px 12px', cursor: 'pointer' }} onClick={() => handleQuickAction(action.value)}>{action.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12, padding: 8, background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px #0001', maxHeight: panelHeight }}>
        {history.map((msg, i) => {
          const isAI = msg.role === 'ai';
          let answer = msg.message;
          let commands: string[] = [];
          if (isAI && msg.json !== undefined) {
            // If we store json in history, use it
            ({ answer, commands } = parseAIResponse(msg.message, msg.json));
          } else if (isAI) {
            ({ answer, commands } = parseAIResponse(msg.message, undefined));
          }
          return (
            <div key={msg.id || i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
              <div style={{
                background: msg.role === 'user' ? '#6cf' : '#e0e7ff',
                color: msg.role === 'user' ? '#fff' : '#222',
                borderRadius: 16,
                padding: '8px 16px',
                maxWidth: '70%',
                boxShadow: '0 2px 8px #0001',
                position: 'relative',
                wordBreak: 'break-word',
              }}>
                {/* Render answer for AI, or message for user */}
                {isAI ? (
                  <>
                    <div>{answer}</div>
                    {commands && commands.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {commands.map((cmd, idx) => (
                          <button
                            key={idx}
                            style={{ fontFamily: 'monospace', fontSize: 13, padding: '4px 10px', borderRadius: 6, border: '1px solid #888', background: '#fff', cursor: 'pointer' }}
                            onClick={() => handleCommandClick(cmd)}
                            title="Send to terminal"
                          >
                            {cmd}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div>{msg.message}</div>
                )}
                {msg.role === 'user' && editingMsgId !== msg.id && (
                  <button style={{ marginLeft: 8, fontSize: 10, color: '#6cf', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => startEdit(msg, i)}>Edit/Retry</button>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                {msg.role === 'user'
                  ? 'You'
                  : `${model === 'openai' ? 'OpenAI' : model === 'gemini' ? 'Gemini' : model === 'claude' ? 'Claude' : 'AI'} AI`}
                {' • ' + new Date(msg.created_at).toLocaleString()}
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
        <div ref={chatEndRef} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <label htmlFor="model-select">AI Model: </label>
        <select value={model} disabled style={{ marginRight: 8 }} title="AI Model">
          <option value="openai" disabled={aiAvailable ? !aiAvailable.openai : false}>OpenAI GPT-4o</option>
          <option value="gemini" disabled={aiAvailable ? !aiAvailable.gemini : false}>Gemini Flash 2.5</option>
          <option value="claude" disabled={aiAvailable ? !aiAvailable.claude : false}>Claude 3 Sonnet (4.0)</option>
        </select>
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
    </div>
  );
};

export default Chat; 