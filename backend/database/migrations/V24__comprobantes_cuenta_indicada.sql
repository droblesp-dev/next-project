-- =======================================================================
-- V24 — Cuenta receptora indicada por el cliente al subir un comprobante (QA-08)
-- =======================================================================
-- El cliente elige, en la pantalla pública, a cuál de las cuentas activas hizo la transferencia, pero esa
-- elección no se enviaba. Se guarda en la fila del comprobante (`comprobantes_pago_cliente`, V19) como dato
-- INFORMATIVO: no valida el pago ni sustituye la cuenta real, que COMERCIAL confirma al gestionar el pago
-- (`transferencias_pago.cuenta_bancaria_id` y sus copias históricas).
-- Estrictamente ADITIVA: una columna opcional (NULL = el cliente no indicó cuenta, o el comprobante es
-- anterior a V24); FK con ON DELETE RESTRICT para conservar la trazabilidad histórica.
-- ---------------------------------------------------------------------

ALTER TABLE comprobantes_pago_cliente
  ADD COLUMN cuenta_bancaria_id UUID NULL,
  ADD CONSTRAINT fk_comprobantes_pago_cliente_cuenta FOREIGN KEY (cuenta_bancaria_id)
    REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT;
