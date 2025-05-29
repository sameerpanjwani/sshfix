import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addServer } from '../api/servers';

const AddServerForm: React.FC = () => {
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await addServer(form);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to add server');
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} style={{ maxWidth: 400 }}>
        <h2>Add Server</h2>
        {error && <div style={{ color: 'red' }}>{error}</div>}
        <div>
          <label>Name:</label>
          <input name="name" value={form.name} onChange={handleChange} required placeholder="Server Name" />
        </div>
        <div>
          <label>Host:</label>
          <input name="host" value={form.host} onChange={handleChange} required placeholder="e.g. 192.168.1.10" />
        </div>
        <div>
          <label>Port:</label>
          <input name="port" type="number" value={form.port} onChange={handleChange} required placeholder="22" />
        </div>
        <div>
          <label>Username:</label>
          <input name="username" value={form.username} onChange={handleChange} required placeholder="e.g. root" />
        </div>
        <div>
          <label>Password:</label>
          <input name="password" type="password" value={form.password} onChange={handleChange} placeholder="Password (optional if using key)" />
        </div>
        <div>
          <label>Private Key:</label>
          <textarea name="privateKey" value={form.privateKey} onChange={handleChange} rows={3} placeholder="Paste private key here (optional)" />
        </div>
        <button type="submit">Add Server</button>
      </form>
      <div style={{ marginTop: 32, maxWidth: 600 }}>
        <h3>How to Get Your Server Credentials</h3>
        <div>
          <b>WHM/cPanel Server:</b>
          <ul>
            <li>Log in to WHM or cPanel.</li>
            <li>Find your server's IP address (usually on the dashboard or in the left sidebar).</li>
            <li>For SSH access, go to <b>SSH Access</b> in cPanel and generate or download your private key, or use your cPanel username and password.</li>
            <li>Default SSH port is usually 22.</li>
          </ul>
          <b>DigitalOcean:</b>
          <ul>
            <li>Go to your DigitalOcean dashboard and select your Droplet.</li>
            <li>Use the IP address shown.</li>
            <li>Default username is <b>root</b> (for new Droplets).</li>
            <li>Use the SSH key you added when creating the Droplet, or use the password emailed to you.</li>
          </ul>
          <b>AWS EC2:</b>
          <ul>
            <li>Go to the EC2 dashboard and select your instance.</li>
            <li>Use the <b>Public IPv4 address</b> as the host.</li>
            <li>Default username is <b>ec2-user</b> (Amazon Linux), <b>ubuntu</b> (Ubuntu), or <b>centos</b> (CentOS).</li>
            <li>Use the private key (.pem file) you downloaded when launching the instance.</li>
          </ul>
          <b>Vercel:</b>
          <ul>
            <li>Vercel does not provide direct SSH access to serverless deployments.</li>
            <li>For backend servers, use the credentials provided by your hosting provider.</li>
          </ul>
          <b>Other/Generic Linux Server:</b>
          <ul>
            <li>Ask your hosting provider for the server's IP address, SSH port, and your username.</li>
            <li>Use the password or private key provided to you.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AddServerForm; 