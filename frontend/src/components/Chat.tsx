import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAISuggestion } from '../api/ai';

const Chat: React.FC = () => {
  const { id } = useParams();
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<'openai' | 'gemini' | 'claude'>('openai');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!prompt) return;
    setLoading(true);
    setResponse('');
    try {
      const res = await getAISuggestion(prompt, model);
      setResponse(res.response);
    } catch (e: any) {
      setResponse(e.message);
    }
    setLoading(false);
  };

  return (
    <div>
      <h2>AI Chat for Server {id}</h2>
      <label htmlFor="model-select">AI Model:</label>
      <select id="model-select" value={model} onChange={e => setModel(e.target.value as any)}>
        <option value="openai">OpenAI GPT-4</option>
        <option value="gemini">Google Gemini</option>
        <option value="claude">Anthropic Claude</option>
      </select>
      <br />
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask the AI..." rows={4} cols={50} />
      <br />
      <button onClick={handleSend} disabled={loading}>{loading ? 'Sending...' : 'Send'}</button>
      <pre>{response}</pre>
    </div>
  );
};

export default Chat; 