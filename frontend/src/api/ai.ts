import axios from 'axios';

// In development, use localhost. In production, use relative path
const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : '';

export const getAISuggestion = async (
  prompt: string,
  model: string,
  serverId: number,
  chatSessionId: string | number | null,
  withTerminalContext: boolean = false,
  newSession: boolean = false,
  imageUrls?: string[],
  edit: boolean = false,
  messageId?: number
) => {
  const response = await axios.post(`${API_BASE}/api/ai`, {
    prompt,
    model,
    serverId,
    chatSessionId: chatSessionId?.toString() || Date.now().toString(),
    withTerminalContext,
    newSession,
    imageUrls,
    edit,
    messageId
  });
  return response.data;
};

export const getAIAvailability = async () => {
  const response = await axios.get(`${API_BASE}/api/ai/available`);
  return response.data;
};

export const uploadImages = async (files: File[]) => {
  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  const res = await axios.post(`${API_BASE}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.urls as string[];
};

// For explicit edit usage
export const editAISuggestion = async (
  prompt: string,
  model: string,
  serverId: number,
  chatSessionId: string | number | null,
  messageId: number,
  imageUrls?: string[]
) => {
  const response = await axios.post(`${API_BASE}/api/ai`, {
    prompt,
    model,
    serverId,
    chatSessionId: chatSessionId?.toString() || Date.now().toString(),
    withTerminalContext: false,
    newSession: false,
    imageUrls,
    edit: true,
    messageId
  });
  return response.data;
}; 