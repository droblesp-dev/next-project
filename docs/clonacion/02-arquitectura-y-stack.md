# 02 · Arquitectura y stack

## Stack **[VERIFICADO]** (package.json, Dockerfiles, pipeline)
| Capa | Tecnología |
|---|---|
| Frontend | React 19, TypeScript ~5.8, Vite 6, Tailwind CSS 4, `lucide-react`, `motion` |
| Backend | Node.js 20, Express 4, TypeScript, ESM (`"type": "module"`) |
| Base de datos | PostgreSQL (18 en las migraciones del pipeline) con `pg` + **SQL directo + patrón Repository** (sin ORM) |
| Autenticación | `bcryptjs` (costo 12), `jsonwebtoken` (HS256) |
| Subidas | `multer` (memoria) con validación de tipo y firma binaria |
| IA | `@google/genai` (Gemini) — solo desde el backend |
| Correo | Brevo Transactional Email por HTTP (`fetch`), sin SDK |
| API docs | `swagger-jsdoc` + `swagger-ui-express` (`/api-docs`, oculto en producción) |
| Seguridad HTTP | `helmet` |
| Pruebas | Vitest (unitarias) |
| Contenedores | Docker (backend `node:20-alpine`, frontend `nginx:alpine`) |

## Diagrama lógico
```
Navegador ──► nginx (frontend:80) ──┬─ SPA estática (React)
                                    ├─ /api/*                ──► backend:3000 (Express)
                                    └─ /uploads/logos-bancos ──► backend:3000 (estático público)

backend ──► PostgreSQL           (pg, SQL parametrizado, transacciones donde hay varias escrituras)
        ──► Gemini API           (análisis, ficha técnica, chat, asistente de formulario)
        ──► Brevo API            (correos transaccionales)
        ──► disco /app/uploads   (comprobantes, evidencias, logos → volumen Docker)
```

## Capas del backend (`backend/src`)
| Carpeta | Responsabilidad | Regla |
|---|---|---|
| `routes/` | Declara endpoints y middlewares de auth/rol | Sin lógica |
| `controllers/` | Traduce HTTP ↔ servicios; valida entrada; mapea errores a códigos | Sin SQL |
| `services/` | **Reglas de negocio** (transiciones, cálculos, permisos contextuales) | Lanza errores tipados (`class XError extends Error`) |
| `repositories/` | SQL parametrizado; una función por consulta; acepta un `executor` para participar en transacciones | Sin reglas de negocio |
| `middleware/` | `requireAuth`, `requireRole`, validación de UUID, responsable de orden | |
| `config/` | `env.ts` (lee y valida variables), `db.ts` (pool), `openapi.ts`, rutas de subidas | |

Patrones que se repiten y conviene conservar:
- **Errores tipados** en el servicio y traducción a HTTP en el controlador.
- **Express 4 no captura promesas**: cada ruta async se envuelve con `asyncRoute(handler)`.
- **Transiciones atómicas**: el `UPDATE … WHERE estado = <origen>` dentro del repositorio garantiza la transición y evita carreras; el `rowCount` decide el error.
- **Transacciones** (`BEGIN/COMMIT/ROLLBACK` con `client`) cuando se tocan varias tablas (p. ej. aceptar cotización + convertir lead).
- **Efectos secundarios que nunca deben romper el flujo** (crear orden automática, enviar correo, generar ficha): se ejecutan después del `COMMIT` y **no lanzan**; el fallo se registra.
- **Vencimiento perezoso**: `marcarVencidasSiCorresponde()` antes de leer cotizaciones; las alertas se generan/limpian al consultar.
- **Códigos legibles** generados por trigger de BD (`SOL-/COT-/ORD-######`), no por la aplicación.
- **Limitadores en memoria** (login, intentos de código de cotización, OTP, NexIA): simples, por proceso.

## Estructura del repositorio
```
/
├── backend/
│   ├── database/migrations/      V0…V18 (SQL)
│   ├── scripts/                  seeders y utilidades (.ts local, .js para el pipeline)
│   ├── src/{config,controllers,middleware,repositories,routes,services}
│   ├── Dockerfile  (multi-stage, VOLUME /app/uploads)
│   └── package.json  vitest.config.ts  tsconfig.json
├── frontend/
│   ├── src/{pages,lib,assets}  App.tsx  AppRoot.tsx  main.tsx  index.css
│   ├── nginx.conf.template  Dockerfile
│   └── vite.config.ts  vitest.config.ts
├── docs/  CLAUDE.md  README.md
```

## Convenciones del proyecto
- Idioma del dominio: **español** (tablas, columnas, estados, mensajes). Los nombres técnicos de estado van en MAYÚSCULAS (`EN_REVISION`).
- Cambios mínimos y por fases; sin dependencias nuevas sin justificar (reglas completas en `CLAUDE.md`).
- Sin ORM, sin Python en el backend, sin tablas nuevas sin autorización.
- Migraciones **aditivas** y numeradas; nunca se edita una ya aplicada.
