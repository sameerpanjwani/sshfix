# Deployment Instructions: SSHFix

This guide covers how to deploy SSHFix on common platforms: WHM/cPanel, DigitalOcean, and Vercel.

---

## 1. WHM/cPanel Server

### Backend (Node.js)
- Ensure Node.js is enabled for your cPanel account (use "Setup Node.js App" in cPanel).
- Upload the `backend` folder to your app directory.
- Install dependencies:
  ```bash
  cd backend
  npm install
  ```
- Set environment variables in the cPanel Node.js app interface or in a `.env` file (OpenAI, Gemini, Claude keys).
- Start the app using the cPanel Node.js app interface (entry point: `index.js`).
- Make sure the backend port (default 4000) is open or proxied via Apache/Nginx.

### Frontend (React)
- Build the frontend:
  ```bash
  cd frontend
  npm run build
  ```
- Upload the contents of `frontend/dist` to your `public_html` or a subdirectory.
- If using a subdirectory, update API URLs in `src/api/*.ts` or use a reverse proxy.

---

## 2. DigitalOcean (Droplet)

### Backend (Node.js)
- SSH into your Droplet.
- Install Node.js and npm if not already installed.
- Upload or clone your repo, then:
  ```bash
  cd backend
  npm install
  ```
- Set environment variables in a `.env` file.
- Start the backend:
  ```bash
  node index.js &
  ```
- Use a process manager like `pm2` for production:
  ```bash
  npm install -g pm2
  pm2 start index.js --name sshfix-backend
  pm2 save
  ```
- Open port 4000 in your firewall, or use Nginx as a reverse proxy.

### Frontend (React)
- Build the frontend:
  ```bash
  cd frontend
  npm run build
  ```
- Serve with Nginx, Apache, or a static file server:
  - Copy `frontend/dist` to your web root (e.g., `/var/www/html/sshfix`)
  - Configure Nginx/Apache to serve the static files
- Update API URLs if needed (e.g., if using a domain or subdomain).

---

## 3. Vercel

### Frontend (React)
- Vercel is ideal for static frontends. Push your `frontend` folder to a GitHub/GitLab repo.
- In Vercel, import the repo and select the `frontend` folder as the project root.
- Set the build command to `npm run build` and output directory to `dist`.
- Set environment variables for API URLs if your backend is remote.

### Backend (Node.js)
- Vercel is not designed for persistent Node.js servers. Host your backend elsewhere (e.g., DigitalOcean, AWS, or cPanel) and point your frontend API URLs to it.

---

## Environment Variables
- Always set your API keys and sensitive info in environment variables or `.env` files.
- Never commit secrets to your repo.

---

## Notes
- For production, use HTTPS and secure your API endpoints.
- If using a custom domain, update API URLs in the frontend as needed.
- For troubleshooting, check server logs and browser console for CORS or network errors.

---

For more details, see `README.md` and `context.md`. 