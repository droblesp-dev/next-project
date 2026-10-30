# NEXTPROJECT

Sistema web para un **centro de mecanizado industrial**: capta solicitudes de clientes, apoya el análisis técnico con IA, gestiona cotizaciones con enlace seguro para el cliente y da seguimiento a las órdenes de trabajo hasta su entrega y cierre.

Las reglas de desarrollo, las decisiones arquitectónicas y el plan de fases están en [`CLAUDE.md`](./CLAUDE.md) (documento base, congelado). El detalle de cada fase está en [`docs/fases/`](./docs/fases/) y los cambios de seguridad en [`docs/CHANGELOG-SEGURIDAD.md`](./docs/CHANGELOG-SEGURIDAD.md).

## Qué hace

**Sitio público (sin login)**
- Landing con servicios, galería de trabajos y contacto.
- Formulario de solicitud de cotización, con un asistente de IA (NexIA) que ayuda a redactar la solicitud; está limitado por IP.
- Vista de cotización por **enlace firmado + código de 6 dígitos**: el cliente la revisa, la acepta o rechaza y sube el comprobante de anticipo y de saldo. Si pierde el código, lo recupera con un código enviado por correo (OTP).

**Área privada (con login y roles)**
- **Solicitudes** y chat interno entre comercial y operativo.
- **Análisis con IA** de cada solicitud (Gemini); la revisión humana es obligatoria antes de cotizar.
- **Cotizaciones**: IVA, anticipo, saldo, vigencia, envío del enlace por correo.
- **Órdenes de trabajo**: responsable, avance, evidencias (fotos/PDF), ficha técnica, entrega y cierre.
- **Leads** (mini CRM) y seguimientos, **alertas** y **dashboard** (solo ADMIN).
- **Cuentas bancarias** receptoras y catálogo de entidades financieras (solo ADMIN).
- Gestión de **usuarios** y cambio seguro de contraseña.

| Rol | Alcance |
|---|---|
| `ADMIN` | Administración y supervisión general |
| `COMERCIAL` | Solicitudes, revisión de análisis, cotizaciones, leads |
| `OPERATIVO` | Órdenes asignadas, avance, evidencias y ficha técnica |

`CLIENTE` no es un rol interno: los clientes viven en la tabla `clientes` y acceden solo por los enlaces públicos.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js 20 + Express 4 + TypeScript |
| Base de datos | PostgreSQL (`nextproject`) con `pg` + SQL directo (sin ORM) |
| Autenticación | `bcryptjs` + JWT (HS256), sesiones invalidables |
| IA | Google Gemini (`@google/genai`), solo desde el backend |
| Correo | Brevo (API transaccional por HTTP) |
| API docs | Swagger/OpenAPI en `/api-docs` (solo fuera de producción) |
| Seguridad | `helmet`, límite de intentos de login, bitácora de eventos |

## Estructura

```
/
├── backend/
│   ├── database/migrations/   # Migraciones SQL versionadas V0…V18
│   ├── scripts/               # Seeders y utilidades
│   ├── src/                   # config, controllers, middleware, repositories, routes, services
│   └── Dockerfile
├── frontend/
│   ├── src/
│   ├── nginx.conf.template    # Sirve la SPA y reenvía /api/ al backend
│   └── Dockerfile
├── docs/                      # Fases y changelog de seguridad
└── CLAUDE.md
```

## Desarrollo local

**Requisitos:** Node.js 20 o superior y PostgreSQL con una base `nextproject`.

### 1. Base de datos
Aplicar las migraciones **en orden numérico** (V0, V1, V2 … V18). Con `psql`:

```bash
cd backend/database/migrations
for f in $(ls *.sql | sed -E 's/^V([0-9]+)__.*/\1 &/' | sort -n | cut -d' ' -f2); do
  psql -v ON_ERROR_STOP=1 -h localhost -U postgres -d nextproject -f "$f"
done
```

Reglas de las migraciones: archivo `V<número>__descripcion.sql`, estrictamente aditivas, nunca se edita una ya aplicada y toda estructura nueva requiere autorización (ver `CLAUDE.md` §9 y §12).

### 2. Backend
```bash
cd backend
cp .env.example .env     # completar valores; nunca versionar .env
npm install
npm run dev              # http://localhost:3000  (Swagger: /api-docs)
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env.local   # opcional: por defecto apunta a http://localhost:3000
npm install
npm run dev                  # http://localhost:5174
```

### Seeders (datos, no estructura; idempotentes)
| Comando | Qué hace |
|---|---|
| `npm run seed:initial` | Roles + primer ADMIN (requiere el hash local, ver `npm run hash:admin`) |
| `npm run seed:usuarios-roles` | Un usuario de prueba por rol (requiere `SEED_*_PASSWORD` en `.env`) |
| `npm run seed:bancos-catalogo` | Catálogo de entidades financieras (requiere un ADMIN activo) |

## Variables de entorno

Los archivos de referencia son [`backend/.env.example`](./backend/.env.example) y [`frontend/.env.example`](./frontend/.env.example); cada variable está comentada allí. Resumen:

**Backend — obligatorias (el servidor no arranca sin ellas):** `JWT_SECRET`, `COTIZACION_LINK_SECRET`, `LEAD_LINK_SECRET` (tres secretos distintos e independientes), y la conexión `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

| Grupo | Variables |
|---|---|
| Servidor | `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `TRUST_PROXY` |
| PostgreSQL | `DB_SSL` |
| Sesión | `JWT_EXPIRES_IN` |
| IA | `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Correo | `BREVO_API_KEY`, `NEXT_PROJECT_EMAIL`, `BREVO_SANDBOX`, `NEXT_PROJECT_NAME`, `NEXT_PROJECT_WHATSAPP` |
| Negocio | `OPERATIVO_POR_DEFECTO_EMAIL`, `BANCO_*` (datos bancarios heredados) |
| Seeders | `SEED_ADMIN_PASSWORD`, `SEED_COMERCIAL_PASSWORD`, `SEED_OPERATIVO_PASSWORD`, `SEED_*_EMAIL` (solo el seeder del pipeline) |

**Frontend (públicas, prefijo `VITE_`):** `VITE_API_BASE_URL`, `VITE_NEXT_PROJECT_NAME`, `VITE_NEXT_PROJECT_WHATSAPP`, `VITE_NEXT_PROJECT_UBICACION_TEXTO`, `VITE_NEXT_PROJECT_UBICACION_CONSULTA`. No poner secretos aquí: llegan al navegador.

## Pruebas

Solo pruebas **unitarias**; no usan PostgreSQL ni servicios externos.

```bash
cd backend  && npm test && npx tsc --noEmit
cd frontend && npm test && npm run lint
```

Las pruebas de integración que escriben en la base de datos no forman parte del flujo de pruebas ni de ningún flujo automatizado.

## Despliegue

[PENDIENTE] Este repositorio no incluye pipeline de CI/CD ni automatización de despliegue.

**Cómo corre en el servidor**
- Backend: contenedor `node:20-alpine` en el puerto 3000 interno, con el volumen `~/nextproject-uploads-<entorno>` montado en `/app/uploads` (`comprobantes`, `evidencias`, `logos-bancos`). Los archivos subidos persisten entre despliegues.
- Frontend: contenedor `nginx` que sirve la SPA y reenvía `/api/` y `/uploads/logos-bancos/` al backend (`BACKEND_HOST`, `BACKEND_PORT`). La imagen se construye con `VITE_API_BASE_URL` vacío para usar rutas relativas.
- El backend recibe `TRUST_PROXY=1` porque va detrás de ese nginx; así el límite de intentos usa la IP real del visitante.

**Antes de la primera ejecución sobre una base ya existente:** si esa base se creó a mano y no tiene la tabla `schema_migrations`, el motor intentaría aplicar V0 de nuevo y fallaría. Hay que sembrar primero las versiones ya aplicadas.

**Pendientes conocidos de despliegue** (detalle en el changelog de seguridad): el contenedor del backend corre como root, el puerto del backend se publica en el host y los límites de intentos de las rutas públicas viven en memoria (se reinician con el proceso).

## Estado del proyecto

El desarrollo avanza por fases (ver §24 de `CLAUDE.md`). Lo documentado como implementado y verificado está en `docs/fases/`; lo demás se considera trabajo en curso.
