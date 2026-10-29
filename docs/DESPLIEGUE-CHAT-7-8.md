# Guion de despliegue de #7 y #8 (chat COMERCIAL ↔ OPERATIVO y privacidad de NexIA)

Estado: **preparado y ensayado solo en `nextproject_test` y sobre una copia restaurada**. Nada de esto se ha ejecutado en
producción. Cada paso sobre `nextproject` requiere autorización específica del responsable del proyecto.

No contiene credenciales: las conexiones se indican con marcadores (`<host>`, `<usuario>`, `<base>`). La contraseña se
entrega por `PGPASSWORD` o `.pgpass`, nunca en la línea de comandos ni en un archivo versionado.

## 0. Alcance y piezas

| Pieza | Contenido | Archivo |
|---|---|---|
| V25a | `destinatario_id`, `contenido_privado`, FK e índice parcial (aditiva) | `backend/database/migrations/V25a__solicitud_mensajes_destinatario.sql` |
| V25b | Restricciones `NOT VALID` del destinatario y del texto privado | `V25b__solicitud_mensajes_destinatario_check.sql` |
| V26 | Participantes por hilo (solicitudes sin orden) | `V26__solicitud_mensajes_participantes.sql` |
| V27 | Marcadores de lectura por usuario | `V27__solicitud_mensajes_lecturas.sql` |
| Código | Backend «consciente del esquema» (falla cerrando) y frontend | commits de la rama `feat/cuentas-bancarias` |

Orden obligatorio: **V25a → código nuevo → V25b → V26 → V27**. El esquema es de solo avance: la columna de destinatario
**no se elimina nunca**.

## 1. Decisiones que deben estar tomadas antes de la ventana

| Id | Decisión | Recomendación |
|---|---|---|
| D1 | Respuestas históricas de NexIA (texto en `contenido`, sin destinatario) | Dejarlas ocultas por código (H1); no modificarlas |
| D2 | Fichas técnicas ya generadas | Revisión manual dirigida (F2); no regenerar ni sobrescribir |
| D3 | Contadores de COMERCIAL | C3: hilos donde creó una cotización o escribió. **No implementado todavía** |
| D4 | Fecha de corte de los contadores y duración del periodo en sombra | Corte al activar; sombra de 14 días |
| D5 | Barrera en la base de datos contra instancias antiguas | Cuenta de base de datos dedicada (requiere autorización aparte) |
| D6 | Datos sintéticos en producción para verificar | No: se ensaya en copia restaurada |

**Regla de activación (hallazgo del ensayo):** con `CHAT_PARTICIPANTES_MODO` en sombra y los contadores activos, un
OPERATIVO acumula pendientes de **todos** los hilos sin orden donde COMERCIAL escribió tras la fecha de corte (en la base de
pruebas: 109 hilos). Por eso **los contadores no deben activarse mientras el modo sea sombra**: se activan después de pasar a
estricto (y, para COMERCIAL, con la regla C3 aprobada e implementada).

## 2. Requisitos previos (todos deben cumplirse)

1. Autorización escrita de la ventana, de las migraciones y de las operaciones de lectura que se listan abajo.
2. Respaldo `pg_dump -Fc` de `nextproject` y una **restauración de prueba** en una base de ensayo (nunca en producción).
3. Ensayo completo en una copia restaurada (ver §7): migraciones, restricciones, reversión y comprobaciones.
4. Pruebas del repositorio en verde: `tsc` limpio en `backend` y `frontend`; `npm test` y `npm run test:integration` en
   `backend`; `npx vitest run` en `frontend`.
5. Compilaciones anteriores a este cambio retiradas de los artefactos de despliegue y marcadas «no desplegar».
6. Aviso a los usuarios del cierre temporal del chat.
7. Variables del despliegue nuevo: `CHAT_PARTICIPANTES_MODO` **sin definir** (= sombra) y `CHAT_PENDIENTES_DESDE`
   **sin definir** (= contadores inactivos). No se cambia ninguna otra configuración.

## 3. Comprobaciones de solo lectura (cada una requiere autorización en producción)

Sustituye `<base>` por la base objetivo. Todas son `SELECT` y no modifican nada.

**3.1 Nivel de esquema**
```sql
SELECT (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'solicitud_mensajes'
          AND column_name IN ('destinatario_id', 'contenido_privado')) AS columnas_v25a,
       to_regclass('public.solicitud_mensajes_participantes') AS v26,
       to_regclass('public.solicitud_mensajes_lecturas') AS v27;
```
Antes de empezar se espera `0, NULL, NULL`.

**3.2 Huella de instancias (control central)**
```sql
SELECT coalesce(nullif(application_name, ''), '(sin marca)') AS marca, count(*) AS conexiones
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
GROUP BY 1 ORDER BY 1;
```
La versión nueva declara `nextproject-api-r0`. **Cualquier fila `(sin marca)` o con otro nombre es una instancia
anterior o ajena y detiene el procedimiento.** Control negativo ensayado: una conexión sin `application_name` aparece como
`(sin marca)`.

**3.3 Atributos de la cuenta de la aplicación**
```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```
Determina si una política de seguridad por fila serviría como respaldo (no sirve si es superusuario o salta las políticas).

**3.4 Estado de las restricciones tras V25b**
```sql
SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('chk_solicitud_mensajes_destinatario', 'chk_solicitud_mensajes_contenido_privado') ORDER BY 1;
```
Se espera `convalidated = false` en ambas. **No ejecutar `VALIDATE CONSTRAINT`** (fallaría por las respuestas históricas).

**3.5 Fichas técnicas candidatas a revisión manual (solo identificadores, sin contenido)**
```sql
SELECT f.id AS ficha_id, o.codigo AS orden, count(*) AS respuestas_nexia_previas
FROM fichas_tecnicas f
JOIN ordenes o ON o.id = f.orden_id
JOIN cotizaciones c ON c.id = o.cotizacion_id
JOIN solicitud_mensajes m ON m.solicitud_id = c.solicitud_id AND m.autor_tipo = 'NEXIA' AND m.creado_en < f.generado_en
GROUP BY f.id, o.codigo ORDER BY o.codigo;
```

**3.6 Cobertura de participantes para salir del modo sombra (hilos con actividad reciente sin COMERCIAL participante)**
```sql
SELECT count(DISTINCT m.solicitud_id) AS hilos_sin_comercial_participante
FROM solicitud_mensajes m
WHERE m.creado_en >= now() - interval '30 days' AND m.autor_tipo IN ('COMERCIAL', 'OPERATIVO')
  AND NOT EXISTS (SELECT 1 FROM ordenes o JOIN cotizaciones c ON c.id = o.cotizacion_id WHERE c.solicitud_id = m.solicitud_id)
  AND NOT EXISTS (SELECT 1 FROM solicitud_mensajes_participantes p
                  JOIN usuarios u ON u.id = p.usuario_id AND u.activo
                  JOIN roles r ON r.id = u.rol_id AND r.nombre = 'COMERCIAL'
                  WHERE p.solicitud_id = m.solicitud_id AND p.retirado_en IS NULL);
```

> El conteo de mensajes históricos de NexIA en producción **no** está autorizado y no forma parte de este guion.

## 4. Secuencia de la ventana

| Paso | Acción | Puerta antes de continuar |
|---|---|---|
| 1 | Cerrar el servicio de API (el chat queda sin atender) | Puerto de la API libre; ningún proceso del backend (`netstat`/administrador de tareas) |
| 2 | Ejecutar 3.2 | **Cero** conexiones de la cuenta de la aplicación |
| 3 | Ejecutar 3.1 y verificar respaldo | `0, NULL, NULL`; respaldo restaurable |
| 4 | Arrancar el backend nuevo contra el esquema actual | Un único proceso escuchando; las respuestas de NexIA no aparecen en las listas (modo R0: columna ausente) |
| 5 | Ejecutar 3.2 | Solo `nextproject-api-r0` |
| 6 | Aplicar V25a | Sin error; ejecutar 3.1 → `2, NULL, NULL`; el backend detecta el esquema en ≤30 s (o se reinicia) |
| 7 | Ejecutar 3.2 de nuevo | Solo `nextproject-api-r0` |
| 8 | Aplicar V25b | 3.4 → ambas `false` |
| 9 | Aplicar V26 y V27 | 3.1 → `2, <tabla>, <tabla>` |
| 10 | Controles de reapertura (§5) | Todos cumplidos |
| 11 | Reabrir el chat | Autorización expresa |

Aplicación de cada archivo (con la contraseña por `PGPASSWORD`):
```
psql -v ON_ERROR_STOP=1 -h <host> -U <usuario> -d <base> -f backend/database/migrations/<archivo>.sql
```
Cada migración usa `lock_timeout = 5s` y una transacción: si no obtiene el bloqueo, falla sin cambios y se reintenta.
Tiempos del ensayo (base pequeña): 146–335 ms por migración; la restauración del respaldo tardó 1,4 s.

## 5. Controles de reapertura del chat (todos deben cumplirse)

1. Solo atiende la versión nueva: 3.2 limpio y un único listener, repetidos justo antes de reabrir.
2. Estado del catálogo esperado (3.1 y 3.4).
3. ADMIN recibe 403 en lectura, envío, pendientes, leídos y participantes del chat (matriz automática:
   `backend/src/routes/chatMatrizEndpoints.integration.test.ts`).
4. Aislamiento de NexIA: una respuesta de un usuario no aparece para otro. En producción solo se comprueba con evidencia del
   ensayo (no se crean datos sintéticos allí).
5. La ficha técnica nueva usa solo mensajes compartidos (prueba de integración del ensayo).
6. Los registros del servidor no contienen contenido de mensajes (solo usuario, solicitud, operación y fecha).
7. Respaldo íntegro y compilación de reversión localizable.
8. Autorización expresa del responsable del proyecto.

## 6. Recuperación si algo falla

| Situación | Acción | Privacidad |
|---|---|---|
| Falla antes de V25a (arranque, esquema) | Cerrar el chat; volver a la compilación anterior solo si 3.1 da `0` columnas (aún no existen respuestas privadas) | Sin respuestas privadas nuevas |
| Falla V25a | La transacción se revierte sola; verificar 3.1; reintentar o dejar el chat cerrado | Igual |
| Falla después de V25a | Volver **solo** a esta versión o posterior; **nunca** a una anterior. La columna se conserva | El código filtra por destinatario y el texto privado no está en `contenido` |
| V25b bloquea o molesta | Abortar, o `ALTER TABLE solicitud_mensajes DROP CONSTRAINT chk_solicitud_mensajes_destinatario, DROP CONSTRAINT chk_solicitud_mensajes_contenido_privado;` | Sin efecto: el filtro es por código |
| V26 / V27 | `DROP TABLE solicitud_mensajes_participantes;` / `DROP TABLE solicitud_mensajes_lecturas;` y volver a la versión anterior de esta rama | Los mensajes no se tocan |
| Aparece una conexión `(sin marca)` | Cerrar el chat; identificar y detener el origen. Terminar conexiones ajenas requiere autorización específica | Se corta la exposición antes de reabrir |
| Regresión grave que obligue a una compilación anterior a este cambio | **No hacerlo** salvo con la barrera D5 activa; mantener el chat cerrado y corregir hacia delante | Es el caso que D5 cubre |

Reversión ensayada en la copia restaurada: tras `DROP TABLE` de V27 y V26 y retirar las dos restricciones de V25b, los
mensajes quedaron intactos y las columnas de V25a se conservaron.

## 7. Ensayo realizado (copia restaurada del respaldo de la base de pruebas previo a V25)

- Base nueva `nextproject_ensayo` (copia local; no es producción ni `nextproject_test`).
- Se añadieron 3 respuestas históricas de NexIA **antes** de V25a para ensayar la convivencia con `NOT VALID`.
- V25a, V25b, V26 y V27 aplicadas en orden sin errores. Las 3 respuestas históricas quedaron intactas, sin destinatario.
- Ambas restricciones quedaron con `convalidated = false`; `VALIDATE CONSTRAINT` falla como se documentó.
- Una inserción con el formato anterior (respuesta de NexIA sin destinatario) es rechazada por la base: una instancia
  antigua no puede crear respuestas privadas nuevas.
- Reversión sin pérdida de mensajes.
- Consulta de pendientes con 200.364 mensajes sintéticos en 5.000 solicitudes (transacción revertida, sin datos
  persistentes): 94–173 ms. El plan usa un barrido paralelo de `solicitud_mensajes`; si el volumen real fuera mucho mayor
  convendría un índice por fecha de creación (decisión futura, no incluida).

## 8. Después del despliegue

1. **Periodo en sombra** (propuesta: 14 días). Se vigila el registro `CHAT_ACCESO_SOMBRA_DENEGADO` (usuario, solicitud,
   operación y fecha; nunca contenido) y la comprobación 3.6.
2. **Condición de salida a estricto**: duración cumplida; 3.6 en cero salvo excepciones aprobadas; sin accesos denegados
   legítimos sin explicar en los últimos 7 días; reclamo e incorporación comprobados; interruptor para volver a sombra
   probado; aprobación expresa por escrito. Las conversaciones sin reclamar quedan **inactivas** (sin acceso) con sus mensajes
   intactos y siguen siendo reclamables por cualquier COMERCIAL.
3. **Contadores**: se activan definiendo `CHAT_PENDIENTES_DESDE` (fecha de corte = momento de activación) **después** de pasar
   a estricto y, para COMERCIAL, con la regla C3 aprobada e implementada. Los mensajes anteriores a la fecha de corte quedan
   sin estado de lectura.
4. **Fichas técnicas ya generadas**: revisión manual dirigida con la lista de 3.5; no se regeneran ni se sobrescriben.
5. **Respuestas históricas de NexIA**: permanecen sin modificar (ocultas por código). Riesgo residual: una instancia anterior
   que lea la base puede mostrar su texto; se cubre con 3.2 y, si se aprueba, con la barrera D5.
