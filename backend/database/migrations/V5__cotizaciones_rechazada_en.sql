-- =====================================================================
-- NEXTPROJECT — Migración V5: rechazada_en en cotizaciones
-- Base de datos: nextproject
-- Autorizada explícitamente en Fase D (aceptación/rechazo del cliente vía
-- enlace público). Mismo patrón que V4: ADD COLUMN IF NOT EXISTS, sin
-- tocar ninguna otra columna, constraint o tabla existente.
-- =====================================================================

BEGIN;

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS rechazada_en TIMESTAMPTZ;

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V5
-- No se crean tablas nuevas. Única tabla afectada: cotizaciones.
-- =====================================================================
