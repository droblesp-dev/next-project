# Reparación P1 de datos de prueba (2026-10-28)

Base: `nextproject` (desarrollo). Datos de prueba identificados por UUID completo.

## Qué se corrigió
- **COT-000001** (`75f33350-e236-46e4-8072-b1a91ec16462`): tenía el saldo VALIDADO con el anticipo PENDIENTE
  (originado por una prueba de la regla F1). El saldo volvió a PENDIENTE y la fila de saldo VALIDADO
  (`101897f5-8071-4745-9705-8f1799e5819a`) se conservó como evidencia con `vigente = false`.
- **Cuatro cotizaciones ACEPTADAS con `estado_anticipo` NULL** (`72bdb797…`, `e1545fc7…`, `9bdd65c5…`, `c51ad944…`,
  anteriores a la regla D.2): pasaron a `NO_APLICA`.
- No se tocaron las otras 4 cotizaciones con NULL ni las 17 históricas con anticipo VALIDADO sin fila en
  `transferencias_pago` (anteriores al historial de pagos).

## Archivos
- `reparar_p1.sql`: una transacción con comprobaciones previas, número exacto de filas y comprobaciones posteriores
  (huellas MD5 de todo lo que no debe cambiar). Por defecto termina en ROLLBACK; `-v confirmar=SI` hace COMMIT.
- `01_precondiciones.sql`: comprobaciones previas (incluidas por el anterior).
- `revertir_p1.sql`: reversión exacta a los valores originales.

Uso: `psql -h localhost -p 5432 -U postgres -d nextproject -v expected_db=nextproject [-v confirmar=SI] -f reparar_p1.sql`

## Ejecución
Respaldo previo `nextproject_20261028_193012.dump` (pg_dump -Fc, verificado con pg_restore --list), fuera del repositorio.
Prueba (ROLLBACK) correcta y aplicación con COMMIT; resultado verificado: 0 aceptadas con anticipo NULL, 0 saldos gestionados
con el anticipo sin resolver, 17 históricas sin cambios, mismos totales (115 cotizaciones, 13 transferencias, 52 órdenes).
