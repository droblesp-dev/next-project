# 09 · Infraestructura, despliegue y configuración

## Infraestructura usada **[VERIFICADO]** (pipeline y Dockerfiles)
| Pieza | Detalle |
|---|---|
| Control de código y CI/CD | **Azure DevOps** (repo + `azure-pipelines.yml`), agente propio `Zyntra Agent Pool` con Docker |
| Registro de imágenes | **Harbor** (`HARBOR_REGISTRY`, proyecto `zyntra`); imágenes `nextproject-backend` y `nextproject-frontend`, etiquetadas con `Build.BuildId` y el nombre de la rama |
| Servidores | Uno de **staging** y otro de **producción**, accesibles por **SSH** (conexiones de servicio `deploy-ssh-dev` y `deploy-ssh-prod`), ambos con Docker |
| Base de datos | **PostgreSQL** gestionado/externo con SSL (`DB_SSL=true`); migraciones con la imagen `postgres:18-alpine` |
| Red de contenedores | red Docker `nextproject-net` |
| Puertos en el host | backend `5000→3000`, frontend `4000→80` (variables `backend*HostPort`, `frontend*HostPort`) |
| Archivos subidos | `~/nextproject-uploads-<staging|production>` montado en `/app/uploads` |
| Servicios externos | Gemini (IA), Brevo (correo) |

> [PENDIENTE] Dominios, certificados TLS y proxy inverso público: **no están en el repositorio** (se asume que el puerto 4000 se publica detrás de un proxy/balanceador del servidor). Documéntalos en el nuevo proyecto.

## Flujo de ramas y entornos
| Rama | Destino |
|---|---|
| `develop` | migraciones + despliegue a **staging** |
| `main` | migraciones + despliegue a **producción** |
| otras (p. ej. `feat/*`) | no despliegan (el *trigger* solo observa `main` y `develop`) |

## Pipeline (`azure-pipelines.yml`)
Disparo: cambios en `backend/*`, `frontend/*` o el propio pipeline en `main`/`develop`. Etapas encadenadas (cada una exige la anterior):

1. **UnitTests** — dos trabajos en `node:20-alpine`: backend (`npm ci`, `tsc --noEmit`, `npm test`) y frontend (`npm ci`, `npm run lint`, `npm test`). Usan secretos ficticios solo para pruebas.
2. **Build** — `docker build`/`push` de backend y frontend. El frontend se construye con `--build-arg VITE_API_BASE_URL=` (vacío), `VITE_NEXT_PROJECT_NAME`, `VITE_NEXT_PROJECT_WHATSAPP`.
3. **RunMigrations** — por entorno:
   - Motor de migraciones: crea `schema_migrations(version, applied_at)` si no existe, recorre `backend/database/migrations/*.sql` **en orden numérico**, salta las ya registradas, aplica con `psql -v ON_ERROR_STOP=1` y registra. Un error detiene el despliegue.
   - Seeders: `seed-usuarios-roles.js` (roles + un usuario por rol) y `seed-bancos-catalogo.js` (catálogo de bancos), ambos idempotentes.
4. **DeployStaging / DeployProduction** — por SSH: escribe un archivo de entorno temporal con las variables del grupo, `docker login`, `pull` de la imagen, recrea el contenedor, monta el volumen de `uploads`, y el backend espera hasta 10 intentos a que `/api/health` responda.

### Requisitos previos en Azure DevOps para el clon
- Proyecto + repositorio, agente con Docker, conexiones de servicio SSH, cuenta en Harbor (o cambia el registro).
- Grupo de variables `next-project-secrets` con **todas** las variables `DEV_*` y `PROD_*` (lista abajo) más `HARBOR_REGISTRY/USERNAME/PASSWORD`.
- Variables de pipeline: `harborProject`, `backendImageName`, `frontendImageName`, puertos, `dbSsl`, `nextProjectName`, `nextProjectWhatsapp`.

## Contenedores
**Backend** (`backend/Dockerfile`, multi-stage): compila TypeScript en un stage, la imagen final instala solo dependencias de producción, `NODE_ENV=production`, crea `uploads/{comprobantes,evidencias,logos-bancos}`, declara `VOLUME ["/app/uploads"]`, `EXPOSE 3000`, `CMD node dist/server.js`.
**Frontend** (`frontend/Dockerfile`): build con Vite y servicio con `nginx:alpine`; plantilla `nginx.conf.template` con `BACKEND_HOST`/`BACKEND_PORT` (por defecto `backend`/`3000`):
- `/api/` → proxy al backend (con `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto`).
- `/uploads/logos-bancos/` → proxy solo `GET/HEAD`, con `nosniff`.
- `/` → SPA con *fallback* a `index.html`.

> [NO PROBADO en esta máquina] La construcción real de ambas imágenes con Docker no se pudo ejecutar en la sesión de documentación (Docker Desktop no arrancó); el pipeline sí las construye en el agente.

## Variables de entorno
Referencias comentadas: `backend/.env.example` y `frontend/.env.example`. **El servidor no arranca si faltan los tres secretos.**

### Backend
| Variable | Obligatoria | Descripción / valor típico |
|---|:--:|---|
| `PORT` | no | Puerto del servidor (3000) |
| `NODE_ENV` | no | `production` en despliegue (oculta Swagger); lo fija el Dockerfile |
| `CORS_ORIGINS` | sí en prod | Orígenes permitidos separados por coma |
| `TRUST_PROXY` | según despliegue | `1` detrás de nginx; vacío sin proxy |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | **sí** | Conexión a PostgreSQL |
| `DB_SSL` | no | `true` para SSL (el pipeline lo fija) |
| `JWT_SECRET` | **sí** | Firma de sesiones |
| `JWT_EXPIRES_IN` | no | Duración de la sesión (`8h`) |
| `COTIZACION_LINK_SECRET` | **sí** | Firma de los enlaces públicos de cotización (distinto de `JWT_SECRET`) |
| `LEAD_LINK_SECRET` | **sí** | Firma de los enlaces de solicitud de leads (distinto de los otros dos) |
| `OPERATIVO_POR_DEFECTO_EMAIL` | para órdenes automáticas | Correo del OPERATIVO que será responsable por defecto |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | para IA | Clave y modelo de Gemini |
| `BREVO_API_KEY`, `NEXT_PROJECT_EMAIL` | para correo | Clave Brevo y remitente verificado |
| `BREVO_SANDBOX` | no | `true` = no entrega correos (solo pruebas) |
| `NEXT_PROJECT_NAME`, `NEXT_PROJECT_WHATSAPP` | no | Marca y WhatsApp en correos |
| `BANCO_NOMBRE`, `BANCO_TIPO_CUENTA`, `BANCO_NUMERO_CUENTA`, `BANCO_TITULAR`, `BANCO_RUC` | no | **Heredadas**: respaldo de datos bancarios si no hay cuentas receptoras; el código aún las lee |
| `SEED_ADMIN_PASSWORD`, `SEED_COMERCIAL_PASSWORD`, `SEED_OPERATIVO_PASSWORD` | solo seeders | Contraseñas de los usuarios sembrados |
| `SEED_ADMIN_EMAIL`, `SEED_COMERCIAL_EMAIL`, `SEED_OPERATIVO_EMAIL` | solo seeder del pipeline | Correos de esos usuarios |

### Frontend (`VITE_*`, públicas)
`VITE_API_BASE_URL` (vacío en Docker), `VITE_NEXT_PROJECT_NAME`, `VITE_NEXT_PROJECT_WHATSAPP`, `VITE_NEXT_PROJECT_UBICACION_TEXTO`, `VITE_NEXT_PROJECT_UBICACION_CONSULTA`. En el contenedor de nginx: `BACKEND_HOST`, `BACKEND_PORT`.

### Variables que el pipeline lee del grupo (por entorno, prefijo `DEV_`/`PROD_`)
`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `CORS_ORIGINS`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `COTIZACION_LINK_SECRET`, `LEAD_LINK_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `BREVO_API_KEY`, `BREVO_SANDBOX`, `NEXT_PROJECT_EMAIL`, `NEXT_PROJECT_NAME`, `NEXT_PROJECT_WHATSAPP`, `OPERATIVO_POR_DEFECTO_EMAIL`, `BANCO_NOMBRE`, `BANCO_TIPO_CUENTA`, `BANCO_NUMERO_CUENTA`, `BANCO_TITULAR`, `BANCO_RUC`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_COMERCIAL_EMAIL`, `SEED_COMERCIAL_PASSWORD`, `SEED_OPERATIVO_PASSWORD`. (El correo del operativo sembrado reutiliza `OPERATIVO_POR_DEFECTO_EMAIL`.)

## Migraciones y seeders
- **Archivos**: `backend/database/migrations/V<n>__descripcion.sql`, V0 (esquema base) … V18. Resumen de qué aporta cada una:

| Versión | Contenido |
|---|---|
| V0 | Esquema base de 8 tablas: roles, clientes, usuarios, solicitudes, cotizaciones, analisis_ia, ordenes, alertas |
| V1 | Ampliación: IVA/anticipo/vigencia en cotizaciones, código de orden (secuencia+trigger), estados nuevos, revisión de análisis, alertas leídas |
| V2–V3 | `leads`, `lead_seguimientos` |
| V4–V5 | Código de acceso (hash) y fecha de rechazo en cotizaciones |
| V6 | `solicitud_mensajes` (chat) |
| V7 | `fichas_tecnicas` |
| V8 | Avance y estado `PAUSADA` en órdenes; `ordenes_evidencias` |
| V9 | Saldo (método, estado, comprobante, confirmación) y `entrega_confirmada_en` |
| V10–V12 | Códigos legibles `SOL-`/`COT-`, `idempotency_key` de solicitudes |
| V13–V15 | `transferencias_pago`, `cuentas_bancarias`, `bancos_catalogo` y extensiones |
| V16–V17 | Tipo de entidad (BANCO/COOPERATIVA) y logo propio por cuenta |
| V18 | `usuarios.session_version` |

- **Seeders** (`backend/scripts`, idempotentes): `seed-initial-data.ts` (roles + primer ADMIN desde un hash local), `seed-usuarios-roles.ts/.js` (un usuario por rol), `seed-bancos-catalogo.ts/.js` (17 entidades verificadas), `seed-logos-bancos-catalogo.ts` (logos locales), utilidades `generate-admin-hash.ts`, `listar-logos-huerfanos.ts`.
- **Regla**: la estructura va en migraciones; los **datos** de arranque en seeders (nunca dentro de una migración).

## Procedimiento de despliegue desde cero (entorno nuevo)
1. Crear la BD y el usuario; permitir conexiones SSL desde el servidor.
2. Cargar variables en Azure DevOps; crear conexiones SSH y Harbor.
3. Empujar a `develop`: el pipeline aplica V0…V18, siembra roles/usuarios/bancos y despliega.
4. Entrar con el ADMIN sembrado, **cambiar su contraseña** y crear los usuarios reales; desactivar los de prueba.
5. Configurar cuentas bancarias receptoras (ADMIN → Cuentas bancarias) y el correo del operativo por defecto.
6. Si la BD ya existía sin `schema_migrations`, **sembrar antes la línea base** de versiones aplicadas, o el motor intentará re-aplicar V0.
7. Copias de seguridad de PostgreSQL y del volumen de `uploads/`.

## Desarrollo local rápido
```bash
# BD
createdb nextproject
cd backend/database/migrations && for f in $(ls *.sql | sed -E 's/^V([0-9]+)__.*/\1 &/' | sort -n | cut -d' ' -f2); do psql -v ON_ERROR_STOP=1 -d nextproject -f "$f"; done
# Backend
cd backend && cp .env.example .env   # completar DB_*, 3 secretos y SEED_*_PASSWORD
npm install && npm run seed:usuarios-roles && npm run seed:bancos-catalogo && npm run dev
# Frontend
cd frontend && npm install && npm run dev
```
