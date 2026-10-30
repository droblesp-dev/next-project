# 10 · Guía de adaptación a otro modelo de negocio

Objetivo: reutilizar **el motor** (roles, flujo solicitud→cotización→cobro→orden→cierre, seguridad, infraestructura) y cambiar **solo lo específico del rubro**.

## Clasificación: qué es genérico y qué es del mecanizado

| Parte | ¿Se conserva? | Detalle |
|---|---|---|
| Autenticación, roles, sesiones, cambio de contraseña | **Sí, sin cambios** | |
| Solicitudes, clientes, leads, chat, alertas, dashboard | **Sí** | Cambiar etiquetas |
| Cotizaciones (IVA, anticipo, saldo, enlace, OTP), pagos y cuentas bancarias | **Sí** (revisar porcentajes) | Ver §3 |
| Órdenes (estados, avance, evidencias, cierre) | **Sí** (revisar reglas de cierre) | Ver §3 |
| Pipeline, Docker, nginx, migraciones, seeders | **Sí** | Renombrar |
| Servicios ofrecidos (Torno, Fresado, Fabricación, Reparación) | **Reemplazar** | Texto en landing, formulario y NexIA |
| Prompts de IA y esquema del análisis (`material_estimado`, `proceso_estimado`) | **Reemplazar** | `06-ia-y-correo.md` |
| Ficha técnica (secciones de mecanizado) | **Reemplazar** o eliminar | |
| Textos, imágenes, colores, nombre y WhatsApp | **Reemplazar** | `07-frontend.md` |
| Moneda/IVA/pagos (Ecuador: IVA 15 %, bancos y cooperativas ecuatorianos, teléfono +593) | **Revisar** | Ver §3 |

## 1. Rebranding (30–60 min)
Buscar y reemplazar (los términos aparecen en ~45 archivos, mayormente comentarios y textos):
`NextProject` / `NEXTPROJECT` / `nextproject` / `NEXT_PROJECT_*` / `nextproject-backend|frontend` (imágenes y contenedores) / `593939067666` (WhatsApp) / `Shushufindi` (ubicación).
- Variables `NEXT_PROJECT_NAME`, `NEXT_PROJECT_EMAIL`, `NEXT_PROJECT_WHATSAPP` pueden conservarse como nombre técnico y solo cambiar su valor.
- Paquetes: `backend/package.json` (`nextproject-backend`), `frontend/package.json` (`react-example`).
- Base de datos: el nombre `nextproject` está en `.env.example`, el pipeline (`DEV_DB_NAME`) y los comentarios; **no es obligatorio renombrarla**.

## 2. Vocabulario del negocio: decisión clave
Recomendado: **mantener los identificadores técnicos** (`solicitudes`, `cotizaciones`, `ordenes`, estados `NUEVA/EN_REVISION/…`) y cambiar solo lo que ve el usuario. Ejemplos:

| Concepto técnico | Taller (actual) | Clínica/Servicio técnico | Constructora |
|---|---|---|---|
| solicitud | Solicitud de cotización | Solicitud de servicio | Solicitud de presupuesto |
| orden | Orden de trabajo | Orden de servicio | Obra / contrato |
| evidencia | Foto/PDF del trabajo | Informe | Avance de obra (foto) |
| ficha técnica | Ficha técnica de pieza | Ficha del equipo | Alcance de obra |
| operativo | Operario de taller | Técnico | Residente de obra |

Si renombras tablas/estados, hazlo **antes** de escribir datos y con migraciones nuevas (nunca editar V0–V18).

## 3. Reglas de negocio configurables (están en constantes del servicio)
| Regla | Dónde | Valor actual |
|---|---|---|
| IVA permitido/defecto | `cotizaciones.service.ts` (`IVA_PORCENTAJES_PERMITIDOS`, `IVA_PORCENTAJE_DEFAULT`) | 0 / 15 % |
| Anticipo permitido/defecto | `ANTICIPO_PORCENTAJES_PERMITIDOS`, `…_DEFAULT` | 0 / 50 / 75 % — defecto 50 % |
| Vigencia de cotización | `DIAS_VIGENCIA_DEFAULT` | 15 días |
| Vigencia del enlace público | `ENLACE_EXPIRA_EN` | 30 días |
| Intentos de código / bloqueo | `MAX_INTENTOS_FALLIDOS`, `BLOQUEO_MS` | 5 / 15 min |
| OTP (vigencia, fallos, solicitudes) | `OTP_*` | 10 min / 3 / 5 por hora |
| Métodos de pago | `METODOS_ANTICIPO_PERMITIDOS`, `METODOS_SALDO_PERMITIDOS` | TRANSFERENCIA, EFECTIVO |
| Ventana de alerta de entrega | `alertas.repository.ts` (`INTERVAL '3 days'`) | 3 días |
| Reglas de finalización | `ordenes.service.ts` | avance 100 % + ≥ 1 evidencia |
| Reglas de cierre | `cerrarOrden` | entrega confirmada + saldo validado |
| Tipos de evidencia / tamaño | `uploadsEvidencias.ts`, `uploadsComprobantes.ts` | PDF/JPG/PNG, 5 MB |
| Política de contraseña | `politicaPassword.ts` (backend y frontend, **mantener sincronizados**) | mín. 12 caracteres |

**Revisar según país**: el IVA, los bancos del catálogo (`seed-bancos-catalogo`, entidades de Ecuador), el formato de teléfono (+593) y el campo `ruc`. Si el negocio **no cobra anticipo**, deja `ANTICIPO_PORCENTAJES_PERMITIDOS = [0]`; si **no hay orden de trabajo** (solo cotización), se puede ocultar el módulo de órdenes en el frontend, pero el backend asume su existencia (ver §5).

## 4. Qué tocar, archivo por archivo
**Backend**
- `services/asistenteFormulario.service.ts`: `ContextoNexia`, `NOMBRE_CONTEXTO`, `PREGUNTA_ORIENTATIVA_CONTEXTO`, prompt y respaldo determinístico.
- `services/analisisIa.service.ts`: prompt y `ESQUEMA_RESPUESTA`.
- `services/fichaTecnica.service.ts`: formato de la ficha y regla de inconsistencias.
- `services/solicitudMensajes.service.ts`: prompt de NexIA del chat.
- `services/email.service.ts`: textos y branding de las 5 plantillas.
- `services/cotizaciones.service.ts` (constantes anteriores), `config/openapi.ts` (descripciones de la API).
- `scripts/seed-bancos-catalogo.*`: catálogo financiero del nuevo país.
**Frontend**
- `App.tsx` (landing, servicios, formulario), `index.html`, `public/`, `assets/images`, `index.css` (tokens `@theme`), `lib/config.ts`.
- `AreaPrivada.tsx` si cambian los roles o secciones.
**Infra**
- `docker`/`nginx` (nombres), grupo de variables.

## 5. Dependencias entre módulos (para no romper el flujo al quitar piezas)
- `ordenes` depende de `cotizaciones` (1:1) y estas de `solicitudes`. `fichas_tecnicas`, `ordenes_evidencias`, `alertas` cuelgan de `ordenes`.
- Aceptar una cotización: convierte el lead y puede crear la orden (si no hay anticipo) → quitar órdenes exige tocar `aceptarCotizacionPublica`.
- El dashboard y las alertas leen de `ordenes`.
- Los pagos (`transferencias_pago`) dependen de `cuentas_bancarias` y estas de `bancos_catalogo`; si no cobras por transferencia, puedes dejar sus pantallas ocultas y el flujo sigue con `EFECTIVO`.
- Módulos casi independientes y **fáciles de omitir**: leads/CRM, chat, dashboard, IA, alertas.

## 6. Reglas de trabajo que se heredan (de `CLAUDE.md`)
Conservar el espíritu: **no inventar datos**, etiquetar `[VERIFICADO]/[DECISIÓN]/[PROPUESTA]/[SUPUESTO]/[PENDIENTE]`, **cambio mínimo**, **no adelantar fases**, **no modificar decisiones críticas sin proponerlo**, autorización explícita para commits/instalaciones/SQL de estructura, secretos solo en variables de entorno, pruebas diferenciadas (planificada/ejecutada/resultado), cierre de fase con informe y **detenerse**. Copia `CLAUDE.md` al nuevo repo y cambia: propósito (§1), modelo de datos aprobado (§9, número y nombre de tablas), roles (§11), stack (§6, si cambia) y plan de fases (§24). Congela el documento y entrega las instrucciones por fase en prompts separados.

## 7. Fases sugeridas para el clon (orden probado en este proyecto)
1. Auditoría y preparación (repo, CI, entorno local, BD vacía con V0…V18).
2. Backend base + autenticación + usuarios y roles.
3. Modelo de datos del nuevo negocio (migraciones nuevas sobre la base heredada).
4. Formulario real de solicitudes (público) + clientes + leads.
5. Área privada por rol.
6. Cotizaciones (cálculo, enlace público, aceptación) y pagos.
7. Órdenes de trabajo (avance, evidencias, cierre).
8. IA (asistente, análisis, ficha) con los prompts del nuevo rubro.
9. Alertas, dashboard y automatizaciones.
10. Pruebas, seguridad, documentación y demostración.

## 8. Checklist de clonación
**Repositorio y entorno**
- [ ] Repo nuevo, `README.md` y `CLAUDE.md` adaptados; rebranding hecho.
- [ ] BD creada; V0…V18 aplicadas en orden numérico.
- [ ] `.env` backend/frontend completados; 3 secretos nuevos.
- [ ] Seeders ejecutados con contraseñas propias.
**Negocio**
- [ ] Lista de servicios, textos, imágenes, colores y datos de contacto reemplazados.
- [ ] Prompts de IA, esquema de análisis y ficha técnica reescritos y probados con casos reales.
- [ ] IVA, anticipos, vigencias y métodos de pago ajustados al país/negocio.
- [ ] Catálogo de bancos/cuentas del país; cuentas receptoras cargadas por ADMIN.
- [ ] Plantillas de correo con la marca y remitente verificado.
**Calidad**
- [ ] `npm test` y `tsc` en verde en backend y frontend; recorrido manual del flujo completo con los 3 roles.
- [ ] Revisión de seguridad (`08-seguridad.md`).
**Despliegue**
- [ ] Despliegue (servidores con Docker) y variables de entorno configurados.
- [ ] `schema_migrations` sembrada si la BD no es nueva.
- [ ] Backups de BD y volumen `uploads/`.

## 9. Prompt de arranque para Claude Code en el proyecto nuevo
Copia esto en la primera sesión del repositorio clonado y completa los corchetes:

```text
Contexto: este repositorio es un CLON de NEXTPROJECT (ver docs/clonacion/00-INDICE-Y-GUIA-RAPIDA.md y
CLAUDE.md). Conservamos la arquitectura, los roles (ADMIN, COMERCIAL, OPERATIVO), los flujos y la
infraestructura. Cambia el modelo de negocio.

NUEVO NEGOCIO: [describe a qué se dedica, qué vende, cómo cotiza, si cobra anticipo, si ejecuta
órdenes de trabajo, país/moneda/impuestos].
VOCABULARIO: [solicitud→?, orden→?, evidencia→?, ficha técnica→?, operativo→?].
SERVICIOS: [lista].

Reglas: sigue CLAUDE.md (no inventar, etiquetar [VERIFICADO]/[PROPUESTA]…, cambio mínimo, no adelantar
fases, no commit ni instalar sin autorización). Antes de cambiar nada, lee docs/clonacion/*, inspecciona el
estado real y propón un plan por fases. FASE 1 (solo análisis): inventaría qué partes son específicas del
mecanizado (usa docs/clonacion/10-guia-de-adaptacion.md §1-§4), qué reglas de negocio de §3 hay que
cambiar para este negocio y qué decisiones críticas (§5 de CLAUDE.md) requieren mi aprobación.
Entrega el informe y detente.
```

## 10. Riesgos y consideraciones al clonar
- **Licencias y contenido**: imágenes, textos y marca del original no deben reutilizarse sin permiso; reemplázalos.
- **Datos reales**: no copies la base de datos de producción; usa solo el esquema y los seeders.
- **Credenciales**: nunca copies `.env`, `.local-secrets/` ni variables de entorno del proyecto original.
- **Deuda conocida** heredada (`08-seguridad.md` §límites y `07-frontend.md`): componentes muy grandes, limitadores en memoria, pruebas de integración retiradas.
- **Escalado**: el diseño asume **una instancia** del backend; para varias réplicas hay que externalizar los contadores y el almacenamiento de archivos.
