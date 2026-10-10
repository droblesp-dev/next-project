-- =======================================================================
-- V11 — SOLICITUD-RECUPERACION-01A: Idempotency-Key de POST /api/solicitudes
-- =======================================================================
-- Autorización explícita del usuario (bloque "SOLICITUD-RECUPERACION-01A —
-- IDEMPOTENCIA + PERSISTENCIA LOCAL + CENTRALIZACIÓN WHATSAPP", Bloque D):
-- "Está AUTORIZADA una migración mínima de BD si es técnicamente necesaria
-- para garantizar la idempotencia... Preferencia: columna específica para
-- Idempotency-Key; restricción UNIQUE apropiada."
--
-- Qué agrega: una sola columna + una sola restricción UNIQUE (ninguna
-- estructura adicional, ninguna tabla nueva) — exactamente lo mínimo
-- solicitado, sin ampliar el modelo más allá de lo pedido.
--
-- Por qué es necesaria: sin un respaldo real de BD, "pierde la respuesta
-- pero reintenta" y "dos peticiones simultáneas con la misma operación" no
-- pueden garantizarse con un simple SELECT -> si no existe, INSERT (carrera
-- real, demostrada en la auditoría SOLICITUD-RECUPERACION-01). La
-- restricción UNIQUE es lo que convierte la garantía en algo que respalda
-- PostgreSQL, no la aplicación (ver solicitudes.service.ts::crearSolicitud).
--
-- Mismo patrón ya usado y aprobado para solicitudes.codigo (V10): columna
-- NULLABLE + UNIQUE (PostgreSQL permite múltiples NULL sin conflicto), para
-- no afectar ninguna fila histórica ni al otro llamador existente de
-- solicitudesRepo.create() (crearSolicitudPorEnlace, leads.service.ts, que
-- no envía idempotency_key y sigue comportándose exactamente igual — columna
-- queda NULL para ese flujo, igual que para las ~120 solicitudes históricas
-- actuales). NO se modifica solicitudes.codigo, su sequence, su función ni
-- su trigger — ninguno de los 4 se toca en esta migración.
-- ---------------------------------------------------------------------

ALTER TABLE solicitudes
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);

ALTER TABLE solicitudes
  ADD CONSTRAINT uq_solicitudes_idempotency_key UNIQUE (idempotency_key);

-- Ninguna fila existente se actualiza en esta migración (0 UPDATE/DELETE).
