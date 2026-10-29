# Matriz de los 11 requerimientos de NEXTPROJECT

Estado a **29/10/2026**, rama `feat/cuentas-bancarias`. Todo se verificó en localhost (frontend 5178, backend 3300, base
`nextproject_test`). Nada se desplegó ni se aplicó en producción.

**Numeración.** La lista que se usa aquí es la última entregada. En informes y commits anteriores los mismos trabajos
aparecían con otro número (columna «Etiqueta en commits»); se conserva esa etiqueta para poder localizarlos con `git log`.

## 1. Matriz

| # | Requerimiento | Etiqueta en commits | Estado | Implementado | Pruebas que lo respaldan | Verificación en navegador | Falta |
|---|---|---|---|---|---|---|---|
| 1 | Icono de mensajes COMERCIAL ↔ OPERATIVO en solicitudes | #7 (`8c4fcab`) y #7/#8 (`9a86543`, `090da4b`, `c437a33`) | **Completado** (en local) | Icono que abre la conversación; ahora solo aparece con mensajes pendientes y muestra su cantidad; ADMIN sin icono ni chat; participantes, lecturas independientes y contadores (C3 para COMERCIAL) | `mensajesPendientes.test.ts` (4), `chatAcceso.test.ts` (1), `chatParticipantesLecturas.integration.test.ts` (22), `chatMatrizEndpoints.integration.test.ts` (12) | COMERCIAL, OPERATIVO (escritorio y 375 px) y ADMIN | Producción: aplicar migraciones, fecha de corte y estricto (requieren autorización) |
| 2 | Privacidad de las respuestas de NexIA | #8 (`9a86543`, `090da4b`) | **Completado** (en local) | Respuesta privada para su destinatario, texto en `contenido_privado`, históricas ocultas, contexto de NexIA y ficha sin respuestas privadas, carreras corregidas | `chatPrivacidad.integration.test.ts` (10), `chatEsquema.test.ts` (4), carreras en `chatParticipantesLecturas...` y matriz de endpoints | COMERCIAL A/B, OPERATIVO y ADMIN | Producción (migraciones V25a/b, barrera de credenciales); revisión manual de fichas antiguas |
| 3 | Eliminar «Usar ID de solicitud directamente» | #9 (`12d1c1c`) | **Completado** | Texto y opción retirados de la creación de cotizaciones | Sin prueba automática (retiro de texto); búsqueda sin coincidencias en el código | Formulario «Nueva cotización» sin esa opción (hoy) | — |
| 4 | Cotizaciones: tabla de productos, buscador y PDF | #3 | **Parcial** | **Ahora:** impresión / PDF de la cotización (hoja formal con importes oficiales, botón en la pantalla pública del cliente y en el detalle interno de COMERCIAL y ADMIN). Sin dependencias ni cambios de esquema | `hojaCotizacion.test.ts` (8), `HojaCotizacionImprimible.test.tsx` (2) | Botón y hoja en cliente, COMERCIAL y ADMIN; diseño de impresión; 375 px | **Tabla de productos y buscador**: requieren modelo de datos nuevo (ver §2) y tu autorización |
| 5 | Fecha de vencimiento de la cotización y aviso de enlace caducado | #4/#5 (`a4b6036`) | **Completado** | «Fecha de caducidad» en el detalle interno; el enlace caducado responde «Esta cotización caducó. Consulte con su asesor comercial.»; aviso interno en VENCIDA | `caducidadCotizacion.test.ts` (4), `enlacePublicoEstados.integration.test.ts` (2), `cotizacionesComprobantesPublicos.test.ts` | Cliente: vigencia y mensaje de caducidad (HTTP 410); interno: aviso en VENCIDA | — |
| 6 | Vencimiento automático; botones «Marcar vencida» y «Cancelar»; estado correspondiente | #4/#5 (`a4b6036`) | **Completado** | Una cotización ENVIADA vence sola al cumplirse su fecha (se marca VENCIDA al consultarla); se retira «Marcar vencida»; «Cancelar» disponible en ENVIADA y ausente en VENCIDA y CANCELADA; explicación por estado | `caducidadCotizacion.test.ts`, `enlacePublicoEstados.integration.test.ts` | Una ENVIADA con vigencia pasada pasó a VENCIDA al abrir su enlace; sin «Marcar vencida»; «Cancelar» presente en ENVIADA y ausente en VENCIDA y CANCELADA | — |
| 7 | Quitar el WhatsApp fijo de la pantalla pública del cliente | #10 (`97fc02b`) | **Completado** | Se retira «WhatsApp: +593…»; se conserva el botón «Hablar con un asesor» | `PieCotizacionPublica.test.tsx` (4) | Pantalla pública sin el número y con el botón | — |
| 8 | Números de solicitud y cotización en la lista de órdenes | #11 (`4f3db20`) | **Completado** | Columnas SOL/COT (tabla y tarjetas), «—» si el registro es anterior a la numeración | `referenciasOrden.test.ts` (1), `ordenesOrigen.integration.test.ts` (3) | COMERCIAL, ADMIN y OPERATIVO; órdenes con y sin números | — |
| 9 | Estado operativo debajo de «Responsable» | #2 (`0bc89a3`) | **Completado** | Bloque «Estado a gestionar por Operativo» con estado y siguiente acción | `estadoOperativo.test.ts` (5) | 5 estados, 3 roles | Sin órdenes PAUSADAS en los datos de prueba |
| 10 | Selección y carga de archivos de evidencia | #6 (`56c7592`) | **Completado** | Selector con vista previa, cambiar/quitar, validación previa y límites de 5 fotos y 2 PDF | `ComprobanteUploader.test.tsx` (3) y límites del backend | OPERATIVO y ADMIN, escritorio y 375 px; subida y límites | — |
| 11 | Búsqueda de órdenes por número de cotización y columnas | #1 (`879caeb`) | **Completado** | Búsqueda con prefijo y número sin ceros (`cot-4099`, `sol 4836`, `ord 182`) | `busquedaPatron.test.ts` (11), `busqueda.test.ts` (9), `busquedaServidor.test.ts` (4) | Búsquedas con y sin resultados en los tres roles | — |

Los requerimientos 8 y 11 comparten las columnas de órdenes: la columna SOL/COT (8) se construyó una sola vez y la búsqueda (11)
la consulta; no se duplicó trabajo en esta fase.

## 2. Requerimiento 4: lo que falta y su propuesta

**Hecho (impresión / PDF):** hoja de cotización generada con el navegador («Guardar como PDF»), sin dependencias nuevas ni cambios
de esquema. Usa solo importes ya calculados por el backend; no incluye código de acceso, enlaces, datos bancarios ni teléfonos.
Tiene una tabla de conceptos de una fila (la cotización actual es un único concepto), lista para admitir varias.

**Pendiente (requiere autorización: cambia el modelo de datos y las reglas de creación de cotizaciones):** la tabla de productos y
el buscador. Hoy una cotización guarda un único `valor` (subtotal), IVA, total y una nota de texto; no existe un catálogo ni
líneas de detalle.

| Alternativa | Qué implica | Riesgos |
|---|---|---|
| **A (recomendada): líneas de detalle por cotización** (`cotizacion_items`: concepto, cantidad, precio unitario y subtotal como fotografía del momento) y subtotal = suma de líneas | Una tabla nueva (CLAUDE.md §9 exige aprobación) y cambio de la creación/edición de cotizaciones; la hoja imprimible ya admite varias filas. El «buscador» sería sobre los conceptos ya usados (sin catálogo) | Cambia cómo se calcula el subtotal (regla de negocio): hay que decidir si el valor manual sigue permitido y qué pasa con las cotizaciones históricas (sin líneas) |
| B: líneas de detalle más catálogo de productos (`productos`) con buscador | Dos tablas nuevas, administración del catálogo, permisos y precios de referencia | Mayor alcance y decisiones de negocio (quién mantiene precios, impuestos por producto, unidades) |
| C: texto libre en la nota de la cotización | Sin cambios de esquema | No cumple «tabla» ni «buscador»; los datos no son estructurados |

**Decisiones funcionales que necesito de ti:** alternativa (A, B o C); si el subtotal pasa a calcularse siempre desde las líneas;
tratamiento de cotizaciones históricas sin líneas (mostrar una sola línea con el `valor` actual); quién puede editar líneas y
hasta qué estado; y si el catálogo (B) es necesario ahora.

## 3. Resultados de las pruebas (29/10/2026, localhost)

| Conjunto | Resultado |
|---|---|
| `tsc` backend y frontend | Limpio |
| Backend unitarias | 280 de 280 |
| Backend integración (`nextproject_test`) | 271 de 271 |
| Frontend | 192 de 192 |
| Build de Vite | Correcto |

Límites de las verificaciones: el diálogo de impresión del navegador no se puede automatizar; se comprobó la lógica de impresión
(clase del documento, título y limpieza al terminar), el diseño aplicando las reglas de impresión como pantalla y la conversión
a PDF queda del lado del navegador del usuario. Los requerimientos 1 y 2 siguen pendientes de producción por decisión
expresa: migraciones, barrera de credenciales, fecha de corte y modo estricto requieren autorización específica.
