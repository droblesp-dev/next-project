-- =====================================================================
-- NEXTPROJECT — Migración V26: participantes del chat por solicitud (#7)
-- Registra qué usuarios (COMERCIAL u OPERATIVO) participan en la conversación de una solicitud SIN orden. Con orden
-- no se usa: el acceso se deriva de la orden (COMERCIAL siempre; OPERATIVO solo si es el responsable vigente).
--
--  - El rol NO se guarda: se toma siempre de `usuarios.rol` vigente, para no duplicar un dato que cambia.
--  - Nunca se borran filas: retirar a alguien completa `retirado_por/retirado_en` (trazabilidad); reincorporarlo
--    crea una fila nueva. Una sola fila activa por usuario y solicitud (índice único parcial).
--  - `origen` distingue cómo entró: PRIMER_MENSAJE (el primer COMERCIAL que escribe en un hilo sin COMERCIAL
--    participante), INCORPORADO (lo añadió un participante COMERCIAL) y RECLAMO (un COMERCIAL tomó un hilo sin
--    COMERCIAL participante activo).
--  - FK con ON DELETE RESTRICT, igual que el resto de columnas de actor del modelo.
--
-- No modifica ninguna tabla existente ni inserta filas: los hilos existentes quedan sin participantes (se
-- recuperan con el reclamo) y el control estricto solo se activa por configuración (modo sombra por defecto).
-- Reversión sin pérdida de mensajes: DROP TABLE solicitud_mensajes_participantes;
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE solicitud_mensajes_participantes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id  UUID NOT NULL REFERENCES solicitudes(id) ON DELETE RESTRICT,
  usuario_id    UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  agregado_por  UUID NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  origen        VARCHAR(15) NOT NULL,
  agregado_en   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retirado_por  UUID REFERENCES usuarios(id) ON DELETE RESTRICT,
  retirado_en   TIMESTAMPTZ,
  CONSTRAINT chk_smp_origen CHECK (origen IN ('PRIMER_MENSAJE', 'INCORPORADO', 'RECLAMO')),
  CONSTRAINT chk_smp_retiro_coherente CHECK ((retirado_por IS NULL) = (retirado_en IS NULL)),
  CONSTRAINT chk_smp_retiro_posterior CHECK (retirado_en IS NULL OR retirado_en >= agregado_en)
);

CREATE UNIQUE INDEX ux_smp_activo ON solicitud_mensajes_participantes (solicitud_id, usuario_id) WHERE retirado_en IS NULL;
CREATE INDEX ix_smp_usuario_activo ON solicitud_mensajes_participantes (usuario_id) WHERE retirado_en IS NULL;

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V26
-- =====================================================================
