-- =======================================================================
-- V18 — Versión de sesión por usuario (invalidar sesiones al cambiar la contraseña)
-- =======================================================================
-- Autorización explícita: "Fase 2C — cambio seguro de contraseña". Estrictamente
-- ADITIVA: agrega una sola columna con valor por defecto; no modifica ni borra datos.
--
-- Los JWT de sesión llevarán la versión (`sv`). En cada request autenticada el servidor
-- compara `sv` con `usuarios.session_version`; al cambiar la contraseña la versión se
-- incrementa y todos los tokens emitidos antes dejan de ser válidos.
--
-- Compatibilidad: los JWT ya emitidos sin `sv` se interpretan como versión 0, igual al
-- valor por defecto, así que siguen siendo válidos hasta el primer cambio de contraseña.
-- ---------------------------------------------------------------------

ALTER TABLE usuarios
  ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
