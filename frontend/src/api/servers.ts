import axios from 'axios';

const API_BASE = 'http://localhost:4000/api';

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

export const getChatHistory = async (id: number, date?: string) => {
  const url = date ? `${API_BASE}/servers/${id}/chat?date=${date}` : `${API_BASE}/servers/${id}/chat`;
  const res = await axios.get(url);
  return res.data;
};

export const addChatMessage = async (id: number, role: 'user' | 'ai', message: string) => {
  const res = await axios.post(`${API_BASE}/servers/${id}/chat`, { role, message });
  return res.data;
};

export const testServerConnection = async (id: number) => {
  const res = await axios.post(`${API_BASE}/servers/${id}/test`);
  return res.data;
};

export async function getChatSessions(serverId: number) {
  const res = await axios.get(`${API_BASE}/servers/${serverId}/chat-sessions`);
  return res.data;
} 