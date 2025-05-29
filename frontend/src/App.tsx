import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import AddServerForm from './components/AddServerForm';

const ServerList = React.lazy(() => import('./components/ServerList'));
const ServerDetail = React.lazy(() => import('./components/ServerDetail'));
const Chat = React.lazy(() => import('./components/Chat'));

function App() {
  return (
    <Router>
      <div style={{ padding: 20 }}>
        <h1>SSHFix: AI-Powered Server Management</h1>
        <nav>
          <Link to="/">Servers</Link>
        </nav>
        <React.Suspense fallback={<div>Loading...</div>}>
          <Routes>
            <Route path="/" element={<ServerList />} />
            <Route path="/server/new" element={<AddServerForm />} />
            <Route path="/server/:id" element={<ServerDetail />} />
            <Route path="/server/:id/chat" element={<Chat />} />
          </Routes>
        </React.Suspense>
      </div>
    </Router>
  );
}

export default App;
