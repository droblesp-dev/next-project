-- =======================================================================
-- V14 — PC-2026-01: catálogo de cuentas bancarias + banco de origen del
-- pago + motivo de rechazo + autorización de excepción de banco
-- =======================================================================
-- Autorización explícita del propietario ("PC-2026-01 — Autorización de
-- implementación controlada"), implementada por etapas dentro de esa misma
-- autorización. Esta migración es la Etapa 1: solo esquema, aditiva,
-- aplicada primero en `nextproject_test`.
--
-- Distinción importante (ya señalada en la auditoría previa): `cuentas_
-- bancarias` representa las cuentas de NEXTPROJECT que RECIBEN el pago
-- (reemplazan a las variables BANCO_* del .env, que NO se tocan en esta
-- migración ni se retiran todavía). `banco_origen` en `transferencias_pago`
-- es un dato distinto: el banco DESDE el que el cliente dice haber
-- transferido — no existe ningún mecanismo de extracción automática
-- (verificado: sin uso de OCR/IA en el módulo de comprobantes), se captura
-- manualmente.
--
-- `cuentas_bancarias`: mismo criterio ya usado en el resto del esquema
-- (UUID PK, VARCHAR+CHECK para tipo_cuenta, numero_cuenta como texto para
-- conservar ceros iniciales). Sin columna de logo — no fue solicitada en
-- esta implementación.
--
-- `transferencias_pago.cuenta_bancaria_id` referencia la cuenta elegida;
-- los 4 campos `*_snapshot` conservan una COPIA de esos datos al momento
-- del pago (decisión B.6: "las modificaciones posteriores no alteran el
-- historial") — se completan en el backend al crear el registro, nunca se
-- actualizan después.
--
-- `motivo_rechazo`: catálogo cerrado + `motivo_rechazo_detalle` libre,
-- solo relevante cuando el motivo es 'OTRO' (la restricción de que
-- `detalle` no esté vacío en ese caso se valida en el backend, no es
-- expresable con un CHECK simple dependiente de otro campo de forma
-- robusta aquí).
--
-- `cotizaciones.banco_origen_excepcion_autorizado_por/_en`: autorización
-- de usar un banco de origen distinto al del pago anterior, con alcance a
-- nivel de COTIZACIÓN completa (decisión D.8: "conserva la autorización
-- para los pagos posteriores de esa misma cotización") — por eso vive en
-- `cotizaciones`, no en cada fila de `transferencias_pago`.
--
-- Ninguna fila histórica de `cotizaciones` ni de `transferencias_pago` se
-- modifica (0 UPDATE/DELETE). Todas las columnas nuevas son NULLABLE.
-- ---------------------------------------------------------------------

CREATE TABLE cuentas_bancarias (
  id              UUID PRIMARY KEY,
  banco           VARCHAR(100) NOT NULL,
  titular         VARCHAR(200) NOT NULL,
  tipo_cuenta     VARCHAR(20) NOT NULL,
  numero_cuenta   VARCHAR(50) NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por      UUID NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cuentas_bancarias_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cuentas_bancarias_tipo_cuenta CHECK (tipo_cuenta IN ('AHORROS','CORRIENTE'))
);

ALTER TABLE transferencias_pago
  ADD COLUMN banco_origen           VARCHAR(100),
  ADD COLUMN cuenta_bancaria_id     UUID,
  ADD COLUMN banco_cuenta_snapshot      VARCHAR(100),
  ADD COLUMN titular_cuenta_snapshot    VARCHAR(200),
  ADD COLUMN tipo_cuenta_snapshot       VARCHAR(20),
  ADD COLUMN numero_cuenta_snapshot     VARCHAR(50),
  ADD COLUMN referencia_bancaria    VARCHAR(100),
  ADD COLUMN motivo_rechazo         VARCHAR(30),
  ADD COLUMN motivo_rechazo_detalle TEXT;

ALTER TABLE transferencias_pago
  ADD CONSTRAINT fk_transferencias_pago_cuenta_bancaria FOREIGN KEY (cuenta_bancaria_id) REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_transferencias_pago_motivo_rechazo CHECK (
    motivo_rechazo IS NULL OR motivo_rechazo IN ('COMPROBANTE_INCORRECTO','IMPORTE_INCORRECTO','COMPROBANTE_ILEGIBLE','OTRO')
  );

ALTER TABLE cotizaciones
  ADD COLUMN banco_origen_excepcion_autorizado_por UUID,
  ADD COLUMN banco_origen_excepcion_autorizado_en  TIMESTAMPTZ;

ALTER TABLE cotizaciones
  ADD CONSTRAINT fk_cotizaciones_banco_origen_excepcion_autorizado_por
    FOREIGN KEY (banco_origen_excepcion_autorizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;

-- Ninguna tabla pierde filas ni valores existentes en esta migración
-- (0 UPDATE, 0 DELETE sobre cotizaciones/transferencias_pago).
