# Project Context: SSHFix

## Purpose
This file tracks what has been done, file-wise, what is pending, what needs testing, and important notes for future development. Use this as a quick reference for onboarding, resuming work, or providing context in new chats.

# Recent Changes and Outstanding Tasks

- **Backend**: Added `cleanAIResponse` function to robustly parse and clean AI JSON output, ensuring the `json` field is present for valid AI responses even if the model returns slightly malformed JSON. Used this function in both `/api/ai` and `/api/servers/:id/chat` endpoints.
- **Frontend**: Attempted to enable line wrapping in the terminal by setting `lineWrap: true`, but this is not a valid xterm.js option. Noted that line wrapping is enabled by default in xterm.js, and the real solution is to use the fit addon and ensure PTY/terminal cols match.
- **Outstanding**: Remove the invalid `lineWrap` option from `Terminal.tsx` and implement the fit addon for proper resizing and wrapping. Also, ensure the backend PTY is resized on frontend terminal resize for best results.
- **General**: All other recent fixes for AI chat JSON display, terminal UX, and backend robustness are now in place.

---

## Backend (Node.js, Express, SQLite)
- **index.js**
  - [x] Express server setup
  - [x] SQLite integration (better-sqlite3)
  - [x] Tables: servers, history, context, chat_history
  - [x] API: CRUD for servers, history, context, chat_history
  - [x] SSH command execution endpoint (`/api/servers/:id/ssh`)
  - [x] AI suggestion endpoint (`/api/ai`) supporting:
    - OpenAI: `gpt-4o`
    - Gemini: `gemini-2.5-flash-preview-04-17`
    - Claude: `claude-sonnet-4-20250514`
  - [x] AI context can include recent terminal history (toggle from frontend)
  - [x] System prompt support (default and custom)
  - [x] Estimated tokens in context returned to frontend
  - [x] New chat session support (clear chat history per server)
  - [x] AI key availability endpoint (`/api/ai/available`)
  - [x] Improved error handling and logging
  - [x] Security: API keys only in backend `.env`, never exposed to frontend
  - [x] `.env` added to `.gitignore` (never committed)
  - [x] GitHub push protection: secrets must be removed from history if committed (see below)
  - [x] Gemini terminal suggestions now use the last 3 terminal commands/outputs for context, not just the latest.
  - [x] Added alternative suggestion endpoint for Gemini, using last 3 terminal outputs and previous suggestion.
  - [x] Backend prompt construction for Gemini robustly handles missing/empty/undefined command/output, escaping special characters, and always provides a well-formed prompt.
  - [x] Synced terminal history between Terminal and ServerDetail so Gemini suggestions always use the latest outputs.
  - [x] Added and then removed backend logging for Gemini prompt debugging.
  - [ ] Add server-side validation and error handling (pending)
  - [ ] Add authentication (optional/future)

## Frontend (React + TypeScript, Vite)
- **src/api/servers.ts**: API helpers for server management, chat, SSH
- **src/api/ssh.ts**: API helper for SSH command execution
- **src/api/ai.ts**: API helper for AI suggestions, key availability
- **src/components/ServerList.tsx**: List servers, navigate to details/chat
- **src/components/ServerDetail.tsx**: Show server info, run SSH commands, view history, chat
- **src/components/Chat.tsx**: Chat with AI, select model, toggle terminal context, show estimated tokens, new session button, system prompt support
- **src/components/Terminal.tsx**: Terminal UI, scrollable, receives quick actions from chat
- **src/App.tsx**: Routing and layout
- [x] Gemini suggestions are shown in a dedicated section above the chat, not in the chat history.
- [x] Added 'Alternative suggestion' feature for Gemini: user can request an alternative suggestion based on the last 3 terminal outputs and the previous suggestion.
- [x] Token count always visible, chat/terminal height increased, new session clears context, etc.
- [ ] Add/Edit Server form (pending)
- [ ] UI/UX polish (pending)
- [ ] Authentication (pending)
- [ ] Error handling and notifications (pending)

## Security & Git Hygiene
- **Never commit `.env` or secrets to the repo.**
- `.env` is in `.gitignore` in both backend and frontend.
- If secrets were ever committed:
  - Use BFG Repo-Cleaner or `git filter-branch` to remove from history.
  - Rotate/revoke any leaked API keys.
  - See: https://docs.github.com/code-security/secret-scanning/removing-sensitive-data-from-a-repository
- GitHub push protection will block pushes with detected secrets.

## AI Features
- **Models:**
  - OpenAI: `gpt-4o` (with image support)
  - Gemini: `gemini-2.5-flash-preview-04-17` (with image support)
  - Claude: `claude-sonnet-4-20250514` (with image support)
- **Terminal context:** Optional, toggle in chat UI
- **System prompt:** Default (safe, helpful, server-focused) or custom per request
- **Estimated tokens:** Displayed in chat UI after each AI response
- **New chat session:** Button in chat UI, clears chat history for server
- **Quick actions:** Predefined commands sent directly to terminal (bypass AI)
- **Gemini suggestions:**
  - Use last 3 terminal outputs for context
  - Shown in a dedicated section above chat
  - 'Alternative suggestion' feature for more options

## Testing
- [ ] Test backend API endpoints (CRUD, SSH, AI)
- [ ] Test frontend flows (add server, run command, chat)
- [ ] Test with real SSH servers (use test credentials)
- [ ] Test AI integration with all three models
- [x] Fixed terminal context passing issue (2025-05-28)
- [x] Improved Gemini suggestion triggering with debouncing
- [x] Enhanced terminal prompt detection for better command logging

## Recent Fixes (2025-05-28)
- **Terminal Context Issue**: Fixed `Chat.tsx` to fetch fresh terminal history from database before AI requests
- **Gemini Suggestions**: Added debouncing (1s) and duplicate prevention in `ServerDetail.tsx`
- **Terminal Detection**: Improved prompt detection patterns in `Terminal.tsx` to catch more shell types
- **Command Logging**: Terminal now persists commands to backend immediately for better sync

## Notes for Future
- Supabase integration can be added once the npm package is available again
- Store API keys in `.env` files and never commit them
- Consider encrypting sensitive data in SQLite (passwords, private keys)
- Add user authentication and RBAC for production
- Add file upload/download support for SSH (future)
- Add audit logging for all actions
- Consider adding WebSocket reconnection logic for better stability
- Add timeout handling for long-running SSH commands

---

_Last updated: 2025-05-28_ 