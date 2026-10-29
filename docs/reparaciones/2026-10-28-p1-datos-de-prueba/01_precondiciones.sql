-- 01_precondiciones.sql — COMPROBACIONES PREVIAS (solo lectura). Se incluye desde reparar_p1.sql, dentro de
-- una transacción ya abierta. Cualquier condición que no coincida lanza una excepción y, con
-- ON_ERROR_STOP, aborta TODO. Requiere: psql -v expected_db=<nombre de la base>.
--
-- Los registros se identifican SIEMPRE por UUID completo (nunca por código: COT-000001 existe también en
-- otras bases con otro id).
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('app.expected_db', :'expected_db', true);

-- 1) Identidad de la base.
DO $$
BEGIN
  IF current_setting('app.expected_db') NOT IN ('nextproject', 'nextproject_test') THEN
    RAISE EXCEPTION 'ABORTA: expected_db inválido (%)', current_setting('app.expected_db');
  END IF;
  IF current_database() <> current_setting('app.expected_db') THEN
    RAISE EXCEPTION 'ABORTA: la base conectada es "%" y se esperaba "%"', current_database(), current_setting('app.expected_db');
  END IF;
END $$;

-- 2) COT-000001: estado exacto esperado (id 75f33350-…).
DO $$
DECLARE
  c record;
  t record;
  n integer;
BEGIN
  SELECT count(*) INTO n FROM cotizaciones WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462';
  IF n <> 1 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: no existe la cotización 75f33350-e236-46e4-8072-b1a91ec16462 en %', current_database();
  END IF;
  SELECT * INTO c FROM cotizaciones WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462';
  IF c.codigo IS DISTINCT FROM 'COT-000001'
     OR c.estado <> 'ACEPTADA'
     OR c.estado_anticipo IS DISTINCT FROM 'PENDIENTE'
     OR c.comprobante_anticipo IS DISTINCT FROM 'c191ddbf-8110-408f-9709-79333604f08c.png'
     OR c.anticipo_confirmado_en IS NOT NULL
     OR c.estado_saldo <> 'VALIDADO'
     OR c.metodo_saldo IS DISTINCT FROM 'EFECTIVO'
     OR c.comprobante_saldo IS NOT NULL
     OR c.saldo_confirmado_por IS DISTINCT FROM '0d36d17b-1f70-4da3-9780-dadcc154ae91'
     OR c.saldo_confirmado_en IS DISTINCT FROM timestamptz '2026-10-27 23:50:04.396977+00'
     OR c.actualizado_en IS DISTINCT FROM timestamptz '2026-10-27 23:50:04.396977+00' THEN
    RAISE EXCEPTION 'PRECONDICIÓN: COT-000001 no está en el estado esperado (anticipo=%, saldo=%, metodo_saldo=%)',
      c.estado_anticipo, c.estado_saldo, c.metodo_saldo;
  END IF;
  SELECT count(*) INTO n FROM ordenes WHERE cotizacion_id = c.id;
  IF n <> 0 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: COT-000001 tiene % órdenes y se esperaban 0', n;
  END IF;

  -- La fila de saldo VALIDADO que se invalidará: exacta y única.
  SELECT count(*) INTO n FROM transferencias_pago WHERE cotizacion_id = c.id;
  IF n <> 1 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: COT-000001 tiene % filas en transferencias_pago y se esperaba 1', n;
  END IF;
  SELECT * INTO t FROM transferencias_pago WHERE id = '101897f5-8071-4745-9705-8f1799e5819a';
  IF NOT FOUND
     OR t.cotizacion_id <> c.id
     OR t.tipo_pago <> 'SALDO'
     OR t.estado <> 'VALIDADO'
     OR t.vigente IS NOT TRUE
     OR t.medio_confirmacion IS DISTINCT FROM 'DIRECTO'
     OR t.creado_en IS DISTINCT FROM timestamptz '2026-10-27 23:50:04.396977+00' THEN
    RAISE EXCEPTION 'PRECONDICIÓN: la fila de transferencias_pago 101897f5-… no es la esperada';
  END IF;
END $$;

-- 3) Las cuatro cotizaciones ACEPTADAS con anticipo NULL (y solo ellas).
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM cotizaciones
   WHERE id IN ('72bdb797-95e5-465d-99e7-5e9ebd028354', 'e1545fc7-b118-4f37-a567-667b08712e6d',
                '9bdd65c5-978d-4985-abac-1eb2d448353c', 'c51ad944-a86b-4192-bdc7-0006a5407b05')
     AND estado = 'ACEPTADA' AND estado_anticipo IS NULL
     AND anticipo_porcentaje IS NULL AND metodo_anticipo IS NULL AND comprobante_anticipo IS NULL
     AND anticipo_confirmado_en IS NULL AND anticipo_confirmado_por IS NULL
     AND estado_saldo = 'PENDIENTE' AND metodo_saldo IS NULL AND comprobante_saldo IS NULL;
  IF n <> 4 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: de las 4 cotizaciones con anticipo NULL solo % cumplen el estado esperado', n;
  END IF;
  SELECT count(*) INTO n FROM cotizaciones WHERE estado = 'ACEPTADA' AND estado_anticipo IS NULL;
  IF n <> 4 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: hay % cotizaciones ACEPTADAS con anticipo NULL y se esperaban exactamente 4', n;
  END IF;
  -- Las otras 4 con NULL (no aceptadas) deben seguir siendo exactamente esas y NO se tocan.
  SELECT count(*) INTO n FROM cotizaciones
   WHERE estado_anticipo IS NULL AND estado <> 'ACEPTADA'
     AND id IN ('202fc71b-e0cb-49ae-b7fa-1bbf1c7d2c83', '338e9891-fd42-4721-9e4b-a31def6ec778',
                '73517119-2c38-465c-a823-3bf4f8e3f3c6', 'd93b2252-6dde-49ae-bfb1-a715ae74f259');
  IF n <> 4 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: las otras cotizaciones con anticipo NULL no son las 4 esperadas (coinciden %)', n;
  END IF;
  SELECT count(*) INTO n FROM cotizaciones WHERE estado_anticipo IS NULL AND estado <> 'ACEPTADA';
  IF n <> 4 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: hay % cotizaciones no aceptadas con anticipo NULL y se esperaban 4', n;
  END IF;
END $$;

-- 4) Invariantes globales de partida: el ÚNICO saldo gestionado con el anticipo sin resolver es COT-000001, y
--    las 17 históricas siguen siendo exactamente 17.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM cotizaciones
   WHERE estado_saldo <> 'PENDIENTE' AND (estado_anticipo IS NULL OR estado_anticipo NOT IN ('VALIDADO', 'NO_APLICA'));
  IF n <> 1 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: hay % cotizaciones con saldo gestionado y anticipo sin resolver y se esperaba 1', n;
  END IF;
  SELECT count(*) INTO n FROM cotizaciones c
   WHERE c.estado_anticipo = 'VALIDADO'
     AND NOT EXISTS (SELECT 1 FROM transferencias_pago t
                      WHERE t.cotizacion_id = c.id AND t.tipo_pago = 'ANTICIPO' AND t.estado = 'VALIDADO');
  IF n <> 17 THEN
    RAISE EXCEPTION 'PRECONDICIÓN: hay % anticipos VALIDADO sin fila VALIDADO y se esperaban 17', n;
  END IF;
END $$;
