-- =======================================================================
-- V12 — Numeración comercial independiente de cotizaciones (COT-XXXXXX)
-- =======================================================================
-- Autorización explícita del usuario ("NEXTPROJECT — Implementación de
-- numeración independiente de cotizaciones"), basada en la auditoría previa
-- de solo lectura ("NEXTPROJECT — Auditoría de numeración de cotizaciones y
-- correo de aceptación"): `cotizaciones` no tiene hoy ningún código legible
-- propio (solo `id UUID`); se agrega siguiendo exactamente el mismo
-- mecanismo ya aprobado y usado dos veces en este proyecto (ordenes.codigo
-- en V1, solicitudes.codigo en V10): SEQUENCE + función trigger + TRIGGER
-- BEFORE INSERT, sin inventar un patrón nuevo.
--
-- DIFERENCIA DELIBERADA respecto a V1/ordenes (igual criterio que V10): la
-- tabla `cotizaciones` ya tiene registros históricos reales al momento de
-- esta migración. "No modificar registros históricos sin decisión expresa"
-- (restricción explícita de esta tarea) impide un backfill masivo con
-- UPDATE, así que — igual que en V10/solicitudes — la columna queda
-- NULLABLE: las cotizaciones históricas conservan codigo = NULL (nunca se
-- tocan); solo las cotizaciones NUEVAS, creadas desde esta migración en
-- adelante, reciben un código real a través del trigger. UNIQUE permite
-- múltiples NULL en PostgreSQL sin conflicto, igual que en V10.
--
-- Seguridad ante inserciones concurrentes: `nextval()` sobre una SEQUENCE de
-- PostgreSQL es atómico e intrínsecamente seguro bajo transacciones
-- concurrentes (cada llamada obtiene un valor distinto, sin bloqueos ni
-- condiciones de carrera) — mismo fundamento ya validado para
-- solicitudes_codigo_seq/ordenes_codigo_seq. El trigger corre dentro de la
-- misma transacción del INSERT ya existente en
-- cotizaciones.repository.ts::create — no se modifica esa función, el
-- trigger actúa de forma transparente para la aplicación.
-- ---------------------------------------------------------------------

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);

ALTER TABLE cotizaciones
  ADD CONSTRAINT uq_cotizaciones_codigo UNIQUE (codigo);

CREATE SEQUENCE IF NOT EXISTS cotizaciones_codigo_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION fn_cotizaciones_generar_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'COT-' || LPAD(nextval('cotizaciones_codigo_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cotizaciones_generar_codigo
BEFORE INSERT ON cotizaciones
FOR EACH ROW
EXECUTE FUNCTION fn_cotizaciones_generar_codigo();

-- Ninguna fila histórica se actualiza en esta migración (0 UPDATE/DELETE).
