# 01 · Visión, actores y módulos

## Actores
| Actor | Autenticación | Qué hace |
|---|---|---|
| **Visitante / cliente** | Ninguna (anónimo) o **enlace firmado + código** | Pide cotización, usa el asistente de redacción, ve/acepta/rechaza su cotización, sube comprobantes |
| **COMERCIAL** | Login (JWT) | Gestiona solicitudes, análisis IA, cotizaciones, leads, clientes; cierra el ciclo comercial de las órdenes; chatea con operativo |
| **OPERATIVO** | Login (JWT) | Ejecuta las órdenes que tiene asignadas: estado, avance, evidencias, ficha técnica, alertas; chatea con comercial |
| **ADMIN** | Login (JWT) | Supervisa todo; gestiona usuarios y roles, cuentas bancarias y dashboard; asigna responsables |
| **Sistema (IA)** | Servicio externo | Asiste en redacción (público), análisis de solicitudes, ficha técnica y chat interno. **Nunca decide**: la revisión humana es obligatoria |

## Módulos (todos **[VERIFICADO]** en routers y vistas)
| # | Módulo | Backend (`/api/…`) | Vista (frontend) |
|---|---|---|---|
| 1 | Autenticación y sesión | `auth` | `Login`, `MenuUsuario`, `CambiarPasswordModal` |
| 2 | Usuarios y roles | `usuarios` | `GestionUsuarios` |
| 3 | Clientes | `clientes` | (usado desde solicitudes/cotizaciones) |
| 4 | Solicitudes + chat interno | `solicitudes`, `solicitudes/:id/mensajes` | landing/formulario público, `BandejaSolicitudes`, `DetalleSolicitud`, `ChatTecnico` |
| 5 | Asistente de redacción (público) | `asistente-formulario` | formulario de `App.tsx` (NexIA) |
| 6 | Análisis con IA | `analisis-ia` | dentro de `DetalleSolicitud` |
| 7 | Cotizaciones | `cotizaciones` (internas y `/publica/:token/…`) | `GestionCotizaciones`, `VistaCotizacionPublica` |
| 8 | Pagos (anticipo/saldo) y cuentas receptoras | `cotizaciones/:id/anticipo|saldo`, `cuentas-bancarias` | `GestionCotizaciones`, `GestionCuentasBancarias` |
| 9 | Órdenes de trabajo | `ordenes` | `GestionOrdenes` |
| 10 | Ficha técnica y evidencias | `ordenes/:id/ficha-tecnica|evidencias` | `GestionOrdenes` |
| 11 | Leads (mini-CRM) | `leads`, `leads/enlace-solicitud/:token` | `AsistenteComercial` (público), `GestionLeads`, `SolicitudPorEnlace` |
| 12 | Alertas | `alertas` | `GestionAlertas` |
| 13 | Dashboard | `dashboard` | `GestionDashboard` |

## Recorrido completo del negocio (de principio a fin)
```
Visitante ──► Formulario (con ayuda de NexIA) ──► SOLICITUD NUEVA ──► (correo de confirmación)
                                                      │
COMERCIAL ──► EN_REVISION ──► (análisis IA + revisión humana) ──► COTIZACIÓN BORRADOR
                                                      │ enviar
                                         COTIZACIÓN ENVIADA (+ solicitud COTIZADA)
                                                      │ enlace firmado + código (correo)
Cliente ──► ve la cotización ──► ACEPTA ──► (anticipo NO_APLICA → crea ORDEN)
                                      └──► anticipo PENDIENTE ──► sube comprobante
COMERCIAL/ADMIN ──► valida anticipo ──► se crea la ORDEN (+ ficha técnica por IA)
OPERATIVO ──► EN_PROCESO ──► avance + evidencias ──► FINALIZADA (avance 100 y ≥1 evidencia)
Cliente ──► paga SALDO (comprobante) ──► COMERCIAL valida saldo
COMERCIAL ──► confirma ENTREGA ──► CIERRA la orden (CERRADA)
Alertas ──► entrega próxima / vencida ; Dashboard ──► supervisión del ADMIN
```

## Decisiones de alcance relevantes
- **Cliente sin login**: todo su acceso es por token firmado + código de 6 dígitos. Simplifica la seguridad y la operación.
- **Una cotización ACEPTADA por solicitud** y **una orden por cotización** (índices únicos).
- **Aceptar/rechazar** solo lo hace el cliente (no el personal), para dejar constancia fiable.
- **Sin scheduler**: vencimientos de cotización y alertas se evalúan al consultar.
- **IA como asistente**: ninguna salida de IA cambia estados ni precios por sí sola.
