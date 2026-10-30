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
| 4 | Cotizaciones: tabla de productos, buscador y PDF | #3 | **Completado y verificado en `nextproject_test`** (V28 NO aplicada en `nextproject` ni en producción) | Líneas de detalle (`cotizacion_items`), importes calculados en el backend, buscador de conceptos ya usados, búsqueda global por descripción de línea, hoja/PDF y pantalla pública con líneas, línea derivada para borradores históricos | Backend: `cotizacionItems.test.ts` (11), `cotizacionesLineas.service.test.ts` (18), `busqueda.service.test.ts` (+3), **`cotizacionItems.integration.test.ts` (14, ejecutadas con V28 real: 14 de 14)**; frontend `lineasCotizacion.test.ts` (7), `LineasCotizacion.test.tsx` (3), `hojaCotizacion.test.ts` | Navegador (localhost, BD `nextproject_test`): crear con sugerencias, vista previa = valor guardado, editar, detalle COMERCIAL y ADMIN, línea derivada de histórica, pantalla pública (375 px sin desborde) y hoja imprimible con líneas | Aplicar V28 en `nextproject` y en producción con respaldo y autorización; el diálogo de impresión del navegador no se automatiza |
| 5 | Fecha de vencimiento de la cotización y aviso de enlace caducado | #4/#5 (`a4b6036`) | **Completado** | «Fecha de caducidad» en el detalle interno; el enlace caducado responde «Esta cotización caducó. Consulte con su asesor comercial.»; aviso interno en VENCIDA | `caducidadCotizacion.test.ts` (4), `enlacePublicoEstados.integration.test.ts` (2), `cotizacionesComprobantesPublicos.test.ts` | Cliente: vigencia y mensaje de caducidad (HTTP 410); interno: aviso en VENCIDA | — |
| 6 | Vencimiento automático; botones «Marcar vencida» y «Cancelar»; estado correspondiente | #4/#5 (`a4b6036`) | **Completado** | Una cotización ENVIADA vence sola al cumplirse su fecha (se marca VENCIDA al consultarla); se retira «Marcar vencida»; «Cancelar» disponible en ENVIADA y ausente en VENCIDA y CANCELADA; explicación por estado | `caducidadCotizacion.test.ts`, `enlacePublicoEstados.integration.test.ts` | Una ENVIADA con vigencia pasada pasó a VENCIDA al abrir su enlace; sin «Marcar vencida»; «Cancelar» presente en ENVIADA y ausente en VENCIDA y CANCELADA | — |
| 7 | Quitar el WhatsApp fijo de la pantalla pública del cliente | #10 (`97fc02b`) | **Completado** | Se retira «WhatsApp: +593…»; se conserva el botón «Hablar con un asesor» | `PieCotizacionPublica.test.tsx` (4) | Pantalla pública sin el número y con el botón | — |
| 8 | Números de solicitud y cotización en la lista de órdenes | #11 (`4f3db20`) | **Completado** | Columnas SOL/COT (tabla y tarjetas), «—» si el registro es anterior a la numeración | `referenciasOrden.test.ts` (1), `ordenesOrigen.integration.test.ts` (3) | COMERCIAL, ADMIN y OPERATIVO; órdenes con y sin números | — |
| 9 | Estado operativo debajo de «Responsable» | #2 (`0bc89a3`) | **Completado** | Bloque «Estado a gestionar por Operativo» con estado y siguiente acción | `estadoOperativo.test.ts` (5) | 5 estados, 3 roles | Sin órdenes PAUSADAS en los datos de prueba |
| 10 | Selección y carga de archivos de evidencia | #6 (`56c7592`) | **Completado** | Selector con vista previa, cambiar/quitar, validación previa y límites de 5 fotos y 2 PDF | `ComprobanteUploader.test.tsx` (3) y límites del backend | OPERATIVO y ADMIN, escritorio y 375 px; subida y límites | — |
| 11 | Búsqueda de órdenes por número de cotización y columnas | #1 (`879caeb`) | **Completado** | Búsqueda con prefijo y número sin ceros (`cot-4099`, `sol 4836`, `ord 182`) | `busquedaPatron.test.ts` (11), `busqueda.test.ts` (9), `busquedaServidor.test.ts` (4) | Búsquedas con y sin resultados en los tres roles | — |

Los requerimientos 8 y 11 comparten las columnas de órdenes: la columna SOL/COT (8) se construyó una sola vez y la búsqueda (11)
la consulta; no se duplicó trabajo en esta fase.

## 2. Requerimiento 4: estado tras aprobar la alternativa A

**Implementado en código (sin migrar):** `cotizacion_items` (V28, preparada), cálculo exacto en el backend (cantidad hasta 3 decimales,
precio >= 0, subtotal = redondeo a 2 decimales mitad hacia arriba igual que PostgreSQL), IVA global 0/15 sin cambios, escritura de
líneas e importes en una sola transacción con bloqueo de la fila y validación de BORRADOR, trigger que impide tocar líneas fuera de
BORRADOR, buscador compartido COMERCIAL/ADMIN solo sobre cotizaciones ENVIADA/ACEPTADA/RECHAZADA/VENCIDA, búsqueda global por
descripción de línea, límites 50 líneas / 200 caracteres, hoja/PDF y pantalla pública con descripción, cantidad, precio unitario
y subtotal.

**Compatibilidad:** mientras V28 no exista, la API y el formulario se comportan como antes (campo `valor`). Una vez aplicada, el
POST/PATCH por HTTP exige `items`; el único consumidor real en el repositorio es `GestionCotizaciones.tsx` (no se detectaron
integraciones externas). Las cotizaciones históricas no se modifican; un borrador histórico se muestra con una línea derivada y
editable, y no se guarda nada hasta que el usuario confirma.

**Verificación con V28 real (29/10/2026, `nextproject_test`, localhost):** V28 aplicada solo en `nextproject_test` (servidor local,
usuario `postgres`, base confirmada con `current_database()`); no se tocó `nextproject` ni producción. Antes y después de aplicarla, la
huella (md5) de las 5357 cotizaciones existentes fue idéntica y se mantuvo idéntica tras todas las pruebas y la verificación en
navegador: las cotizaciones históricas no cambiaron. Las 14 pruebas de integración pasaron (una falló por un defecto de la propia
prueba —el PATCH no indicaba `anticipo_porcentaje: 0—` y se corrigió). La verificación en navegador encontró dos defectos de interfaz
que se corrigieron: el editor usaba colores del tema claro (ilegible en el tema oscuro) y el detalle de ADMIN no mostraba la tabla
de líneas; además la tabla pública se desbordaba a 375 px (ahora cabe). En el navegador: la vista previa del formulario
(127,68 / IVA 19,15 / total 146,83) coincidió al céntimo con lo que guardó el backend (anticipo 73,42 / saldo 73,41), incluido el
redondeo 2,675 × 1,00 = 2,68.

**Pendiente (fuera de este alcance):** aplicar V28 en `nextproject` y en producción (con respaldo y autorización expresa) y prueba de
la hoja con el diálogo de impresión del navegador (no automatizable).

## 3. Resultados de las pruebas (29/10/2026, localhost)

| Conjunto | Resultado |
|---|---|
| `tsc` backend y frontend | Limpio |
| Backend unitarias | 312 de 312 |
| Backend integración (`nextproject_test`, con V28) | 285 de 285 |
| Frontend | 203 de 203 |
| Build de Vite | Correcto |

Límites de las verificaciones: el diálogo de impresión del navegador no se puede automatizar; se comprobó la lógica de impresión
(clase del documento, título y limpieza al terminar), el diseño aplicando las reglas de impresión como pantalla y la conversión
a PDF queda del lado del navegador del usuario. Los requerimientos 1 y 2 siguen pendientes de producción por decisión
expresa: migraciones, barrera de credenciales, fecha de corte y modo estricto requieren autorización específica.
