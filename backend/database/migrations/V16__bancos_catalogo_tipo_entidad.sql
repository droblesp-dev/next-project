-- =======================================================================
-- V16 — PC-2026-01, Fase 1: tipo de entidad financiera (BANCO/COOPERATIVA)
-- =======================================================================
-- Autorización explícita del propietario ("PC-2026-01 — Fase 1:
-- Incorporar tipos de entidad financiera"), basada en la propuesta técnica
-- de la auditoría previa ("Ampliación del catálogo financiero"). Solo
-- esquema, aditiva. NO aplicada a `nextproject` en esta fase — exige una
-- autorización adicional explícita (mismo criterio ya usado para
-- V13/V14/V15), verificada únicamente contra `nextproject_test`.
--
-- Una sola columna en la tabla ya existente (`bancos_catalogo`) — decisión
-- explícita de la auditoría previa: banco y cooperativa comparten
-- exactamente la misma estructura (nombre, logo, verificación), así que
-- una tabla separada duplicaría repositorio/servicio/controlador sin
-- necesidad. `DEFAULT 'BANCO'` clasifica automáticamente los 17 registros
-- ya existentes, sin backfill manual y sin riesgo (PostgreSQL 18: un
-- `ADD COLUMN` con default constante es solo metadatos, no reescribe la
-- tabla).
--
-- Esta fase NO agrega `logo_oficial_path` ni ningún mecanismo de
-- restauración de logos (decisión explícita del propietario para esta
-- fase) — eso queda para una fase posterior, si se autoriza.
--
-- Ninguna fila existente de `bancos_catalogo` pierde datos (0 UPDATE
-- manual necesario — el DEFAULT lo resuelve PostgreSQL al aplicar el
-- ALTER). Ninguna otra tabla se modifica.
-- ---------------------------------------------------------------------

ALTER TABLE bancos_catalogo
  ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'BANCO';

ALTER TABLE bancos_catalogo
  ADD CONSTRAINT chk_bancos_catalogo_tipo CHECK (tipo IN ('BANCO', 'COOPERATIVA'));
