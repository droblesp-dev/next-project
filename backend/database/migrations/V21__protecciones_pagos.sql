-- =======================================================================
-- V21 — Protecciones de base de datos para el flujo de pagos
-- =======================================================================
-- 1) CHECK (regla F1): el saldo solo puede salir de PENDIENTE cuando el anticipo está resuelto
--    (VALIDADO o NO_APLICA). Hasta ahora lo garantizaba solo el backend; un UPDATE directo podía dejar
--    un saldo VALIDADO/RECHAZADO con el anticipo PENDIENTE, RECHAZADO o NULL (COALESCE: en un CHECK, NULL cuenta como
--    cumplido, así que sin él un anticipo NULL dejaría pasar la violación).
--    Precondición verificada antes de crear la restricción: 0 filas infractoras en `nextproject`.
-- 2) Historial inmutable: `transferencias_pago` es evidencia contable. Solo se permite el único cambio que
--    hace el sistema: `vigente` true -> false al registrar una gestión nueva. Cualquier otro UPDATE, y todo
--    DELETE/TRUNCATE, se rechaza. Excepción exclusiva de pruebas: la base se llama `nextproject_test` Y la
--    transacción activa `app.permitir_limpieza_pruebas = on` (la fija RegistroLimpieza). En cualquier otra
--    base la excepción no existe.
-- No modifica filas existentes ni otras restricciones.
-- ---------------------------------------------------------------------

ALTER TABLE cotizaciones
  ADD CONSTRAINT chk_cotizaciones_saldo_requiere_anticipo
  CHECK (estado_saldo = 'PENDIENTE' OR COALESCE(estado_anticipo, '') IN ('VALIDADO', 'NO_APLICA'));

CREATE OR REPLACE FUNCTION fn_transferencias_pago_inmutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.vigente IS TRUE AND NEW.vigente IS FALSE
       AND (to_jsonb(NEW) - 'vigente') = (to_jsonb(OLD) - 'vigente') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'transferencias_pago es un historial inmutable: solo se permite pasar vigente de true a false'
      USING ERRCODE = 'check_violation';
  END IF;

  IF current_database() = 'nextproject_test'
     AND current_setting('app.permitir_limpieza_pruebas', true) = 'on' THEN
    IF TG_LEVEL = 'ROW' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'transferencias_pago es un historial inmutable: no se permite % de filas', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transferencias_pago_no_update
  BEFORE UPDATE ON transferencias_pago
  FOR EACH ROW EXECUTE FUNCTION fn_transferencias_pago_inmutable();

CREATE TRIGGER trg_transferencias_pago_no_delete
  BEFORE DELETE ON transferencias_pago
  FOR EACH ROW EXECUTE FUNCTION fn_transferencias_pago_inmutable();

CREATE TRIGGER trg_transferencias_pago_no_truncate
  BEFORE TRUNCATE ON transferencias_pago
  FOR EACH STATEMENT EXECUTE FUNCTION fn_transferencias_pago_inmutable();
