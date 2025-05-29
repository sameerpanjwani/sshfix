import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getServer, getHistory } from '../api/servers';
import { runSSHCommand } from '../api/ssh';

const ServerDetail: React.FC = () => {
  const { id } = useParams();
  const [server, setServer] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      getServer(Number(id)).then(setServer);
      getHistory(Number(id)).then(setHistory);
      setLoading(false);
    }
  }, [id]);

  const handleRun = async () => {
    if (!id || !command) return;
    setOutput('Running...');
    try {
      const res = await runSSHCommand(Number(id), command);
      setOutput(res.output);
      setHistory([{ command, output: res.output, created_at: new Date().toISOString() }, ...history]);
    } catch (e: any) {
      setOutput(e.message);
    }
  };

  if (loading || !server) return <div>Loading...</div>;

  return (
    <div>
      <h2>Server: {server.name}</h2>
      <div>Host: {server.host}</div>
      <div>Username: {server.username}</div>
      <div>Port: {server.port}</div>
      <Link to={`/server/${server.id}/chat`}>Chat with AI</Link>
      <h3>Run SSH Command</h3>
      <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Enter command" />
      <button onClick={handleRun}>Run</button>
      <pre>{output}</pre>
      <h3>History</h3>
      <ul>
        {history.map((h, i) => (
          <li key={i}><b>{h.command}</b><br />{h.output}<br /><small>{h.created_at}</small></li>
        ))}
      </ul>
    </div>
  );
};

export default ServerDetail; 