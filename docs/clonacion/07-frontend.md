# 07 · Frontend

## Stack y arranque **[VERIFICADO]**
React 19 + TypeScript + Vite 6 + Tailwind CSS 4 (`@tailwindcss/vite`), iconos `lucide-react` y *Material Symbols*, animación `motion`. SPA servida por nginx en producción.

```bash
cd frontend && npm install && npm run dev    # http://localhost:5174 (puerto fijo en el script)
npm test        # Vitest (94 pruebas unitarias de utilidades y lógica pura)
npm run lint    # tsc --noEmit
npm run build   # vite build → dist/
```

## Navegación: **sin router**
No usa `react-router`. `AppRoot.tsx` decide la vista con un estado `Vista`:

| Vista | Cuándo | Componente |
|---|---|---|
| `validando` | Al cargar, intenta recuperar la sesión de `sessionStorage` y la valida con `GET /api/auth/me` | — |
| `publico` | Sin sesión | `App.tsx` (landing + formulario de solicitud + asistente comercial) |
| `login` | El usuario pulsa "ACCESO" | `pages/Login.tsx` |
| `privado` | Sesión válida | `pages/AreaPrivada.tsx` (menú lateral por rol + secciones) |
| `cotizacion-publica` | URL `/cotizacion/publica/<token>` | `pages/VistaCotizacionPublica.tsx` |
| `solicitud-enlace` | URL `/solicitud/enlace/<token>` | `pages/SolicitudPorEnlace.tsx` |

Los dos enlaces públicos se detectan leyendo `window.location.pathname` con una expresión regular. Para que funcionen al recargar, **nginx** hace `try_files $uri $uri/ /index.html` y reenvía `/api/` al backend.

## Sesión
- Token JWT y datos mínimos del usuario en **`sessionStorage`** (se pierde al cerrar la pestaña).
- Cualquier **401** del backend se interpreta como sesión vencida y cierra la sesión (por eso "contraseña actual incorrecta" responde 400, no 401).
- `lib/authClient.ts` centraliza `API_BASE` (`VITE_API_BASE_URL`; vacío en Docker para usar rutas relativas `/api`).

## Área privada: secciones y rol
Definidas en `AreaPrivada.tsx` con constantes `ROLES_CON_…` (ver matriz en `04-roles-y-permisos.md`):

| Sección | Componente | Roles que la ven |
|---|---|---|
| Solicitudes (+ detalle, análisis IA, chat) | `BandejaSolicitudes`, `DetalleSolicitud`, `ChatTecnico` | ADMIN, COMERCIAL, OPERATIVO |
| Cotizaciones | `GestionCotizaciones` | ADMIN, COMERCIAL |
| Leads | `GestionLeads` | ADMIN, COMERCIAL |
| Órdenes | `GestionOrdenes` | ADMIN, OPERATIVO, COMERCIAL (lectura) |
| Alertas | `GestionAlertas` | ADMIN, OPERATIVO, COMERCIAL |
| Usuarios | `GestionUsuarios` | ADMIN |
| Cuentas bancarias | `GestionCuentasBancarias` | ADMIN |
| Dashboard | `GestionDashboard` | ADMIN |
| Perfil / cambiar contraseña | `MenuUsuario`, `CambiarPasswordModal` | todos |

## Carpeta `lib/` (lógica pura testeable)
`authClient` (sesión y fetch), `config` (marca, WhatsApp, ubicación desde `VITE_*`), `politicaPassword` (misma política que el backend), `cantidadSolicitud`, `cuentasBancariasForm`, `cuentasReceptoras`, `mensajeAnalisisIa`, `perfilUsuario`.

**Patrón**: la lógica que se puede probar sin DOM va a `lib/` o a funciones exportadas con su `*.test.ts`; los componentes grandes (`GestionCotizaciones` ≈ 3 400 líneas, `GestionOrdenes` ≈ 2 900, `GestionLeads` ≈ 2 700) concentran UI + llamadas a la API. Al clonar conviene **extraer subcomponentes y un cliente de API común** para no repetir `fetch` (deuda técnica reconocida).

## Sistema de diseño **[VERIFICADO]** (`src/index.css`)
- Tema **oscuro industrial**: fondo `#0a0a0a`, superficies `#1a1a1a`/`#222`, acento ámbar `--color-primary-container: #ffc107`, bordes `#333`.
- Tokens en un bloque `@theme` de Tailwind 4 (`--color-surface…`, `--color-primary…`, `--color-on-surface…`, `--color-error…`) y utilidades propias (`sharp-border`, clases tipográficas `font-code-sm`, `font-body-md`).
- Tipografías: **Montserrat** (títulos), **Inter** (cuerpo) y **JetBrains Mono** (etiquetas/código), declaradas como `--font-*` en `@theme`; los iconos usan Material Symbols (cargado desde Google Fonts en `index.html`).
- Estética de **esquinas rectas** y mayúsculas en acciones.
- **Para otra marca**: cambiar solo los tokens de `@theme` (paleta y fuentes) y las imágenes de `src/assets/images`; el resto de componentes hereda los colores.

## Contenido del negocio incrustado en el frontend (a reemplazar)
- `App.tsx` (≈ 2 000 líneas): landing (hero, servicios, galería, contacto), formulario de solicitud y textos de NexIA.
- `lib/config.ts`: nombre, WhatsApp y ubicación (configurables por `VITE_*`).
- `index.html` y `public/`: título, descripción, favicon.
- Imágenes (`assets/images`) y textos de servicios.
- Solo 3 de las variables `VITE_*` se pasan al construir la imagen (`VITE_API_BASE_URL`, `VITE_NEXT_PROJECT_NAME`, `VITE_NEXT_PROJECT_WHATSAPP`); la ubicación usa su valor por defecto salvo que se añadan `ARG` al `Dockerfile` y `--build-arg` al pipeline.

## Pruebas
Vitest en `environment: 'node'`; solo se prueban funciones puras y lógica de utilidades (no hay pruebas de componentes con DOM ni E2E). **[VERIFICADO]**
