# SSHFix: AI-Powered Server Management Assistant

## Overview
A secure web-based tool to manage, diagnose, and fix server issues using SSH, AI, and Supabase. Features conversational troubleshooting, server management, command history, and safety confirmations.

## Tech Stack
- Backend: Node.js (Express), SSH2, OpenAI API, Supabase
- Frontend: React (Vite), Supabase Auth

## Setup
1. Clone the repo
2. `cd backend && npm install`  
3. `cd ../frontend && npm install`
4. Configure Supabase and OpenAI API keys in `.env` files
5. Run backend and frontend servers:
   - Open two terminal windows or tabs.
   - In the first terminal, start the backend:
     ```bash
     cd backend
     node index.js
     ```
   - In the second terminal, start the frontend:
     ```bash
     cd frontend
     npm run dev
     ```
   - By default, the backend runs on [http://localhost:3001](http://localhost:3001) and the frontend on [http://localhost:5173](http://localhost:5173).
   - Make sure your `.env` files are configured in both `backend` and `frontend` directories.

## Features
- Secure server credential storage (Supabase, encrypted)
- SSH command execution (Node.js backend only)
- Conversational AI troubleshooting
- Command history and context per server
- Safety confirmations for sensitive actions 
