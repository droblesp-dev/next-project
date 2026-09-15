-- =====================================================================
-- NEXTPROJECT — Migración V7: fichas_tecnicas
-- Bloque MVP autorizado: COTIZACIÓN ACEPTADA -> ANTICIPO -> ORDEN ->
-- FICHA TÉCNICA (NexIA) -> OPERATIVO. Crea EXCLUSIVAMENTE esta tabla — no
-- modifica ninguna de las 11 tablas existentes (incluye solicitud_mensajes,
-- V6).
--
-- Diseño mínimo, exactamente los 7 campos autorizados. `orden_id` es
-- UNIQUE: una sola ficha por orden en este MVP (sin versionado, sin
-- reintentos complejos — si Gemini falla no se inserta ninguna fila, la
-- ausencia de fila ES el estado "pendiente de generar").
-- `revisado_por/_en` quedan reservados para una futura revisión de
-- Operativo (decisión 10 del bloque: NO es una aprobación obligatoria en
-- este MVP, por eso no hay ningún endpoint que los escriba todavía).
-- =====================================================================

BEGIN;

CREATE TABLE fichas_tecnicas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id             UUID NOT NULL UNIQUE REFERENCES ordenes(id),
  contenido            TEXT NOT NULL,
  tiene_inconsistencia BOOLEAN NOT NULL DEFAULT FALSE,
  generado_en          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_por         UUID REFERENCES usuarios(id),
  revisado_en          TIMESTAMPTZ
);

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V7
-- No se crean tablas adicionales. No se modifica ninguna tabla existente.
-- =====================================================================
