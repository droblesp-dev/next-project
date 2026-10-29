-- revertir_p1.sql — REVERSIÓN EXACTA de reparar_p1.sql (propuesta; NO ejecutada). Restaura los valores
-- originales (con microsegundos) capturados antes de la reparación. Solo aplica si el estado actual es
-- exactamente el que dejó la reparación; si no, aborta. Mismo esquema de uso (prueba por defecto):
--   psql ... -v expected_db=<base> [-v confirmar=SI] -f revertir_p1.sql
-- Nota: restaura intencionadamente el estado INVÁLIDO original; si en el futuro existen el CHECK de F1 o los
-- triggers de inmutabilidad, esta reversión puede quedar bloqueada por ellos (por diseño).
\set ON_ERROR_STOP on
\if :{?expected_db}
\else
  \echo 'ABORTA: falta -v expected_db=<nombre de la base>'
  \quit
\endif
\if :{?confirmar}
\else
  \set confirmar NO
\endif

BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
LOCK TABLE cotizaciones, transferencias_pago IN SHARE ROW EXCLUSIVE MODE;
SELECT set_config('app.expected_db', :'expected_db', true);

DO $$
DECLARE
  n integer;
BEGIN
  IF current_setting('app.expected_db') NOT IN ('nextproject', 'nextproject_test')
     OR current_database() <> current_setting('app.expected_db') THEN
    RAISE EXCEPTION 'ABORTA: base conectada "%" distinta de la esperada "%"', current_database(), current_setting('app.expected_db');
  END IF;
  -- Estado que debe haber dejado reparar_p1.sql.
  SELECT count(*) INTO n FROM cotizaciones
   WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462' AND estado_anticipo = 'PENDIENTE'
     AND estado_saldo = 'PENDIENTE' AND metodo_saldo IS NULL AND saldo_confirmado_en IS NULL AND saldo_confirmado_por IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'PRECONDICIÓN: COT-000001 no está en el estado que deja la reparación'; END IF;
  SELECT count(*) INTO n FROM transferencias_pago
   WHERE id = '101897f5-8071-4745-9705-8f1799e5819a' AND cotizacion_id = '75f33350-e236-46e4-8072-b1a91ec16462'
     AND tipo_pago = 'SALDO' AND estado = 'VALIDADO' AND vigente = false;
  IF n <> 1 THEN RAISE EXCEPTION 'PRECONDICIÓN: la fila de saldo no está VALIDADO y no vigente'; END IF;
  SELECT count(*) INTO n FROM transferencias_pago
   WHERE cotizacion_id = '75f33350-e236-46e4-8072-b1a91ec16462' AND tipo_pago = 'SALDO' AND vigente = true;
  IF n <> 0 THEN RAISE EXCEPTION 'PRECONDICIÓN: ya hay una fila vigente de saldo en COT-000001 (% filas)', n; END IF;
  SELECT count(*) INTO n FROM cotizaciones
   WHERE id IN ('72bdb797-95e5-465d-99e7-5e9ebd028354', 'e1545fc7-b118-4f37-a567-667b08712e6d',
                '9bdd65c5-978d-4985-abac-1eb2d448353c', 'c51ad944-a86b-4192-bdc7-0006a5407b05')
     AND estado = 'ACEPTADA' AND estado_anticipo = 'NO_APLICA' AND estado_saldo = 'PENDIENTE';
  IF n <> 4 THEN RAISE EXCEPTION 'PRECONDICIÓN: solo % de las 4 cotizaciones están en NO_APLICA', n; END IF;
END $$;

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE cotizaciones
     SET estado_saldo = 'VALIDADO', metodo_saldo = 'EFECTIVO',
         saldo_confirmado_en = timestamptz '2026-10-27 23:50:04.396977+00',
         saldo_confirmado_por = '0d36d17b-1f70-4da3-9780-dadcc154ae91',
         actualizado_en = timestamptz '2026-10-27 23:50:04.396977+00'
   WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORTA: COT-000001 afectó % filas y se esperaba 1', n; END IF;

  UPDATE transferencias_pago SET vigente = true WHERE id = '101897f5-8071-4745-9705-8f1799e5819a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORTA: la fila de saldo afectó % filas y se esperaba 1', n; END IF;

  UPDATE cotizaciones SET estado_anticipo = NULL,
         actualizado_en = CASE id
           WHEN '72bdb797-95e5-465d-99e7-5e9ebd028354' THEN timestamptz '2026-09-03 08:50:39.154864+00'
           WHEN 'e1545fc7-b118-4f37-a567-667b08712e6d' THEN timestamptz '2026-09-05 07:42:25.405740+00'
           WHEN '9bdd65c5-978d-4985-abac-1eb2d448353c' THEN timestamptz '2026-09-05 07:42:25.603400+00'
           WHEN 'c51ad944-a86b-4192-bdc7-0006a5407b05' THEN timestamptz '2026-09-05 07:42:49.200686+00'
         END
   WHERE id IN ('72bdb797-95e5-465d-99e7-5e9ebd028354', 'e1545fc7-b118-4f37-a567-667b08712e6d',
                '9bdd65c5-978d-4985-abac-1eb2d448353c', 'c51ad944-a86b-4192-bdc7-0006a5407b05')
     AND estado_anticipo = 'NO_APLICA';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'ABORTA: las 4 cotizaciones afectaron % filas y se esperaban 4', n; END IF;

  -- Comprobación posterior: valores originales restaurados.
  SELECT count(*) INTO n FROM cotizaciones
   WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462' AND estado_saldo = 'VALIDADO' AND metodo_saldo = 'EFECTIVO'
     AND saldo_confirmado_en = timestamptz '2026-10-27 23:50:04.396977+00'
     AND saldo_confirmado_por = '0d36d17b-1f70-4da3-9780-dadcc154ae91'
     AND actualizado_en = timestamptz '2026-10-27 23:50:04.396977+00' AND estado_anticipo = 'PENDIENTE';
  IF n <> 1 THEN RAISE EXCEPTION 'POSTCONDICIÓN: COT-000001 no recuperó sus valores originales'; END IF;
  SELECT count(*) INTO n FROM cotizaciones WHERE estado = 'ACEPTADA' AND estado_anticipo IS NULL;
  IF n <> 4 THEN RAISE EXCEPTION 'POSTCONDICIÓN: se esperaban 4 ACEPTADAS con anticipo NULL y hay %', n; END IF;
END $$;

SELECT (:'confirmar' = 'SI') AS confirmar_ok \gset
\if :confirmar_ok
  \echo 'COMMIT: reversión guardada'
  COMMIT;
\else
  \echo 'MODO PRUEBA: ROLLBACK — no se guardó ningún cambio'
  ROLLBACK;
\endif
