# Changelog de seguridad (revisión OWASP Top 10:2021)

Fecha: 2026-10-23. Alcance: backend (`backend/`), pipeline (`azure-pipelines.yml`).
Origen: revisión estática de código + `npm audit`. Estado de cada punto verificado
con compilación (`tsc`), `npm test` (82 pruebas unitarias) y prueba en navegador (ver §Verificación).

| # | Sev. | OWASP | Hallazgo | Estado | Cambio |
|---|---|---|---|---|---|
| 1 | Alta | A06 | 7 vulnerabilidades en dependencias de producción | **Corregido** | `npm audit fix` (sin `--force`): express 4.22.3, multer 2.5.0, proxy-addr 2.0.8, qs 6.16.1, body-parser 1.20.9, fast-uri, brace-expansion. `npm audit --omit=dev`: **0 vulnerabilidades**. |
| 2 | Alta | A07 | Login sin límite de intentos | **Corregido** | `services/loginRateLimit.service.ts`: 5 fallos por IP+correo y 30 por IP en 15 min → 429 + `Retry-After`. Un login correcto limpia el contador de esa cuenta. |
| 3 | Alta | A05 | `login`/`me` sin `asyncRoute`; sin `unhandledRejection` (DoS ante fallo de BD) | **Corregido** | `routes/auth.routes.ts` envuelve ambos; `server.ts` registra `unhandledRejection` sin terminar el proceso. (Las rutas de `solicitudes` ya usaban `asyncRoute`: era un falso positivo del escaneo inicial.) |
| 4 | Media | A05 | Sin cabeceras de seguridad | **Corregido** | Dependencia nueva `helmet` ^8.3.0 en `server.ts` (se excluye `/api-docs`; CORP `cross-origin` para los logos de bancos). |
| 5 | Media | A04/A07 | Límites de intentos de rutas públicas en memoria (se pierden al reiniciar, no se comparten entre instancias, el bloqueo por cotización puede usarse para molestar al cliente) | **Pendiente (decisión)** | Persistirlos exige una tabla nueva (§9 CLAUDE.md: requiere autorización). El nuevo límite de login comparte esta limitación, documentada en el código. |
| 6 | Media | A01 | Rol tomado del JWT, no de la BD | **Corregido** | `middleware/auth.middleware.ts`: `req.user.rol` sale de `usuarios`/`roles` en cada petición; un cambio de rol rige de inmediato. |
| 7 | Media | A02 | `jwt.verify` sin `algorithms` | **Corregido** | HS256 explícito al firmar y verificar en `auth.service.ts` y `cotizaciones.service.ts` (leads ya lo tenía). |
| 8 | Media | A05 | `req.ip` sin `trust proxy` | **Corregido (requiere configurar)** | Variable `TRUST_PROXY` (`config/env.ts`, `.env.example`). Sin definir, comportamiento anterior. **Acción de despliegue:** definirla si hay proxy/balanceador. |
| 9 | Baja | A05 | Swagger solo se oculta con `NODE_ENV=production` | **Sin cambio (ya mitigado)** | El Dockerfile fija `NODE_ENV=production`; no se añadió otra variable para no romper la documentación local. |
| 10 | Baja | A05 | Contenedor corre como root | **Pendiente (riesgo de despliegue)** | `USER node` rompería la escritura en `/app/uploads` (bind mount del host con otro propietario) y no se puede probar el despliegue desde aquí. Requiere `docker run --user` + prueba en staging. |
| 11 | Baja | A02 | `rejectUnauthorized: false` en conexiones SSL | **Corregido (opt-in)** | Variable `DB_SSL_REJECT_UNAUTHORIZED=true` en `db.ts` y seeders `.js`. Por defecto sigue `false` hasta que se configure la CA del servidor. `PGSSLMODE=require` de las migraciones no cambia. |
| 12 | Baja | A07 | Pipeline de prod siembra usuarios de prueba | **Pendiente (decisión)** | Las credenciales vienen de variables secretas del pipeline; quitar el paso dejaría prod sin ADMIN inicial. Decidir cómo crear el primer administrador. |
| 13 | Info | A09 | Sin registro de eventos de seguridad | **Corregido (básico)** | `services/securityLog.ts`: JSON por línea para `LOGIN_OK/FALLIDO/BLOQUEADO`, `PASSWORD_CAMBIADA`, `PROMESA_NO_CAPTURADA`. Sin contraseñas ni tokens; correos enmascarados. |

## Dependencias
- Agregada: `helmet@^8.3.0`.
- Actualizadas por `npm audit fix` (dentro de rangos semver): ver `package-lock.json`.
- Sin resolver: 3 avisos solo de **desarrollo** (`vitest`/`tinypool`); exigen `vitest@5` (cambio mayor, `--force`). No afectan a producción.

## Archivos
Nuevos: `services/securityLog.ts`, `services/loginRateLimit.service.ts`, `services/loginRateLimit.test.ts`, este documento.
Modificados: `server.ts`, `config/env.ts`, `config/db.ts`, `controllers/auth.controller.ts`, `routes/auth.routes.ts`, `services/auth.service.ts`, `services/cotizaciones.service.ts`, `middleware/auth.middleware.ts`, `.env.example`, `scripts/seed-*.js`, `package.json`, `package-lock.json`.

## Verificación (ejecutada, 2026-10-23)
Entorno: backend (tsx watch, recargó el código nuevo) en :3000 y frontend Vite en :5174, BD `nextproject`.

| Prueba | Resultado |
|---|---|
| `tsc --noEmit` | Sin errores |
| `npm test` (unitarias) | 82/82 pasan (incluye 6 nuevas del limitador de login) |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Cabeceras (curl a `/api/health`) | CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CORP `cross-origin` presentes |
| Landing, galería y formulario público de solicitud en el navegador | Cargan y se muestran igual que antes |
| Login inválido desde la UI | 401 y mensaje "Credenciales inválidas" (sin regresión) |
| Límite de login (fetch desde la página) | Intentos 1-4: 401; desde el 5.º: **429** con `reintentarEnSegundos`; otro correo desde la misma IP: 401 (no bloqueado) |
| Rutas protegidas sin token | 401 |
| Token JWT `alg=none` / HS256 con firma falsa | 401 |
| JSON inválido / login sin campos | 400 |
| Token de cotización pública inválido | 401 (no 500) |

**No verificado:**
- Login **válido** y navegación del área privada: el acceso a la contraseña de prueba (`SEED_ADMIN_PASSWORD`) fue denegado por el clasificador de permisos y no se eludió. El cambio de `requireAuth` (rol desde BD) y el flujo autenticado quedan sin probar en navegador.
- Tests de integración: **retirados del flujo de pruebas** (se eliminó `ALLOW_TEST_DB_WRITES`, el script `test:integration` y su configuración). Solo se ejecutan pruebas unitarias, también en el pipeline (etapa `UnitTests` antes de `Build`).
- Despliegue en dev/prod (pipeline, `TRUST_PROXY`, helmet detrás del proxy real).
- `Retry-After` no es legible desde el navegador (CORS no lo expone); la UI puede usar `reintentarEnSegundos` del cuerpo.
- Corrección de un informe previo: el login **no** falla en una BD sin V18; `usuarios.repository.ts` lo tolera con `COALESCE`.
