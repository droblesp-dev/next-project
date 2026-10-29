-- =======================================================================
-- V22 — Trazabilidad de actores en `ordenes` (quién hizo qué)
-- =======================================================================
-- Hasta ahora `ordenes` guardaba CUÁNDO ocurrían los hitos (fecha_finalizacion, entrega_confirmada_en,
-- fecha_cierre) pero no QUIÉN los ejecutó. Se agregan columnas opcionales, sin tabla de historial nueva:
--   * estado_cambiado_por    — usuario del último cambio de estado (incluye cancelación y pausas).
--   * finalizada_por         — usuario que pasó la orden a FINALIZADA.
--   * entrega_confirmada_por — usuario que confirmó la entrega real.
--   * cerrada_por            — usuario que cerró la orden.
-- Estrictamente ADITIVA: las órdenes existentes quedan en NULL (autor desconocido; no se inventa) y ninguna
-- restricción existente cambia. FK a usuarios con ON DELETE RESTRICT, igual que transferencias_pago.
-- ---------------------------------------------------------------------

ALTER TABLE ordenes
  ADD COLUMN estado_cambiado_por    UUID NULL,
  ADD COLUMN finalizada_por         UUID NULL,
  ADD COLUMN entrega_confirmada_por UUID NULL,
  ADD COLUMN cerrada_por            UUID NULL,
  ADD CONSTRAINT fk_ordenes_estado_cambiado_por    FOREIGN KEY (estado_cambiado_por)    REFERENCES usuarios(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordenes_finalizada_por         FOREIGN KEY (finalizada_por)         REFERENCES usuarios(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordenes_entrega_confirmada_por FOREIGN KEY (entrega_confirmada_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_ordenes_cerrada_por            FOREIGN KEY (cerrada_por)            REFERENCES usuarios(id) ON DELETE RESTRICT;
