# Guía de clonación de NEXTPROJECT para otro modelo de negocio

> Documentación para **replicar este sistema** (misma infraestructura, flujos, roles y reglas) y adaptarlo a otro negocio.
> Todo lo marcado **[VERIFICADO]** se comprobó contra el código, la base de datos o el pipeline reales del repositorio (rama `feat/cuentas-bancarias`, migraciones V0–V18). Lo marcado **[SUPUESTO]** o **[PENDIENTE]** no está demostrado en el repo.

## Qué es el sistema en una frase
Plataforma web de **captación → análisis asistido por IA → cotización con enlace seguro → cobro por anticipo/saldo → orden de trabajo → entrega y cierre**, con tres roles internos (`ADMIN`, `COMERCIAL`, `OPERATIVO`) y un cliente externo que **no inicia sesión**: interactúa solo por enlaces firmados.

El proceso es genérico para **cualquier negocio que cotiza y ejecuta trabajos por encargo** (talleres, ingeniería, instalación, mantenimiento, imprenta, carpintería, servicios técnicos…). Lo específico del mecanizado industrial está acotado (ver `10-guia-de-adaptacion.md`).

## Índice
| Archivo | Contenido |
|---|---|
| `00-INDICE-Y-GUIA-RAPIDA.md` | Este archivo: visión rápida y plan de clonación |
| `01-vision-y-modulos.md` | Módulos funcionales, actores y alcance |
| `02-arquitectura-y-stack.md` | Stack, capas, estructura de carpetas, convenciones de código |
| `03-modelo-de-datos.md` | 16 tablas, columnas, restricciones, índices y triggers (**generado desde la BD real**) |
| `04-roles-y-permisos.md` | Matriz de roles, endpoints (API) y reglas de autorización |
| `05-flujos-de-negocio.md` | Máquinas de estado y reglas: solicitud, cotización, pagos, orden, leads, alertas |
| `06-ia-y-correo.md` | Integración con IA (Gemini) y correo (Brevo): qué hace, límites, prompts |
| `07-frontend.md` | Estructura del frontend, navegación, vistas por rol, sistema de diseño |
| `08-seguridad.md` | Controles implementados (OWASP), límites conocidos y deuda |
| `09-infraestructura-y-despliegue.md` | Docker, nginx, variables de entorno, migraciones y seeders |
| `10-guia-de-adaptacion.md` | **Qué cambiar para tu negocio**, plan paso a paso, checklist y prompt de arranque |

Documentos del repo que complementan esto: [`README.md`](../../README.md), [`CLAUDE.md`](../../CLAUDE.md) (reglas de desarrollo), [`docs/CHANGELOG-SEGURIDAD.md`](../CHANGELOG-SEGURIDAD.md), [`docs/fases/`](../fases/).

## Plan de clonación en 10 pasos (resumen)
1. **Copiar el repositorio** a un repo nuevo (sin historial si se prefiere) y renombrar marca, nombre de paquetes y textos (`10`, §1).
2. **Decidir el vocabulario del nuevo negocio**: qué es una *solicitud*, un *servicio*, una *orden*, un *evidencia*. Mantener los nombres técnicos de tablas/estados y cambiar solo etiquetas visibles (recomendado, `10` §2).
3. **Crear la BD vacía** `nextproject` (o el nombre nuevo) y aplicar **V0…V18 en orden numérico** (`09`).
4. **Ejecutar los seeders** (roles + usuarios + catálogo de bancos si aplica) con contraseñas propias.
5. **Configurar `.env`** del backend y del frontend a partir de los `.env.example` (`09` §variables). Generar 3 secretos distintos para JWT y enlaces.
6. **Adaptar lo específico del negocio**: lista de servicios, textos de landing/formulario, prompts de IA, plantilla de ficha técnica, correos (`10`).
7. **Crear la cuenta de IA y de correo** (Gemini, Brevo) y verificar el remitente.
8. **Probar en local** (`npm test` en backend y frontend; recorrido manual del flujo completo).
9. **Montar el despliegue** (servidores con Docker) (`09`).
10. **Congelar las reglas del proyecto** con un `CLAUDE.md` propio derivado del actual (`10` §6) y trabajar por fases.

## Qué obtienes tal cual (sin tocar)
- Autenticación JWT con roles, sesiones revocables y cambio de contraseña con política de fortaleza.
- Cotizaciones con cálculo de IVA/anticipo/saldo, vigencia, enlace público firmado y código de acceso (con bloqueo por intentos y recuperación por OTP).
- Gestión de pagos por transferencia con comprobantes y cuentas receptoras con catálogo de bancos.
- Órdenes de trabajo con avance, evidencias, ficha técnica por IA, entrega y cierre con precondiciones.
- Mini-CRM de leads, alertas por fechas de entrega, dashboard de supervisión, chat interno con asistente IA.
- Pipeline CI/CD con pruebas, migraciones automáticas, despliegue por SSH y volúmenes para archivos.

## Qué NO existe (para no asumirlo)
- Facturación electrónica, pagos en línea (pasarela), inventario, nómina, notificaciones push, multiempresa/multi-tenant, roles de cliente con login, ORM, Python, ni scheduler (los vencimientos se calculan "perezosamente" al leer). **[VERIFICADO]**
- Las pruebas de integración contra PostgreSQL se **retiraron del flujo** (quedan 21 archivos sin ejecutar); hoy solo hay pruebas unitarias. **[VERIFICADO]**
