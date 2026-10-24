-- =======================================================================
-- V15 — PC-2026-01: catálogo de bancos (Ecuador) + logo + visibilidad del
-- titular en cuentas_bancarias
-- =======================================================================
-- Autorización explícita del propietario ("PC-2026-01 — Implementación
-- completa de Gestión de Cuentas Bancarias de NextProject", Fase G): solo
-- esquema, aditiva. NO aplicada a `nextproject` en esta tarea — exige una
-- autorización adicional explícita (mismo criterio ya usado para V13/V14),
-- verificada únicamente contra `nextproject_test`.
--
-- `bancos_catalogo` es independiente de `cuentas_bancarias` (decisión 8 de
-- la autorización): registra el NOMBRE de una entidad bancaria y,
-- opcionalmente, su logo — nunca implica que exista una cuenta receptora
-- para ese banco. `nombre_normalizado` (trim + minúsculas + espacios
-- colapsados, calculado en el backend) tiene un índice único para evitar
-- duplicados por variantes de mayúsculas/espacios del mismo nombre (regla
-- 6 del catálogo) — la igualdad léxica exacta es la estrategia de
-- deduplicación elegida; no intenta resolver sinónimos/abreviaturas.
--
-- `cuentas_bancarias.banco_catalogo_id` enlaza la cuenta con la entidad
-- del catálogo elegida; se deja NULLABLE (igual que el resto de columnas
-- nuevas de V14) porque la obligatoriedad real es una regla de negocio del
-- backend, no un constraint de esquema (CLAUDE.md §10) — toda cuenta
-- creada por el flujo nuevo del backend la tendrá siempre, pero el
-- esquema no la impone por sí solo. La columna `banco` (VARCHAR, ya
-- existente desde V14) se conserva sin cambios: el backend la sincroniza
-- con el nombre del banco del catálogo al momento de crear/editar la
-- cuenta (mismo criterio "snapshot" ya usado en `transferencias_pago.
-- *_snapshot`), así ninguna consulta existente que ya lea `cuentas_
-- bancarias.banco` se rompe.
--
-- `titular_visible_cliente` (decisión 6): por cuenta individual, decide si
-- el nombre del titular se expone en la vista pública del cliente.
-- `DEFAULT TRUE` conserva el comportamiento actual (el titular ya se
-- muestra siempre hoy en `datos_bancarios`/`cuentas_bancarias_activas`).
--
-- Ninguna fila existente de `cuentas_bancarias` ni de ninguna otra tabla
-- se modifica (0 UPDATE/DELETE) — en `nextproject_test`, igual que en
-- `nextproject`, `cuentas_bancarias` está vacía en este momento.
-- ---------------------------------------------------------------------

CREATE TABLE bancos_catalogo (
  id                  UUID PRIMARY KEY,
  nombre              VARCHAR(150) NOT NULL,
  nombre_normalizado  VARCHAR(150) NOT NULL,
  logo_path           TEXT,
  creado_por          UUID NOT NULL,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bancos_catalogo_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT ux_bancos_catalogo_nombre_normalizado UNIQUE (nombre_normalizado)
);

ALTER TABLE cuentas_bancarias
  ADD COLUMN banco_catalogo_id        UUID,
  ADD COLUMN titular_visible_cliente  BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE cuentas_bancarias
  ADD CONSTRAINT fk_cuentas_bancarias_banco_catalogo
    FOREIGN KEY (banco_catalogo_id) REFERENCES bancos_catalogo(id) ON DELETE RESTRICT;

-- Ninguna tabla pierde filas ni valores existentes en esta migración
-- (0 UPDATE, 0 DELETE sobre cotizaciones/transferencias_pago/cuentas_bancarias).
-- El catálogo inicial de bancos de Ecuador (Fase B) NO se siembra aquí —
-- es responsabilidad de backend/scripts/seed-bancos-catalogo.ts (mismo
-- criterio ya usado por scripts/seed-usuarios-roles.ts: datos, no
-- esquema, nunca embebidos en un archivo de migración).
