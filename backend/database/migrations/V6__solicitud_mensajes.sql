-- =====================================================================
-- NEXTPROJECT — Migración V6: solicitud_mensajes
-- Chat mínimo Comercial <-> Operativo, asociado a una solicitud.
-- Autorizada explícitamente como bloque MVP: "SOLICITUD -> CHAT COMERCIAL
-- <-> OPERATIVO -> NexIA invocable -> apoyo a validación técnica previa
-- a cotizar". Crea EXCLUSIVAMENTE esta tabla — no modifica ninguna de las
-- 10 tablas existentes.
--
-- `autor_id` es NULL únicamente cuando `autor_tipo='NEXIA'` (NexIA no es
-- un usuario real de la tabla `usuarios`) — reforzado por
-- chk_solicitud_mensajes_autor_id, para que la coherencia no dependa solo
-- del backend.
-- =====================================================================

BEGIN;

CREATE TABLE solicitud_mensajes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitud_id  UUID NOT NULL REFERENCES solicitudes(id),
  autor_id      UUID REFERENCES usuarios(id),
  autor_tipo    VARCHAR(10) NOT NULL,
  contenido     TEXT NOT NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_solicitud_mensajes_autor_tipo
    CHECK (autor_tipo IN ('COMERCIAL', 'OPERATIVO', 'NEXIA')),
  CONSTRAINT chk_solicitud_mensajes_autor_id
    CHECK (
      (autor_tipo = 'NEXIA' AND autor_id IS NULL)
      OR (autor_tipo <> 'NEXIA' AND autor_id IS NOT NULL)
    ),
  CONSTRAINT chk_solicitud_mensajes_contenido_no_vacio
    CHECK (btrim(contenido) <> '')
);

CREATE INDEX ix_solicitud_mensajes_solicitud_id ON solicitud_mensajes(solicitud_id, creado_en);

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V6
-- No se crean tablas adicionales. No se modifica ninguna tabla existente.
-- =====================================================================
