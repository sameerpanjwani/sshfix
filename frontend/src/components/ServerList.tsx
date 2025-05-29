import React, { useEffect, useState } from 'react';
import { getServers } from '../api/servers';
import { Link } from 'react-router-dom';

const ServerList: React.FC = () => {
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServers().then(data => {
      setServers(data);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <h2>Servers</h2>
      {loading ? <div>Loading...</div> : (
        <ul>
          {servers.map(server => (
            <li key={server.id}>
              <Link to={`/server/${server.id}`}>{server.name} ({server.host})</Link>
              {' | '}
              <Link to={`/server/${server.id}/chat`}>Chat</Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/server/new">Add Server</Link>
    </div>
  );
};

export default ServerList; 