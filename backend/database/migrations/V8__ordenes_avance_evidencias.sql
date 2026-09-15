-- =====================================================================
-- NEXTPROJECT — Migración V8: avance de órdenes + evidencias + PAUSADA
-- Bloque MVP autorizado: ORDEN -> OPERATIVO -> AVANCE -> EVIDENCIA ->
-- FINALIZADA. Modifica ÚNICAMENTE `ordenes` (agrega `avance`, amplía el
-- CHECK de estado) y crea la tabla nueva `ordenes_evidencias`. Ninguna
-- otra tabla existente se toca.
-- =====================================================================

BEGIN;

-- 1) Avance (0-100), decisión explícita.
ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS avance INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ordenes
  ADD CONSTRAINT chk_ordenes_avance CHECK (avance BETWEEN 0 AND 100);

-- 2) Nuevo estado PAUSADA — se amplía el CHECK existente (mismo patrón ya
-- usado en V1 para el CHECK de 6 valores de cotizaciones). No se toca
-- ninguna otra restricción de `ordenes`.
ALTER TABLE ordenes DROP CONSTRAINT chk_ordenes_estado;

ALTER TABLE ordenes
  ADD CONSTRAINT chk_ordenes_estado
  CHECK (estado IN ('PENDIENTE','EN_PROCESO','PAUSADA','FINALIZADA','CERRADA','CANCELADA'));

-- 3) Evidencias — tabla mínima, mismo patrón ya usado en `lead_seguimientos`
-- y `solicitud_mensajes`. `nombre_archivo` es siempre generado por el
-- servidor (nunca el nombre original del cliente) — mismo criterio que
-- `comprobante_anticipo`. No hay endpoint de eliminación (decisión
-- explícita): esta tabla es solo de inserción/lectura en este MVP.
CREATE TABLE ordenes_evidencias (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id       UUID NOT NULL REFERENCES ordenes(id),
  tipo           VARCHAR(4) NOT NULL,
  nombre_archivo TEXT NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_ordenes_evidencias_tipo CHECK (tipo IN ('FOTO', 'PDF'))
);

CREATE INDEX ix_ordenes_evidencias_orden_id ON ordenes_evidencias(orden_id);

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V8
-- Tablas afectadas: ordenes (ALTER). Tabla nueva: ordenes_evidencias.
-- Ninguna otra tabla existente se modifica.
-- =====================================================================
