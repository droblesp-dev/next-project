-- reparar_p1.sql — REPARACIÓN FINANCIERA P1 (propuesta; NO ejecutada).
--   1) COT-000001: saldo VALIDADO -> PENDIENTE y fila de saldo VALIDADO invalidada (vigente = false), conservada
--      como evidencia (no se borra ni se cambia su estado).
--   2) Las cuatro cotizaciones ACEPTADAS con anticipo NULL: estado_anticipo = 'NO_APLICA' (solo esa columna).
--   No toca: las otras 4 cotizaciones con anticipo NULL, las 17 históricas, ninguna orden ni otra tabla.
--
-- Uso (PRUEBA, por defecto: ejecuta todo y termina en ROLLBACK):
--   psql -h localhost -p 5432 -U postgres -d <base> -v expected_db=<base> -f reparar_p1.sql
-- Uso (aplicar de verdad, solo con autorización expresa y respaldo previo verificado):
--   psql ... -v expected_db=<base> -v confirmar=SI -f reparar_p1.sql
--
-- Todo ocurre en UNA transacción; cualquier fallo (psql con ON_ERROR_STOP) la revierte entera.
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

\echo '== Reparación P1 — base esperada:' :expected_db ' | confirmar =' :confirmar
BEGIN;

-- Bloqueo de escritura durante la transacción (las lecturas siguen permitidas): si hay actividad concurrente
-- sobre estas tablas, el lock_timeout de 5 s aborta en lugar de esperar.
SET LOCAL lock_timeout = '5s';
LOCK TABLE cotizaciones, transferencias_pago IN SHARE ROW EXCLUSIVE MODE;

-- Comprobaciones previas (identidad de la base, estado exacto de cada registro, invariantes de partida).
\ir 01_precondiciones.sql

-- Huellas de TODO lo que no debe cambiar (se comparan al final).
SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), '')) AS b_cot
  FROM cotizaciones c
 WHERE c.id NOT IN ('75f33350-e236-46e4-8072-b1a91ec16462', '72bdb797-95e5-465d-99e7-5e9ebd028354',
                    'e1545fc7-b118-4f37-a567-667b08712e6d', '9bdd65c5-978d-4985-abac-1eb2d448353c',
                    'c51ad944-a86b-4192-bdc7-0006a5407b05') \gset
SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '|' ORDER BY t.id), '')) AS b_tp
  FROM transferencias_pago t WHERE t.id <> '101897f5-8071-4745-9705-8f1799e5819a' \gset
SELECT md5(coalesce(string_agg(to_jsonb(o)::text, '|' ORDER BY o.id), '')) AS b_ord FROM ordenes o \gset
SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) AS b_comp FROM comprobantes_pago_cliente p \gset
SELECT (SELECT count(*) FROM cotizaciones) AS b_n_cot, (SELECT count(*) FROM transferencias_pago) AS b_n_tp \gset
SELECT set_config('app.b_cot', :'b_cot', true), set_config('app.b_tp', :'b_tp', true),
       set_config('app.b_ord', :'b_ord', true), set_config('app.b_comp', :'b_comp', true),
       set_config('app.b_n_cot', :'b_n_cot', true), set_config('app.b_n_tp', :'b_n_tp', true);

-- Cambios, cada uno con validación del número EXACTO de filas afectadas.
DO $$
DECLARE
  n integer;
BEGIN
  -- 1a) COT-000001: el saldo vuelve a PENDIENTE (método y confirmación a NULL). El anticipo no se toca.
  UPDATE cotizaciones
     SET estado_saldo = 'PENDIENTE', metodo_saldo = NULL,
         saldo_confirmado_en = NULL, saldo_confirmado_por = NULL, actualizado_en = CURRENT_TIMESTAMP
   WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462'
     AND estado = 'ACEPTADA' AND estado_anticipo = 'PENDIENTE' AND estado_saldo = 'VALIDADO';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORTA: COT-000001 afectó % filas y se esperaba 1', n; END IF;

  -- 1b) La fila de saldo VALIDADO se conserva como evidencia: solo deja de ser la vigente.
  UPDATE transferencias_pago SET vigente = false
   WHERE id = '101897f5-8071-4745-9705-8f1799e5819a'
     AND cotizacion_id = '75f33350-e236-46e4-8072-b1a91ec16462'
     AND tipo_pago = 'SALDO' AND estado = 'VALIDADO' AND vigente = true;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'ABORTA: la fila de saldo afectó % filas y se esperaba 1', n; END IF;

  -- 2) Las cuatro ACEPTADAS con anticipo NULL pasan a NO_APLICA (únicamente esa columna).
  UPDATE cotizaciones
     SET estado_anticipo = 'NO_APLICA', actualizado_en = CURRENT_TIMESTAMP
   WHERE id IN ('72bdb797-95e5-465d-99e7-5e9ebd028354', 'e1545fc7-b118-4f37-a567-667b08712e6d',
                '9bdd65c5-978d-4985-abac-1eb2d448353c', 'c51ad944-a86b-4192-bdc7-0006a5407b05')
     AND estado = 'ACEPTADA' AND estado_anticipo IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 4 THEN RAISE EXCEPTION 'ABORTA: las cotizaciones con anticipo NULL afectaron % filas y se esperaban 4', n; END IF;
END $$;

-- Comprobaciones posteriores (dentro de la misma transacción; si algo no coincide, se aborta todo).
DO $$
DECLARE
  c record;
  n integer;
  h text;
BEGIN
  SELECT * INTO c FROM cotizaciones WHERE id = '75f33350-e236-46e4-8072-b1a91ec16462';
  IF c.estado_saldo <> 'PENDIENTE' OR c.metodo_saldo IS NOT NULL OR c.saldo_confirmado_en IS NOT NULL
     OR c.saldo_confirmado_por IS NOT NULL OR c.estado_anticipo IS DISTINCT FROM 'PENDIENTE'
     OR c.comprobante_anticipo IS DISTINCT FROM 'c191ddbf-8110-408f-9709-79333604f08c.png' THEN
    RAISE EXCEPTION 'POSTCONDICIÓN: COT-000001 no quedó como se esperaba';
  END IF;

  -- La fila sigue existiendo, sigue VALIDADO (evidencia) y ya no es vigente; no queda ninguna vigente de saldo.
  SELECT count(*) INTO n FROM transferencias_pago
   WHERE id = '101897f5-8071-4745-9705-8f1799e5819a' AND estado = 'VALIDADO' AND vigente = false AND tipo_pago = 'SALDO';
  IF n <> 1 THEN RAISE EXCEPTION 'POSTCONDICIÓN: la fila de saldo no quedó conservada y no vigente'; END IF;
  SELECT count(*) INTO n FROM transferencias_pago
   WHERE cotizacion_id = '75f33350-e236-46e4-8072-b1a91ec16462' AND tipo_pago = 'SALDO' AND vigente = true;
  IF n <> 0 THEN RAISE EXCEPTION 'POSTCONDICIÓN: COT-000001 conserva % filas vigentes de saldo', n; END IF;

  SELECT count(*) INTO n FROM cotizaciones
   WHERE id IN ('72bdb797-95e5-465d-99e7-5e9ebd028354', 'e1545fc7-b118-4f37-a567-667b08712e6d',
                '9bdd65c5-978d-4985-abac-1eb2d448353c', 'c51ad944-a86b-4192-bdc7-0006a5407b05')
     AND estado_anticipo = 'NO_APLICA' AND estado = 'ACEPTADA' AND estado_saldo = 'PENDIENTE';
  IF n <> 4 THEN RAISE EXCEPTION 'POSTCONDICIÓN: solo % de las 4 cotizaciones quedaron en NO_APLICA', n; END IF;
  SELECT count(*) INTO n FROM cotizaciones WHERE estado = 'ACEPTADA' AND estado_anticipo IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'POSTCONDICIÓN: quedan % ACEPTADAS con anticipo NULL', n; END IF;
  SELECT count(*) INTO n FROM cotizaciones WHERE estado <> 'ACEPTADA' AND estado_anticipo IS NULL;
  IF n <> 4 THEN RAISE EXCEPTION 'POSTCONDICIÓN: las otras cotizaciones con NULL cambiaron (hay %, esperadas 4)', n; END IF;

  -- Invariante F1 restablecido: ningún saldo gestionado con el anticipo sin resolver.
  SELECT count(*) INTO n FROM cotizaciones
   WHERE estado_saldo <> 'PENDIENTE' AND (estado_anticipo IS NULL OR estado_anticipo NOT IN ('VALIDADO', 'NO_APLICA'));
  IF n <> 0 THEN RAISE EXCEPTION 'POSTCONDICIÓN: quedan % saldos gestionados con el anticipo sin resolver', n; END IF;

  -- Las 17 históricas siguen siendo exactamente las mismas 17.
  SELECT count(*) INTO n FROM cotizaciones c2
   WHERE c2.estado_anticipo = 'VALIDADO'
     AND NOT EXISTS (SELECT 1 FROM transferencias_pago t WHERE t.cotizacion_id = c2.id AND t.tipo_pago = 'ANTICIPO' AND t.estado = 'VALIDADO');
  IF n <> 17 THEN RAISE EXCEPTION 'POSTCONDICIÓN: las históricas son % y debían seguir siendo 17', n; END IF;

  -- Nada más cambió: huellas idénticas y mismos totales (ni filas nuevas ni borradas).
  SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) INTO h FROM cotizaciones x
   WHERE x.id NOT IN ('75f33350-e236-46e4-8072-b1a91ec16462', '72bdb797-95e5-465d-99e7-5e9ebd028354',
                      'e1545fc7-b118-4f37-a567-667b08712e6d', '9bdd65c5-978d-4985-abac-1eb2d448353c',
                      'c51ad944-a86b-4192-bdc7-0006a5407b05');
  IF h <> current_setting('app.b_cot') THEN RAISE EXCEPTION 'POSTCONDICIÓN: otras cotizaciones cambiaron'; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) INTO h FROM transferencias_pago x
   WHERE x.id <> '101897f5-8071-4745-9705-8f1799e5819a';
  IF h <> current_setting('app.b_tp') THEN RAISE EXCEPTION 'POSTCONDICIÓN: otras transferencias cambiaron'; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) INTO h FROM ordenes x;
  IF h <> current_setting('app.b_ord') THEN RAISE EXCEPTION 'POSTCONDICIÓN: las órdenes cambiaron'; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) INTO h FROM comprobantes_pago_cliente x;
  IF h <> current_setting('app.b_comp') THEN RAISE EXCEPTION 'POSTCONDICIÓN: los comprobantes del cliente cambiaron'; END IF;
  IF (SELECT count(*) FROM cotizaciones) <> current_setting('app.b_n_cot')::bigint
     OR (SELECT count(*) FROM transferencias_pago) <> current_setting('app.b_n_tp')::bigint THEN
    RAISE EXCEPTION 'POSTCONDICIÓN: cambió el número total de cotizaciones o de transferencias';
  END IF;
END $$;

\echo '-- Resultado dentro de la transacción (aún sin confirmar):'
SELECT left(id::text, 8) AS id, codigo, estado_anticipo, estado_saldo, metodo_saldo, saldo_confirmado_en
  FROM cotizaciones
 WHERE id IN ('75f33350-e236-46e4-8072-b1a91ec16462', '72bdb797-95e5-465d-99e7-5e9ebd028354',
              'e1545fc7-b118-4f37-a567-667b08712e6d', '9bdd65c5-978d-4985-abac-1eb2d448353c',
              'c51ad944-a86b-4192-bdc7-0006a5407b05')
 ORDER BY codigo NULLS LAST, id;
SELECT left(id::text, 8) AS id, tipo_pago, estado, vigente
  FROM transferencias_pago WHERE cotizacion_id = '75f33350-e236-46e4-8072-b1a91ec16462';

-- Confirmación explícita: sin -v confirmar=SI el resultado es ROLLBACK (modo prueba).
SELECT (:'confirmar' = 'SI') AS confirmar_ok \gset
\if :confirmar_ok
  \echo 'COMMIT: cambios guardados'
  COMMIT;
\else
  \echo 'MODO PRUEBA: ROLLBACK — no se guardó ningún cambio'
  ROLLBACK;
\endif
