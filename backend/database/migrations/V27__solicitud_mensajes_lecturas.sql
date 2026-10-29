-- =====================================================================
-- NEXTPROJECT — Migración V27: marcadores de lectura del chat (#7)
-- Registra, por usuario y solicitud, hasta qué mensaje ha leído cada persona. El estado de lectura es INDEPENDIENTE
-- por usuario: que alguien lea no cambia lo que otro tiene pendiente.
--
--  - Marcador = último mensaje realmente mostrado al usuario (`ultimo_leido_id`) más su `creado_en`
--    (`ultimo_leido_en`), que se copia de ese mensaje para comparar por (creado_en, id) sin unir tablas.
--  - Solo avanza: la actualización exige que el nuevo marcador sea posterior al guardado (sin retrocesos aunque
--    lleguen solicitudes concurrentes fuera de orden).
--  - Los mensajes anteriores a la fecha de corte configurada y los de cualquier fecha sin marcador no se marcan
--    como leídos ni como pendientes por esta tabla: simplemente no hay estado (no se inventa ninguno).
--  - PK (usuario_id, solicitud_id): sirve el upsert y la consulta de pendientes por usuario.
--  - FK con ON DELETE RESTRICT, igual que el resto del modelo (los mensajes no se borran).
--
-- Reversión sin pérdida de mensajes: DROP TABLE solicitud_mensajes_lecturas; (solo se pierde el progreso de lectura).
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE solicitud_mensajes_lecturas (
  usuario_id       UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  solicitud_id     UUID NOT NULL REFERENCES solicitudes(id) ON DELETE RESTRICT,
  ultimo_leido_id  UUID NOT NULL REFERENCES solicitud_mensajes(id) ON DELETE RESTRICT,
  ultimo_leido_en  TIMESTAMPTZ NOT NULL,
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, solicitud_id)
);

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V27
-- =====================================================================
