-- =====================================================================
-- NEXTPROJECT — Migración V1: Ampliación del modelo físico
-- Base de datos: nextproject (PostgreSQL 18.6)
-- Basada en auditoría verificada el 2026-09-01:
--   - solicitudes, analisis_ia, cotizaciones, ordenes, alertas: 0 registros
--   - analisis_ia.informacion_estructurada = JSONB (sin cambios)
--   - ux_cotizaciones_una_aceptada existe (sin cambios, no se toca)
--   - cotizaciones.estado actual: PENDIENTE, ENVIADA, ACEPTADA, RECHAZADA
--   - ordenes.estado actual: PENDIENTE, EN_PROCESO, FINALIZADA, CANCELADA
--   - cotizaciones.valor = NOT NULL (sin cambios, no se toca)
--   - constraint cotizaciones.estado: chk_cotizaciones_estado
--   - constraint ordenes.estado: chk_ordenes_estado
--   - constraint fechas de órdenes: chk_ordenes_fechas (sin cambios, no se toca)
--
-- ESTADO: NO EJECUTADA. Este archivo es solo para revisión humana.
-- Como todas las tablas afectadas tienen 0 registros (verificado),
-- no se requiere ningún UPDATE de migración de datos.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) SOLICITUDES
-- ---------------------------------------------------------------------
ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS especificaciones TEXT,
  ADD COLUMN IF NOT EXISTS requiere_comprobante BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------
-- 2) ANALISIS_IA
-- ---------------------------------------------------------------------
ALTER TABLE analisis_ia RENAME COLUMN prioridad TO prioridad_sugerida;

ALTER TABLE analisis_ia
  ADD COLUMN IF NOT EXISTS revisado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS revisado_por UUID,
  ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMPTZ;

ALTER TABLE analisis_ia
  ADD CONSTRAINT fk_analisis_ia_revisado_por
  FOREIGN KEY (revisado_por) REFERENCES usuarios(id)
  ON DELETE RESTRICT;

-- informacion_estructurada (JSONB): sin cambios, confirmado por auditoría.

-- ---------------------------------------------------------------------
-- 3) COTIZACIONES — nuevas columnas ("valor" se conserva sin cambios)
-- ---------------------------------------------------------------------
ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS descripcion TEXT,
  ADD COLUMN IF NOT EXISTS creado_por UUID,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS iva_porcentaje NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS iva_valor NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS anticipo_porcentaje NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS anticipo_valor NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS saldo_pendiente NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS metodo_anticipo VARCHAR(20),
  ADD COLUMN IF NOT EXISTS estado_anticipo VARCHAR(20),
  ADD COLUMN IF NOT EXISTS comprobante_anticipo TEXT,
  ADD COLUMN IF NOT EXISTS anticipo_confirmado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anticipo_confirmado_por UUID,
  ADD COLUMN IF NOT EXISTS fecha_vigencia TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aceptada_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE cotizaciones
  ADD CONSTRAINT fk_cotizaciones_creado_por
    FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_cotizaciones_anticipo_confirmado_por
    FOREIGN KEY (anticipo_confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;

-- No se agrega aceptada_por: el cliente acepta, no un usuario interno.
-- No se modifica cotizaciones.valor (se conserva NOT NULL tal cual está).

-- ---------------------------------------------------------------------
-- 4) COTIZACIONES — estados: eliminar PENDIENTE, set final de 6 valores
-- ---------------------------------------------------------------------
-- Auditoría confirmó 0 registros en cotizaciones: no se requiere UPDATE
-- de datos previo a endurecer el CHECK.

ALTER TABLE cotizaciones DROP CONSTRAINT chk_cotizaciones_estado;

ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_cotizaciones_estado
  CHECK (estado IN ('BORRADOR','ENVIADA','ACEPTADA','RECHAZADA','VENCIDA','CANCELADA'));

-- Ajuste necesario derivado: el DEFAULT anterior de la columna (si
-- apuntaba a 'PENDIENTE') quedaría inválido contra el nuevo CHECK.
-- Se actualiza a 'BORRADOR' para que la tabla siga siendo insertable
-- sin especificar estado explícitamente.
ALTER TABLE cotizaciones ALTER COLUMN estado SET DEFAULT 'BORRADOR';

-- ux_cotizaciones_una_aceptada: NO SE TOCA. Confirmado existente por auditoría.

-- ---------------------------------------------------------------------
-- 5) IVA — validación de rango, sin reglas de negocio hard-codeadas
-- ---------------------------------------------------------------------
ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_cotizaciones_iva_rango
    CHECK (iva_porcentaje IS NULL OR (iva_porcentaje >= 0 AND iva_porcentaje <= 100)),
  ADD CONSTRAINT chk_cotizaciones_subtotal_no_negativo
    CHECK (subtotal IS NULL OR subtotal >= 0),
  ADD CONSTRAINT chk_cotizaciones_iva_valor_no_negativo
    CHECK (iva_valor IS NULL OR iva_valor >= 0),
  ADD CONSTRAINT chk_cotizaciones_total_no_negativo
    CHECK (total IS NULL OR total >= 0);

-- ---------------------------------------------------------------------
-- 6) ANTICIPO — rango, estados y métodos permitidos
-- ---------------------------------------------------------------------
ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_cotizaciones_anticipo_rango
    CHECK (anticipo_porcentaje IS NULL OR (anticipo_porcentaje >= 0 AND anticipo_porcentaje <= 100)),
  ADD CONSTRAINT chk_cotizaciones_anticipo_valor_no_negativo
    CHECK (anticipo_valor IS NULL OR anticipo_valor >= 0),
  ADD CONSTRAINT chk_cotizaciones_saldo_no_negativo
    CHECK (saldo_pendiente IS NULL OR saldo_pendiente >= 0),
  ADD CONSTRAINT chk_cotizaciones_metodo_anticipo
    CHECK (metodo_anticipo IS NULL OR metodo_anticipo IN ('TRANSFERENCIA','EFECTIVO')),
  ADD CONSTRAINT chk_cotizaciones_estado_anticipo
    CHECK (estado_anticipo IS NULL OR estado_anticipo IN ('PENDIENTE','VALIDADO','RECHAZADO','NO_APLICA'));

-- anticipo_valor = total * anticipo_porcentaje / 100 y
-- saldo_pendiente = total - anticipo_valor se calculan en el backend.
-- No se agrega CHECK de igualdad ni columnas GENERATED (fuera de alcance).

-- ---------------------------------------------------------------------
-- 7) ORDENES — nuevas columnas
-- ---------------------------------------------------------------------
ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(50),
  ADD COLUMN IF NOT EXISTS descripcion TEXT,
  ADD COLUMN IF NOT EXISTS fecha_programada TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fecha_finalizacion TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fecha_cierre TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observaciones TEXT;

-- responsable_id: sin cambios, no se renombra.
-- chk_ordenes_fechas: NO SE TOCA. Confirmado existente por auditoría,
-- fuera del alcance de esta migración.

-- ---------------------------------------------------------------------
-- 8) CÓDIGO DE ORDEN — generación automática (SEQUENCE + TRIGGER)
-- ---------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS ordenes_codigo_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION fn_ordenes_generar_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'ORD-' || LPAD(nextval('ordenes_codigo_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ordenes_generar_codigo
BEFORE INSERT ON ordenes
FOR EACH ROW
EXECUTE FUNCTION fn_ordenes_generar_codigo();

-- Auditoría confirmó 0 registros en ordenes: es seguro imponer NOT NULL
-- y UNIQUE de inmediato, sin necesidad de backfill previo.
ALTER TABLE ordenes ALTER COLUMN codigo SET NOT NULL;

ALTER TABLE ordenes
  ADD CONSTRAINT uq_ordenes_codigo UNIQUE (codigo);

-- ---------------------------------------------------------------------
-- 9) ORDENES — estados: agregar CERRADA
-- ---------------------------------------------------------------------
-- Auditoría confirmó 0 registros en ordenes: no se requiere UPDATE
-- de datos previo a endurecer el CHECK.

ALTER TABLE ordenes DROP CONSTRAINT chk_ordenes_estado;

ALTER TABLE ordenes
  ADD CONSTRAINT chk_ordenes_estado
  CHECK (estado IN ('PENDIENTE','EN_PROCESO','FINALIZADA','CERRADA','CANCELADA'));

-- ---------------------------------------------------------------------
-- 10) ALERTAS
-- ---------------------------------------------------------------------
ALTER TABLE alertas
  ADD COLUMN IF NOT EXISTS leida BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS leida_en TIMESTAMPTZ;

-- "estado" (ciclo de vida de la alerta) se conserva intacto.
-- No se agrega usuario_id.

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V1
-- No se crean tablas nuevas. Tablas afectadas: solicitudes, analisis_ia,
-- cotizaciones, ordenes, alertas. Tablas NO tocadas: roles, usuarios, clientes.
-- =====================================================================
