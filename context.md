# Project Context: SSHFix

## Purpose
This file tracks what has been done, file-wise, what is pending, what needs testing, and important notes for future development. Use this as a quick reference for onboarding, resuming work, or providing context in new chats.

---

## Backend (Node.js, Express, SQLite)
- **index.js**
  - [x] Express server setup
  - [x] SQLite integration (better-sqlite3)
  - [x] Tables: servers, history, context
  - [x] API: CRUD for servers, history, context
  - [x] SSH command execution endpoint (`/api/servers/:id/ssh`)
  - [x] AI suggestion endpoint (`/api/ai`) supporting OpenAI, Gemini, Claude
  - [ ] Add server-side validation and error handling
  - [ ] Add authentication (optional/future)

## Frontend (React + TypeScript, Vite)
- **src/api/servers.ts**: API helpers for server management
- **src/api/ssh.ts**: API helper for SSH command execution
- **src/api/ai.ts**: API helper for AI suggestions
- **src/components/ServerList.tsx**: List servers, navigate to details/chat
- **src/components/ServerDetail.tsx**: Show server info, run SSH commands, view history
- **src/components/Chat.tsx**: Chat with AI, select model
- **src/App.tsx**: Routing and layout
- [ ] Add/Edit Server form (pending)
- [ ] UI/UX polish (pending)
- [ ] Authentication (pending)
- [ ] Error handling and notifications (pending)

## Testing
- [ ] Test backend API endpoints (CRUD, SSH, AI)
- [ ] Test frontend flows (add server, run command, chat)
- [ ] Test with real SSH servers (use test credentials)
- [ ] Test AI integration with all three models

## Notes for Future
- Supabase integration can be added once the npm package is available again
- Store API keys in `.env` files and never commit them
- Consider encrypting sensitive data in SQLite (passwords, private keys)
- Add user authentication and RBAC for production
- Add file upload/download support for SSH (future)
- Add audit logging for all actions

---

_Last updated: [auto-update this line as you make changes]_ 