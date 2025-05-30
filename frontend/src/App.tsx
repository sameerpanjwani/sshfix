import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams } from 'react-router-dom';
import AddServerForm from './components/AddServerForm';
import './styles/shared.css';

const ServerList = React.lazy(() => import('./components/ServerList'));
const ServerDetail = React.lazy(() => import('./components/ServerDetail'));
const Chat = React.lazy(() => import('./components/Chat'));
const ServerDBView = React.lazy(() => import('./components/ServerDBView'));

type ModelType = 'gemini' | 'openai' | 'gemini-pro' | 'claude';

// Wrapper component to provide Chat props
const ChatWrapper = () => {
  const { id } = useParams();
  const [model, setModel] = useState<ModelType>('gemini-pro');
  const [geminiSuggestions, setGeminiSuggestions] = useState<any[]>([]);
  
  if (!id) return <div>Invalid server ID</div>;
  
  return (
    <Chat 
      serverId={parseInt(id, 10)} 
      model={model} 
      setModel={setModel}
      geminiSuggestions={geminiSuggestions}
      setGeminiSuggestions={setGeminiSuggestions}
    />
  );
};

function App() {
  return (
    <Router>
      <div className="container">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="heading-1">SSHFix</h1>
            <p className="text-secondary mb-4">AI-Powered Server Management & Troubleshooting</p>
          </div>
          <nav>
            <Link to="/" className="btn btn-secondary">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
              Servers
            </Link>
          </nav>
        </header>

        {/* Main Content */}
        <main>
          <React.Suspense fallback={
            <div className="card text-center">
              <div className="heading-3">Loading...</div>
            </div>
          }>
            <Routes>
              <Route path="/" element={
                <>
                  {/* Project Info Card */}
                  <div className="card mb-8">
                    <h2 className="heading-2">Welcome to SSHFix</h2>
                    <p className="mb-4">
                      SSHFix is your AI-powered assistant for server management and troubleshooting. 
                      Connect your servers, run commands, and get intelligent suggestions for common issues.
                    </p>
                    <div className="grid grid-cols-2 mb-8">
                      <div>
                        <h3 className="heading-3">Key Features</h3>
                        <ul className="list">
                          <li className="list-item">🤖 AI-powered command suggestions</li>
                          <li className="list-item">🔒 Secure SSH connections</li>
                          <li className="list-item">📊 Real-time server monitoring</li>
                          <li className="list-item">💬 Interactive chat interface</li>
                        </ul>
                      </div>
                      <div>
                        <h3 className="heading-3">Supported AI Models</h3>
                        <ul className="list">
                          <li className="list-item">✨ Gemini Pro</li>
                          <li className="list-item">🚀 OpenAI GPT-4</li>
                          <li className="list-item">⚡ Gemini Flash</li>
                          <li className="list-item">🔮 Claude Sonnet</li>
                        </ul>
                      </div>
                    </div>
                    <Link to="/server/new" className="btn btn-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      Add Your First Server
                    </Link>
                  </div>
                  
                  {/* Server List */}
                  <ServerList />
                </>
              } />
              <Route path="/server/new" element={<AddServerForm />} />
              <Route path="/server/:id" element={<ServerDetail />} />
              <Route path="/server/:id/chat" element={<ChatWrapper />} />
              <Route path="/server/:id/db" element={<ServerDBView />} />
            </Routes>
          </React.Suspense>
        </main>

        {/* Footer */}
        <footer className="text-center text-secondary mt-8 pt-8 border-t border-border-color">
          <p>SSHFix &copy; 2025 - AI-Powered Server Management</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;
