# Clearview Dashboard — Render deployment

A starter dashboard built with Node.js, Express, PostgreSQL, and vanilla HTML/CSS/JS.

## Included
- Registration and sign-in
- bcrypt password hashing
- PostgreSQL-backed users and sessions
- Session cookies configured for production HTTPS
- Login/registration rate limiting
- Dashboard overview, activity, and saved preferences
- Render Blueprint configuration (`render.yaml`)
- Health check at `/health`

## Deploy on Render
1. Extract this ZIP.
2. Upload the **contents** of the extracted folder to a GitHub repository. Do not upload `node_modules` or real `.env` secrets.
3. In Render, connect GitHub and choose **New → Blueprint**.
4. Select the repository. Render reads `render.yaml`, which defines a Node web service and PostgreSQL database.
5. Review current plan/pricing and database retention limits, then apply the Blueprint.
6. Wait for the service to deploy. Open the assigned `https://...onrender.com` URL.
7. Test registration, logout, login, and settings persistence.

The Blueprint generates `SESSION_SECRET` and connects `DATABASE_URL` from the Render database. Do not publish or manually reuse secret values.

## Local development
Requires Node.js 20+ and a PostgreSQL database.

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to your PostgreSQL connection string.
3. Set `SESSION_SECRET` to a long random value for local use.
4. In the project folder, run:
   ```sh
   npm install
   npm start
   ```
5. Visit `http://localhost:3000`.

## Important production notes
- This is a starter, not a full production identity platform. Add email verification, password reset, CSRF protection for state-changing form/API requests, monitoring, and a privacy/terms page before using it with real customers.
- Use HTTPS (Render provides it for the hosted URL).
- Free hosting/database plans may sleep, have usage caps, or have limited database retention. Check Render's current plan details and back up data before relying on it.
- No demo/admin account is included. Register your own account from the website.
