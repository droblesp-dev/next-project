-- =====================================================================
-- NEXTPROJECT — Migración V4: código de acceso seguro para cotizaciones
-- Agrega EXCLUSIVAMENTE la columna necesaria para el segundo factor de
-- verificación del enlace público de cotización (Fase B — vista de
-- cliente, decisión aprobada explícitamente). No modifica V0/V1/V2/V3
-- ni ninguna otra tabla.
--
-- El campo almacena únicamente el HASH bcrypt del código de 6 dígitos
-- entregado al comercial — nunca el código en texto plano. Se
-- sobrescribe cada vez que se genera un nuevo enlace (invalida el
-- código anterior sin necesidad de una columna de versión adicional).
-- =====================================================================

BEGIN;

ALTER TABLE cotizaciones
  ADD COLUMN IF NOT EXISTS acceso_codigo_hash VARCHAR(255);

COMMIT;

-- =====================================================================
-- FIN DE LA MIGRACIÓN V4
-- Tabla afectada: cotizaciones (1 columna nueva, nullable).
-- Ninguna otra tabla fue modificada.
-- =====================================================================
