# 04 · Roles, permisos y API

## Roles **[DECISIÓN vigente / VERIFICADO]**
Solo tres roles internos, en la tabla `roles`: `ADMIN`, `COMERCIAL`, `OPERATIVO`. **`CLIENTE` no es un rol**: los clientes son filas de `clientes` que no inician sesión. Los roles no se crean ni modifican sin autorización (CLAUDE.md §11).

## Dos niveles de autorización (importante al clonar)
1. **Backend (fuente de verdad)**: `requireAuth` + `requireRole(...)` por router/ruta, más reglas **contextuales** en servicios y middlewares.
2. **Frontend**: oculta o muestra secciones y botones según el rol (`AreaPrivada.tsx`). El backend **vuelve a verificar siempre**; ocultar un botón nunca es el control.

El rol vigente se lee **de la BD en cada petición** (no del token), junto con `activo` y `session_version`. Si un ADMIN cambia un rol o desactiva a alguien, rige de inmediato.

## Matriz funcional (qué puede hacer cada rol)
Leyenda: ✔ puede · 👁 solo lectura · ✖ no · ◐ condicionado (ver nota)

| Capacidad | ADMIN | COMERCIAL | OPERATIVO | Cliente (enlace) |
|---|:--:|:--:|:--:|:--:|
| Gestionar usuarios (crear, activar/desactivar, cambiar rol) | ✔ | ✖ | ✖ | ✖ |
| Cuentas bancarias receptoras y catálogo de bancos | ✔ | ✖ | ✖ | ✖ |
| Dashboard de supervisión | ✔ | ✖ | ✖ | ✖ |
| Listar/ver solicitudes | 👁 | ✔ | 👁 | ✖ |
| Cambiar estado de solicitud (EN_REVISION, CANCELADA) | ◐ API | ✔ | ✖ | ✖ |
| Crear solicitud | — | — | — | ✔ (público, sin login) |
| Generar y revisar análisis IA | ◐ API | ✔ | ✖ | ✖ |
| Chat interno de la solicitud | ✖ (lectura) | ✔ | ✔ | ✖ |
| Clientes (listar/crear) | ✔ | ✔ | ✖ | ✖ |
| Crear/editar/enviar/cancelar cotización | ✔ | ✔ | ✖ | ✖ |
| Aceptar o rechazar cotización | ✖ | ✖ | ✖ | ✔ (token + código) |
| Subir comprobante de anticipo/saldo | ✖ | ✖ | ✖ | ✔ (token + código) |
| Validar/rechazar anticipo y saldo | ✔ | ✔ | ✖ | ✖ |
| Crear orden manualmente | ✔ | ✔ | ✖ | ✖ |
| Ver órdenes | ✔ | 👁 | ◐ solo asignadas | ✖ |
| Cambiar estado / avance / evidencias / ficha técnica de la orden | ✔ | ✖ | ◐ solo si es el **responsable** | ✖ |
| Asignar responsable de la orden | ✔ | ✖ | ✖ | ✖ |
| Cancelar, reprogramar entrega, confirmar entrega, **cerrar** orden | ✔ | ✔ | ✖ | ✖ |
| Alertas: ver | todas (supervisión) | solo tipo `ENTREGA` | solo de sus órdenes | ✖ |
| Alertas: atender | ✖ (UI) | ✖ | ✔ (si es responsable) | ✖ |
| Leads / seguimientos / enlace de solicitud | ✔ | ✔ | ✖ | — |
| Asignar/reasignar comercial de un lead | ✔ | ✖ | ✖ | ✖ |

Notas:
- **API vs. UI**: algunas acciones están permitidas a ADMIN en el backend pero la interfaz las reserva a COMERCIAL (cambiar estado de solicitud, generar/revisar análisis). Al clonar, decide si alineas ambos niveles.
- **ADMIN no participa en el chat** (solo lectura) por decisión explícita. COMERCIAL y OPERATIVO escriben.
- **OPERATIVO**: la lectura de órdenes/evidencias/ficha técnica y la ejecución exigen ser el responsable (`ordenes.responsable_id`); una orden sin responsable no autoriza a ningún OPERATIVO.
- **Cliente**: acceso por URL pública `/cotizacion/publica/<token>` y `/solicitud/enlace/<token>`; sin sesión.

## Endpoints **[VERIFICADO]** (extraídos de `backend/src/routes`)
`PÚB` = público sin sesión · `AUTH` = cualquier usuario autenticado · roles = `requireRole`.

### Autenticación — `/api/auth`
| Método | Ruta | Acceso |
|---|---|---|
| POST | `/login` | PÚB (con límite de intentos → 429) |
| GET | `/me` | AUTH |
| PATCH | `/password` | AUTH (cambia la propia; invalida otras sesiones) |

### Usuarios — `/api/usuarios`
| Método | Ruta | Acceso |
|---|---|---|
| GET | `/admins-activos` | ADMIN, COMERCIAL |
| GET, POST | `/` | ADMIN |
| PATCH | `/:id/activo`, `/:id/rol` | ADMIN |

### Clientes — `/api/clientes` (ADMIN, COMERCIAL)
`GET /`, `POST /`

### Solicitudes — `/api/solicitudes`
| Método | Ruta | Acceso |
|---|---|---|
| POST | `/` | PÚB (cabecera `Idempotency-Key`) |
| GET | `/`, `/:id` | ADMIN, COMERCIAL, OPERATIVO |
| PATCH | `/:id/estado` | ADMIN, COMERCIAL |
| GET | `/:id/mensajes` | ADMIN, COMERCIAL, OPERATIVO (con autorización contextual) |
| POST | `/:id/mensajes` | COMERCIAL, OPERATIVO |

### Asistente de formulario — `/api/asistente-formulario`
`POST /` — PÚB, limitado por IP.

### Análisis IA — `/api/analisis-ia` (ADMIN, COMERCIAL)
`GET /`, `POST /` (genera), `GET /:id`, `PATCH /:id/revisado`

### Cotizaciones — `/api/cotizaciones`
| Método | Ruta | Acceso |
|---|---|---|
| GET | `/publica/:token` | PÚB (token) |
| POST | `/publica/:token/verificar` | PÚB (token + código) |
| POST | `/publica/:token/recuperar-codigo/solicitar` y `/verificar` | PÚB (token; OTP por correo) |
| PATCH | `/publica/:token/aceptar`, `/rechazar` | PÚB (token + código) |
| POST | `/publica/:token/comprobante`, `/comprobante-saldo` | PÚB (token + código, multipart) |
| GET | `/`, `/cuentas-receptoras`, `/:id`, `/:id/transferencias` | ADMIN, COMERCIAL |
| POST | `/` | ADMIN, COMERCIAL |
| PATCH | `/:id` (solo BORRADOR), `/:id/estado` | ADMIN, COMERCIAL |
| POST | `/:id/enlace` | ADMIN, COMERCIAL (genera enlace + envía correo) |
| PATCH | `/:id/anticipo`, `/:id/saldo`, `/:id/saldo/reabrir` | ADMIN, COMERCIAL |
| GET | `/:id/comprobante`, `/:id/comprobante-saldo` | ADMIN, COMERCIAL (descarga autenticada) |

### Órdenes — `/api/ordenes`
| Método | Ruta | Acceso |
|---|---|---|
| GET | `/`, `/:id` | ADMIN, COMERCIAL, OPERATIVO |
| POST | `/` | ADMIN, COMERCIAL |
| PATCH | `/:id/estado`, `/:id/avance` | ADMIN, OPERATIVO **responsable** |
| PATCH | `/:id/cancelar`, `/:id/fecha-entrega`, `/:id/entrega`, `/:id/cerrar` | ADMIN, COMERCIAL |
| PATCH | `/:id/responsable` | ADMIN |
| GET/POST | `/:id/ficha-tecnica` | GET: ADMIN, COMERCIAL, OPERATIVO (lectura contextual) · POST: ADMIN, OPERATIVO responsable |
| GET/POST | `/:id/evidencias`, GET `/:id/evidencias/:evidenciaId` | GET: lectura contextual · POST: ADMIN, OPERATIVO responsable |

### Leads — `/api/leads`
| Método | Ruta | Acceso |
|---|---|---|
| POST | `/` | PÚB (captación "hablar con un asesor") |
| GET | `/enlace-solicitud/:token` · POST `/enlace-solicitud/:token/solicitud` | PÚB (token) |
| GET, PATCH | `/`, `/:id` | ADMIN, COMERCIAL |
| GET/POST | `/:id/seguimientos` · POST `/:id/enlace-solicitud` | ADMIN, COMERCIAL |
| PATCH | `/:id/asignar` | ADMIN |

### Alertas — `/api/alertas` (AUTH + rol)
`GET /`, `POST /generar` (ADMIN, COMERCIAL, OPERATIVO); `PATCH /:id/atender` (ADMIN, OPERATIVO con regla de responsable).

### Cuentas bancarias — `/api/cuentas-bancarias` (ADMIN)
`GET /`, `POST /`, `GET /catalogo-bancos`, `GET /:id`, `PATCH /:id`, `PATCH /:id/activo` (+ subida de logo).

### Dashboard — `/api/dashboard` (ADMIN) · Salud — `GET /api/health` (PÚB)
### Archivos públicos: `GET /uploads/logos-bancos/<archivo>` (único directorio estático).

## Cómo añadir un rol o permiso al clonar
1. Añadir el rol a `roles` con un seeder (no con migración de estructura) y al listado de roles válidos en `usuarios.service`.
2. Decidir en el router qué `requireRole` lo incluye.
3. Reflejarlo en `AreaPrivada.tsx` (constantes `ROLES_CON_…`).
4. Si el permiso depende del **recurso** (como "responsable de la orden"), implementarlo en un middleware/servicio, no solo con el rol.
