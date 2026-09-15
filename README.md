<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/531f713c-baa4-4b58-8798-1b70358d4ea6

## Run Locally

**Prerequisites:**  Node.js

Estructura del monorepo:
- `frontend/` — React + TypeScript + Vite.
- `backend/` — Node.js + Express + TypeScript, incluye `backend/database/migrations/`.

### Frontend

1. Instalar dependencias:
   `cd frontend && npm install`
2. Configurar `.env.local` con `GEMINI_API_KEY` si corresponde.
3. Ejecutar:
   `npm run dev`

### Backend

1. Instalar dependencias:
   `cd backend && npm install`
2. Configurar `.env` (ver `backend/.env.example`).
3. Ejecutar:
   `npm run dev`
