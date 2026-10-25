-- =======================================================================
-- V19 — Historial de comprobantes que sube el cliente (anticipo y saldo)
-- =======================================================================
-- Hasta V18 el comprobante que el cliente subía desde el enlace público solo
-- existía como una referencia en `cotizaciones.comprobante_anticipo` /
-- `comprobante_saldo`: una segunda subida sobrescribía la referencia (el
-- archivo anterior quedaba en disco sin ningún registro) y reabrir un saldo
-- rechazado la ponía en NULL. Esta tabla registra CADA subida del cliente, de
-- forma que nunca se pierde un comprobante anterior ni su trazabilidad.
--
-- Las columnas `cotizaciones.comprobante_*` se conservan como caché del
-- comprobante vigente (las lee la descarga interna); esta tabla es el
-- historial. El rechazo y su motivo siguen viviendo en `transferencias_pago`.
--
-- El backfill copia a la tabla los comprobantes que ya están referenciados en
-- `cotizaciones`, para que el historial sea consistente desde el primer día.
-- Ningún archivo en disco se elimina ni se renombra con esta migración.
-- ---------------------------------------------------------------------

CREATE TABLE comprobantes_pago_cliente (
  id            UUID PRIMARY KEY,
  cotizacion_id UUID NOT NULL,
  tipo_pago     VARCHAR(10) NOT NULL,
  archivo       TEXT NOT NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comprobantes_pago_cliente_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id),
  CONSTRAINT chk_comprobantes_pago_cliente_tipo_pago CHECK (tipo_pago IN ('ANTICIPO','SALDO'))
);

CREATE INDEX idx_comprobantes_pago_cliente_cotizacion
  ON comprobantes_pago_cliente (cotizacion_id, tipo_pago, creado_en DESC);

INSERT INTO comprobantes_pago_cliente (id, cotizacion_id, tipo_pago, archivo, creado_en)
SELECT gen_random_uuid(), id, 'ANTICIPO', comprobante_anticipo, actualizado_en
FROM cotizaciones
WHERE comprobante_anticipo IS NOT NULL;

INSERT INTO comprobantes_pago_cliente (id, cotizacion_id, tipo_pago, archivo, creado_en)
SELECT gen_random_uuid(), id, 'SALDO', comprobante_saldo, actualizado_en
FROM cotizaciones
WHERE comprobante_saldo IS NOT NULL;
