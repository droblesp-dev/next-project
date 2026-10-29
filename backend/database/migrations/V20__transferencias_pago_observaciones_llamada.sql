-- =======================================================================
-- V20 — Trazabilidad de la confirmación de pagos («Dinero acreditado»)
-- =======================================================================
-- Fase 2 del flujo de anticipos y saldos. ADMIN verifica verbalmente que el dinero ingresó y COMERCIAL lo registra
-- en NextProject. `transferencias_pago` ya conserva quién verificó (`verificado_por`, un ADMIN), quién registró
-- (`registrado_por`), el medio (`medio_confirmacion`) y la fecha y hora del REGISTRO en el sistema (`creado_en`).
-- Faltaba dónde guardar:
--   * `observaciones`: texto libre del seguimiento («ADMIN no respondió», «el dinero todavía no aparece»…). El pago
--     sigue PENDIENTE: no se crea ningún estado nuevo.
--   * `llamada_en`: fecha y hora REAL de la llamada con ADMIN, solo cuando se conoce (NULL si no). No se rellena
--     nunca con `creado_en`: son hechos distintos.
-- Estrictamente ADITIVA: dos columnas opcionales; ninguna fila existente cambia (quedan en NULL) y ninguna
-- restricción existente se modifica.
-- ---------------------------------------------------------------------

ALTER TABLE transferencias_pago
  ADD COLUMN observaciones TEXT NULL,
  ADD COLUMN llamada_en TIMESTAMPTZ NULL;
