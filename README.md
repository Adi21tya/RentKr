# RentKr

AI-powered online house renting platform.

## Running locally

1. **Backend** (FastAPI, port 8000)
   ```bash
   cd backend
   pip install -r requirements.txt   # first time only
   uvicorn server:app --host 127.0.0.1 --port 8000
   ```
   Ensure `backend/.env` has `MONGO_URL`, `DB_NAME`, `JWT_SECRET_KEY`, and optionally `CORS_ORIGINS` (default `*`).

2. **Frontend** (React, port 3000 or 3001)
   ```bash
   cd frontend
   yarn install   # first time only
   yarn start
   ```
   Frontend is configured to use `http://localhost:8000` via `frontend/.env` (`REACT_APP_BACKEND_URL`). If port 3000 is in use, run `PORT=3001 yarn start` (PowerShell: `$env:PORT=3001; yarn start`).

3. Open **http://localhost:3000** (or **http://localhost:3001** if you used PORT=3001). Sign up or log in; after registration you are logged in automatically.
