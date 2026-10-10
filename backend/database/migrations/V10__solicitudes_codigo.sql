-- =======================================================================
-- V10 — FORMULARIO-01: código legible de solicitud (SOL-XXXXXX)
-- =======================================================================
-- Autorización explícita del usuario (bloque "FORMULARIO-01 — CIERRE DEL
-- FORMULARIO PÚBLICO NEXTPROJECT"): el formulario público debe mostrar al
-- cliente un número de solicitud real y estable ("Solicitud N.º SOL-XXXXXX"),
-- que hoy no existe en el esquema (a diferencia de ordenes.codigo).
--
-- Mismo mecanismo ya usado y aprobado para ordenes.codigo (V1, sección 8:
-- SEQUENCE + TRIGGER BEFORE INSERT) — no se inventa un patrón nuevo.
--
-- DIFERENCIA DELIBERADA respecto a V1/ordenes: `solicitudes` ya tiene ~117
-- registros históricos reales. "NO modificar registros históricos" (regla
-- explícita de este bloque) impide hacer un backfill masivo con UPDATE, así
-- que a diferencia de ordenes.codigo (NOT NULL, 0 registros al migrar),
-- solicitudes.codigo queda NULLABLE: las solicitudes históricas conservan
-- codigo = NULL (nunca se tocan); solo las solicitudes NUEVAS (de cualquier
-- origen: formulario público, enlace de lead, etc. — el trigger es uniforme,
-- igual que en ordenes) reciben un código real desde esta migración en
-- adelante. UNIQUE permite múltiples NULL en PostgreSQL sin conflicto.
-- ---------------------------------------------------------------------

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(50);

ALTER TABLE solicitudes
  ADD CONSTRAINT uq_solicitudes_codigo UNIQUE (codigo);

CREATE SEQUENCE IF NOT EXISTS solicitudes_codigo_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION fn_solicitudes_generar_codigo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL THEN
    NEW.codigo := 'SOL-' || LPAD(nextval('solicitudes_codigo_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_solicitudes_generar_codigo
BEFORE INSERT ON solicitudes
FOR EACH ROW
EXECUTE FUNCTION fn_solicitudes_generar_codigo();

-- Ninguna fila histórica se actualiza en esta migración (0 UPDATE/DELETE).
