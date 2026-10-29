-- =====================================================================
-- NEXTPROJECT — Migración V25a: destinatario de las respuestas de NexIA (#8, parte aditiva)
-- Privacidad de NexIA: cada respuesta de NexIA pertenece al usuario que la invocó (`destinatario_id`) y solo él
-- puede verla. Esta parte es ADITIVA y no cambia el comportamiento del código anterior (que ignora la columna).
--
--  - Columna `destinatario_id` NULL: los mensajes de personas la dejan NULL; las respuestas históricas de NexIA
--    quedan con NULL y NO se les infiere ningún destinatario (permanecen ocultas para todos, ver V25b).
--  - Columna `contenido_privado` NULL: el TEXTO de una respuesta privada de NexIA se guarda aquí y en `contenido` queda
--    un marcador neutro. Así una versión anterior del backend (que lee `contenido` y no conoce el destinatario) nunca
--    puede mostrar el texto privado: la privacidad no depende de que todas las instancias filtren por destinatario.
--  - FK a usuarios con ON DELETE RESTRICT, igual que el resto de columnas de actor del modelo.
--  - Índice parcial solo para las respuestas de NexIA (búsqueda por solicitud y destinatario).
--
-- ESQUEMA DE SOLO AVANCE: esta columna NO se elimina nunca. Una reversión del despliegue consiste en volver a una
-- versión del código consciente del esquema (R0 o posterior), no en deshacer esta migración: eliminarla haría que
-- las respuestas privadas dejaran de poder atribuirse a su destinatario.
--
-- No modifica filas existentes. No crea tablas.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE solicitud_mensajes
  ADD COLUMN IF NOT EXISTS destinatario_id UUID,
  ADD COLUMN IF NOT EXISTS contenido_privado TEXT;

ALTER TABLE solicitud_mensajes
  ADD CONSTRAINT fk_solicitud_mensajes_destinatario
  FOREIGN KEY (destinatario_id) REFERENCES usuarios(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_solicitud_mensajes_nexia_destinatario
  ON solicitud_mensajes (solicitud_id, destinatario_id, creado_en)
  WHERE autor_tipo = 'NEXIA';

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V25a
-- =====================================================================
