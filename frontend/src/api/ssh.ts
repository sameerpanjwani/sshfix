import axios from 'axios';

const API_BASE = 'http://localhost:4000/api';

export const runSSHCommand = async (serverId: number, command: string) => {
  const res = await axios.post(`${API_BASE}/servers/${serverId}/ssh`, { command });
  return res.data;
}; 