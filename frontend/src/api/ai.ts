import axios from 'axios';

const API_BASE = 'http://localhost:4000/api';

export const getAISuggestion = async (
  prompt: string,
  model: 'openai' | 'gemini' | 'claude',
  serverId?: number,
  withTerminalContext?: boolean,
  newSession?: boolean
) => {
  const res = await axios.post(`${API_BASE}/ai`, { prompt, model, serverId, withTerminalContext, newSession });
  return res.data;
};

export const getAIAvailability = async () => {
  const res = await axios.get(`${API_BASE}/ai/available`);
  return res.data;
};

export const uploadImages = async (files: File[]) => {
  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  const res = await axios.post(`${API_BASE}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.urls as string[];
}; 