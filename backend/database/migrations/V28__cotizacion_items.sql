-- =====================================================================
-- NEXTPROJECT — Migración V28: líneas de detalle de las cotizaciones (requerimiento 4, alternativa A)
-- PREPARADA, NO EJECUTADA. Requiere autorización expresa para aplicarla en cualquier base (pruebas o producción).
--
-- Crea EXCLUSIVAMENTE la tabla `cotizacion_items` (tabla número 16 del modelo; aprobada por el responsable del proyecto).
-- No modifica ninguna columna, restricción ni fila de `cotizaciones` ni de otras tablas: las cotizaciones históricas conservan
-- sus importes y su trazabilidad exactamente como están. No hay relleno: una cotización sin líneas es una cotización histórica
-- (o creada antes de V28) y se presenta con una fila derivada que NO se guarda.
--
-- Reglas que garantiza la base de datos:
--   - cantidad > 0 con hasta 3 decimales; precio unitario >= 0 con 2 decimales; descripción de 1 a 200 caracteres.
--   - subtotal = round(cantidad * precio_unitario, 2), con el mismo redondeo que usa el backend (mitad hacia arriba).
--   - una posición (`orden`) por línea y cotización.
--   - las líneas solo pueden insertarse, modificarse o eliminarse mientras la cotización está en BORRADOR (disparador):
--     desde ENVIADA son una fotografía inmutable del documento que vio el cliente.
-- Reglas que garantiza el backend (CLAUDE.md §10): máximo 50 líneas, subtotal de la cotización = suma de líneas, y los importes
-- derivados (IVA, total, anticipo y saldo) calculados con las reglas vigentes, en la misma transacción que escribe las líneas.
--
-- Reversión sin pérdida de cotizaciones: DROP TRIGGER trg_cotizacion_items_solo_borrador ON cotizacion_items;
--                                         DROP TABLE cotizacion_items; DROP FUNCTION cotizacion_items_solo_borrador();
-- (solo se perderían las líneas de las cotizaciones creadas con ellas; sus importes siguen guardados en `cotizaciones`).
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE cotizacion_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id           UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE RESTRICT,
  orden                   SMALLINT NOT NULL,
  descripcion             VARCHAR(200) NOT NULL,
  -- Misma normalización que usa la búsqueda del sistema (minúsculas, sin tildes, «_» como espacio): lo calcula el backend al
  -- insertar con la expresión de busqueda.repository.ts, para que el buscador de conceptos y la búsqueda global coincidan.
  descripcion_normalizada VARCHAR(200) NOT NULL,
  cantidad                NUMERIC(12,3) NOT NULL,
  precio_unitario         NUMERIC(12,2) NOT NULL,
  subtotal                NUMERIC(12,2) NOT NULL,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_cotizacion_items_orden CHECK (orden >= 1 AND orden <= 50),
  CONSTRAINT chk_cotizacion_items_descripcion CHECK (btrim(descripcion) <> '' AND char_length(descripcion) <= 200),
  CONSTRAINT chk_cotizacion_items_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_cotizacion_items_precio CHECK (precio_unitario >= 0),
  CONSTRAINT chk_cotizacion_items_subtotal CHECK (subtotal = round(cantidad * precio_unitario, 2)),
  CONSTRAINT ux_cotizacion_items_orden UNIQUE (cotizacion_id, orden)
);

-- Buscador de conceptos reutilizables y búsqueda global por descripción de línea (LIKE '%texto%' sobre el texto normalizado).
CREATE INDEX ix_cotizacion_items_descripcion_normalizada ON cotizacion_items (descripcion_normalizada);

-- Inmutabilidad desde ENVIADA: solo se escribe mientras la cotización está en BORRADOR. Es la defensa en profundidad de la regla
-- que ya aplica el backend (bloqueo de la fila de la cotización y comprobación del estado dentro de la misma transacción).
CREATE FUNCTION cotizacion_items_solo_borrador() RETURNS trigger AS $$
DECLARE
  v_estado VARCHAR(20);
BEGIN
  SELECT estado INTO v_estado FROM cotizaciones WHERE id = COALESCE(NEW.cotizacion_id, OLD.cotizacion_id);
  IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'Las líneas de una cotización solo pueden modificarse mientras está en BORRADOR (estado actual: %).', COALESCE(v_estado, 'inexistente')
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cotizacion_id <> OLD.cotizacion_id THEN
    RAISE EXCEPTION 'Una línea no puede cambiar de cotización.' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cotizacion_items_solo_borrador
  BEFORE INSERT OR UPDATE OR DELETE ON cotizacion_items
  FOR EACH ROW EXECUTE FUNCTION cotizacion_items_solo_borrador();

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V28
-- =====================================================================
