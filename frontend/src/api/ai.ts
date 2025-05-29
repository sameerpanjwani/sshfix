import axios from 'axios';

const API_BASE = 'http://localhost:4000/api';

export const getAISuggestion = async (prompt: string, model: 'openai' | 'gemini' | 'claude') => {
  const res = await axios.post(`${API_BASE}/ai`, { prompt, model });
  return res.data;
}; 