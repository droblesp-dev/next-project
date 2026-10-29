-- =======================================================================
-- V23 — Bloqueo por intentos fallidos del código de acceso, persistente (QA-06)
-- =======================================================================
-- Hasta ahora el contador de intentos fallidos del código de 6 dígitos de la cotización pública vivía en la
-- memoria del proceso: se perdía al reiniciar el backend y no se compartía entre instancias. Se guarda en la
-- propia cotización, con las MISMAS reglas vigentes (5 fallos consecutivos bloquean 15 minutos; un código
-- correcto, un código nuevo o la recuperación por correo reinician el contador):
--   * acceso_intentos_fallidos — fallos consecutivos desde el último reinicio.
--   * acceso_bloqueado_hasta   — NULL, o el instante en que termina el bloqueo vigente.
-- Estrictamente ADITIVA: dos columnas con valor por defecto; ninguna fila existente cambia de comportamiento.
-- ---------------------------------------------------------------------

ALTER TABLE cotizaciones
  ADD COLUMN acceso_intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN acceso_bloqueado_hasta   TIMESTAMPTZ NULL,
  ADD CONSTRAINT chk_cotizaciones_acceso_intentos CHECK (acceso_intentos_fallidos >= 0);
