-- =====================================================================
-- V9 — Bloque SALDO → VALIDACIÓN COMERCIAL → ENTREGA → CERRADA
-- =====================================================================
-- Decisiones aprobadas explícitamente para este bloque:
--   - Sin tabla de pagos nueva (MVP, sin pagos parciales/múltiples).
--   - saldo_pendiente (V1) continúa siendo el monto fijo calculado en
--     crearCotizacion() (total - anticipo_valor); no se toca su cálculo
--     ni se agrega ninguna columna que permita escribirlo manualmente.
--   - estado_saldo: PENDIENTE | VALIDADO | RECHAZADO (sin NO_APLICA — una
--     cotización con anticipo 0% igual tiene saldo pendiente por cobrar).
--   - ordenes.fecha_entrega (V1) NO se toca: conserva su significado de
--     fecha programada/comprometida. entrega_confirmada_en es un campo
--     nuevo e independiente para la confirmación real de entrega.
-- =====================================================================

BEGIN;

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS metodo_saldo VARCHAR(20),
  ADD COLUMN IF NOT EXISTS estado_saldo VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN IF NOT EXISTS comprobante_saldo TEXT,
  ADD COLUMN IF NOT EXISTS saldo_confirmado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS saldo_confirmado_por UUID;

ALTER TABLE cotizaciones
  ADD CONSTRAINT fk_cotizaciones_saldo_confirmado_por
    FOREIGN KEY (saldo_confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;

ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_cotizaciones_metodo_saldo
    CHECK (metodo_saldo IS NULL OR metodo_saldo IN ('TRANSFERENCIA','EFECTIVO')),
  ADD CONSTRAINT chk_cotizaciones_estado_saldo
    CHECK (estado_saldo IN ('PENDIENTE','VALIDADO','RECHAZADO'));

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS entrega_confirmada_en TIMESTAMPTZ;

COMMIT;
