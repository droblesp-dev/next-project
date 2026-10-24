-- =======================================================================
-- V17 — PC-2026-01, Fase B: logo propio por cuenta bancaria
-- =======================================================================
-- Autorización explícita del propietario (opción A de la auditoría de
-- logos compartidos). Solo esquema, aditiva. NO aplicada a `nextproject`
-- en esta fase — exige una autorización adicional explícita (mismo
-- criterio ya usado para V13 a V16), verificada únicamente contra
-- `nextproject_test`.
--
-- Hasta V16 el logo vivía solo en `bancos_catalogo.logo_path` y era
-- compartido por todas las cuentas de una entidad: subir o quitar el logo
-- desde una cuenta cambiaba el de todas (y el de la vista pública de
-- cotizaciones). Con esta columna cada cuenta puede tener su logo propio:
--
--   logo mostrado = COALESCE(cuentas_bancarias.logo_path,
--                            bancos_catalogo.logo_path)
--
-- NULL significa "sin logo propio: hereda el de la entidad del catálogo".
-- No hay backfill: las cuentas existentes siguen mostrando exactamente el
-- logo que ya mostraban. `bancos_catalogo.logo_path` NO se modifica ni se
-- elimina — queda como logo compartido de la entidad (p. ej. los logos
-- oficiales sembrados), y ninguna operación sobre una cuenta lo escribe.
--
-- Ningún archivo en disco se elimina con esta migración.
-- ---------------------------------------------------------------------

ALTER TABLE cuentas_bancarias
  ADD COLUMN logo_path TEXT;
