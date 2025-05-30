import React, { useEffect, useState } from 'react';
import { getServers } from '../api/servers';
import { Link } from 'react-router-dom';

interface Server {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
}

const ServerList: React.FC = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getServers().then(data => {
      setServers(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="card text-center">
        <div className="heading-3">Loading servers...</div>
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="card text-center">
        <h2 className="heading-2">No Servers Found</h2>
        <p className="mb-4">Get started by adding your first server.</p>
        <Link to="/server/new" className="btn btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Server
        </Link>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="heading-2">Your Servers</h2>
        <Link to="/server/new" className="btn btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Server
        </Link>
      </div>
      
      <div className="grid gap-4">
        {servers.map(server => (
          <div key={server.id} className="card" style={{ marginBottom: 0, background: 'var(--background-color)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="heading-3" style={{ marginBottom: '0.5rem' }}>{server.name}</h3>
                <div className="text-secondary">
                  <span>{server.username}@{server.host}:{server.port}</span>
                </div>
              </div>
              <div className="flex gap-4">
                <Link to={`/server/${server.id}`} className="btn btn-secondary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="9" y1="21" x2="9" y2="9"></line>
                  </svg>
                  Terminal
                </Link>
                <Link to={`/server/${server.id}/chat`} className="btn btn-secondary">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                  Chat
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ServerList; 