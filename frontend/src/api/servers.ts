import axios from 'axios';

// Fix API base URL to handle both dev and prod environments
const API_BASE = window.location.origin.includes('localhost') 
  ? 'http://localhost:4000/api'
  : '/api';

export const getServers = async () => {
  const res = await axios.get(`${API_BASE}/servers`);
  return res.data;
};

export const addServer = async (server: any) => {
  const res = await axios.post(`${API_BASE}/servers`, server);
  return res.data;
};

export const deleteServer = async (id: number) => {
  const res = await axios.delete(`${API_BASE}/servers/${id}`);
  return res.data;
};

export const getServer = async (id: number) => {
  const res = await axios.get(`${API_BASE}/servers/${id}`);
  return res.data;
};

export const getHistory = async (id: number) => {
  const res = await axios.get(`${API_BASE}/servers/${id}/history`);
  return res.data;
};

export const addHistory = async (id: number, command: string, output: string) => {
  const res = await axios.post(`${API_BASE}/servers/${id}/history`, { command, output });
  return res.data;
};

export const getContext = async (id: number) => {
  const res = await axios.get(`${API_BASE}/servers/${id}/context`);
  return res.data;
};

export const setContext = async (id: number, key: string, value: string) => {
  const res = await axios.post(`${API_BASE}/servers/${id}/context`, { key, value });
  return res.data;
};

export const getChatHistory = async (serverId: number, chatSessionId: string, date?: string) => {
  let url = `${API_BASE}/servers/${serverId}/chat?sessionId=${chatSessionId}`;
  if (date) {
    url += `&date=${date}`;
  }
  const res = await axios.get(url);
  return res.data;
};

export const addChatMessage = async (serverId: number, chatSessionId: string, role: 'user' | 'ai', message: string) => {
  if (role === 'ai') {
    console.warn('Attempting to add AI message via addChatMessage. Prefer /api/ai for proper context logging.');
  }
  const res = await axios.post(`${API_BASE}/servers/${serverId}/chat`, { role, message, chatSessionId });
  return res.data;
};

export const testServerConnection = async (id: number) => {
  const res = await axios.post(`${API_BASE}/servers/${id}/test`);
  return res.data;
};

export const getChatSessions = async (serverId: number) => {
  const response = await axios.get(`${API_BASE}/servers/${serverId}/chat-sessions`);
  return response.data;
};

export const setChatSession = async (serverId: number, sessionId: string) => {
  const response = await axios.post(`${API_BASE}/servers/${serverId}/set-chat-session`, { sessionId });
  return response.data;
};

export const testNewServerConnection = async (server: any) => {
  const res = await axios.post(`${API_BASE}/servers/test-connection`, server);
  return res.data;
}; 