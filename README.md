# NEXTPROJECT

Sistema de gestión de solicitudes, análisis técnico asistido por IA, cotizaciones y órdenes de trabajo para un centro de mecanizado industrial.

Las reglas generales de desarrollo, decisiones arquitectónicas y el plan de fases del proyecto están documentados en [`CLAUDE.md`](./CLAUDE.md).

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS.
- **Backend:** Node.js + Express + TypeScript.
- **Base de datos:** PostgreSQL (`nextproject`), acceso mediante `pg` + SQL directo (sin ORM).
- **Autenticación:** `bcryptjs` + JWT.
- **Documentación de API:** Swagger/OpenAPI.

## Estructura del monorepo

```
/
├── backend/
│   ├── database/migrations/   # Migraciones SQL versionadas (V0…)
│   ├── scripts/                # Scripts de seed y utilidades
│   └── src/
│       ├── config/
│       ├── controllers/
│       ├── middleware/
│       ├── repositories/
│       ├── routes/
│       └── services/
├── frontend/
│   └── src/
├── docs/fases/                 # Documentación de cada fase del proyecto
└── CLAUDE.md                   # Reglas de desarrollo (documento base, congelado)
```

## Requisitos previos

- Node.js
- PostgreSQL

## Backend

1. Instalar dependencias:
   `cd backend && npm install`
2. Configurar variables de entorno copiando `backend/.env.example` a `backend/.env` y completando los valores (credenciales de PostgreSQL, `JWT_SECRET`, etc.). Nunca versionar `.env`.
3. Aplicar las migraciones en `backend/database/migrations/` sobre la base `nextproject`.
4. Ejecutar en modo desarrollo:
   `npm run dev`

Scripts disponibles: `npm run build`, `npm run start`, `npm run seed:initial`, `npm run seed:usuarios-roles`, `npm run hash:admin`.

## Frontend

1. Instalar dependencias:
   `cd frontend && npm install`
2. Configurar `.env.local` si corresponde (p. ej. `GEMINI_API_KEY`).
3. Ejecutar en modo desarrollo:
   `npm run dev`

## Estado del proyecto

El desarrollo avanza de forma incremental por fases (ver §24 de `CLAUDE.md`). El detalle de cada fase autorizada se documenta en `docs/fases/`.
