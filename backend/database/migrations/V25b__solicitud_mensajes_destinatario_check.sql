-- =====================================================================
-- NEXTPROJECT — Migración V25b: integridad del destinatario de NexIA (#8)
-- Se aplica DESPUÉS de V25a y solo cuando se ha comprobado que ya solo atiende código consciente del esquema (R0 o
-- posterior): con esta restricción, un backend anterior no podría guardar respuestas de NexIA (no declara destinatario).
--
--   respuesta de NexIA  -> destinatario_id y contenido_privado obligatorios
--   mensaje de persona  -> destinatario_id y contenido_privado NULL
--
-- NOT VALID: la regla se exige a las filas nuevas o modificadas, pero NO se revisan las filas existentes. Así las
-- respuestas históricas de NexIA (sin destinatario) conviven con la restricción sin inventarles un destinatario.
-- NO se debe ejecutar VALIDATE CONSTRAINT: fallaría precisamente por esas respuestas históricas.
-- Consecuencia conocida: una fila histórica de NexIA no puede modificarse con UPDATE (hoy no existe ningún UPDATE
-- sobre solicitud_mensajes en el código).
--
-- Reversión sin pérdida de datos: ALTER TABLE solicitud_mensajes DROP CONSTRAINT chk_solicitud_mensajes_destinatario, DROP CONSTRAINT chk_solicitud_mensajes_contenido_privado;
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE solicitud_mensajes
  ADD CONSTRAINT chk_solicitud_mensajes_destinatario CHECK (
    (autor_tipo = 'NEXIA' AND destinatario_id IS NOT NULL)
    OR (autor_tipo <> 'NEXIA' AND destinatario_id IS NULL)
  ) NOT VALID;

ALTER TABLE solicitud_mensajes
  ADD CONSTRAINT chk_solicitud_mensajes_contenido_privado CHECK (
    (autor_tipo = 'NEXIA' AND contenido_privado IS NOT NULL AND btrim(contenido_privado) <> '')
    OR (autor_tipo <> 'NEXIA' AND contenido_privado IS NULL)
  ) NOT VALID;

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V25b
-- =====================================================================
