-- =====================================================================
-- NEXTPROJECT — Migración V0: Esquema base (estado PRE-V1)
-- Reconstruye las 8 tablas originales exactamente en su estado ANTERIOR
-- a V1, de modo que la secuencia de instalación limpia sea:
--
--   V0 → V1 → V2 → V3 → seed inicial (backend/scripts/seed-initial-data.ts)
--
-- y el resultado final reproduzca el esquema actualmente verificado en
-- PostgreSQL. No incluye leads/lead_seguimientos (creadas por V2/V3) ni
-- ninguna columna, constraint, índice, secuencia, función o trigger que
-- V1 agregue posteriormente — esos permanecen exclusivamente en V1.
-- No inserta ningún dato (ni roles ni el primer ADMIN): eso es
-- responsabilidad del script de seed existente, a ejecutar después de
-- aplicar V0+V1+V2+V3.
--
-- Fuente de esta reconstrucción: auditoría en vivo contra PostgreSQL
-- (columnas/constraints/índices reales) + los propios comentarios de
-- auditoría dentro del encabezado de V1__ampliacion_modelo_nextproject.sql
-- (que documenta explícitamente el estado anterior de varias columnas).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) ROLES
-- ---------------------------------------------------------------------
-- [VERIFICADO] Tabla no tocada por V1 (ver encabezado de V1: "Tablas NO
-- tocadas: roles, usuarios, clientes"). Estructura idéntica a la actual.
CREATE TABLE roles (
  id          UUID PRIMARY KEY,
  nombre      VARCHAR(50) NOT NULL,
  descripcion TEXT,
  CONSTRAINT roles_nombre_key UNIQUE (nombre)
);

-- ---------------------------------------------------------------------
-- 2) CLIENTES
-- ---------------------------------------------------------------------
-- [VERIFICADO] Tabla no tocada por V1. Estructura idéntica a la actual
-- (incluye la ausencia deliberada de UNIQUE en `email`, decisión ya
-- documentada de Fase 4 — no se agrega aquí).
CREATE TABLE clientes (
  id        UUID PRIMARY KEY,
  nombre    VARCHAR(150) NOT NULL,
  empresa   VARCHAR(150),
  email     VARCHAR(150) NOT NULL,
  telefono  VARCHAR(30) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 3) USUARIOS
-- ---------------------------------------------------------------------
-- [VERIFICADO] Tabla no tocada por V1. Depende de roles.
CREATE TABLE usuarios (
  id            UUID PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  password_hash TEXT NOT NULL,
  rol_id        UUID NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT usuarios_email_key UNIQUE (email),
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id)
);

CREATE INDEX ix_usuarios_rol_id ON usuarios(rol_id);

-- ---------------------------------------------------------------------
-- 4) SOLICITUDES
-- ---------------------------------------------------------------------
-- [VERIFICADO] Sin `especificaciones` ni `requiere_comprobante`: ambas
-- son agregadas explícitamente por V1 (líneas 25-27 de ese archivo).
-- Resto de la estructura, según auditoría en vivo, no es tocado por V1.
CREATE TABLE solicitudes (
  id              UUID PRIMARY KEY,
  cliente_id      UUID NOT NULL,
  servicio        VARCHAR(150) NOT NULL,
  descripcion     TEXT NOT NULL,
  cantidad        INTEGER NOT NULL,
  fecha_requerida DATE,
  estado          VARCHAR(20) NOT NULL DEFAULT 'NUEVA',
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_solicitudes_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  CONSTRAINT chk_solicitudes_estado CHECK (estado IN ('NUEVA','EN_REVISION','COTIZADA','CANCELADA')),
  CONSTRAINT solicitudes_cantidad_check CHECK (cantidad > 0)
);

CREATE INDEX ix_solicitudes_cliente_id ON solicitudes(cliente_id);

-- ---------------------------------------------------------------------
-- 5) COTIZACIONES
-- ---------------------------------------------------------------------
-- [VERIFICADO] Sin las columnas de IVA/anticipo/vigencia/aceptación ni
-- `descripcion`/`creado_por`/`actualizado_en`: todas agregadas por V1
-- (líneas 49-66 de V1). `valor NOT NULL` sí es pre-V1 (el propio V1,
-- línea 75, dice explícitamente "no se modifica cotizaciones.valor, se
-- conserva NOT NULL tal cual está"). El CHECK de estado con 4 valores
-- (en vez de los 6 actuales) proviene del comentario de auditoría en el
-- encabezado de V1 ("cotizaciones.estado actual: PENDIENTE, ENVIADA,
-- ACEPTADA, RECHAZADA").
--
-- [REQUIERE VALIDACIÓN]
-- DEFAULT histórico de cotizaciones.estado no pudo ser demostrado
-- mediante evidencia versionada suficiente. Se investigó git log, el
-- código fuente del commit original de Fase 7 (ee35a23) y la
-- documentación del proyecto: ningún código de este repositorio llegó
-- a ejecutarse contra este esquema de 4 valores (el primer commit de
-- Fase 7 ya asume el esquema POST-V1, con 'BORRADOR' como estado
-- inicial). El único indicio es el propio comentario condicional de V1
-- ("si apuntaba a 'PENDIENTE'"), que no constituye evidencia suficiente.
-- Se mantiene 'PENDIENTE' aquí de forma PROVISIONAL únicamente por ser
-- el primer valor de la lista auditada — no se presenta como verificado.
-- V1 sobrescribe este DEFAULT a 'BORRADOR' de todas formas, por lo que
-- ninguna instalación que aplique V0+V1 en secuencia se ve afectada por
-- esta incertidumbre.
CREATE TABLE cotizaciones (
  id           UUID PRIMARY KEY,
  solicitud_id UUID NOT NULL,
  valor        NUMERIC(12,2) NOT NULL,
  estado       VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE', -- [REQUIERE VALIDACIÓN]
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cotizaciones_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
  CONSTRAINT chk_cotizaciones_estado CHECK (estado IN ('PENDIENTE','ENVIADA','ACEPTADA','RECHAZADA')),
  CONSTRAINT cotizaciones_valor_check CHECK (valor >= 0)
);

CREATE INDEX ix_cotizaciones_solicitud_id ON cotizaciones(solicitud_id);

-- [VERIFICADO] V1 línea 95: "ux_cotizaciones_una_aceptada: NO SE TOCA.
-- Confirmado existente por auditoría" — por lo tanto es pre-V1.
CREATE UNIQUE INDEX ux_cotizaciones_una_aceptada ON cotizaciones(solicitud_id) WHERE (estado = 'ACEPTADA');

-- ---------------------------------------------------------------------
-- 6) ANALISIS_IA
-- ---------------------------------------------------------------------
-- [VERIFICADO] Columna `prioridad` (no `prioridad_sugerida`): V1 línea 32
-- ejecuta `RENAME COLUMN prioridad TO prioridad_sugerida`, confirmando
-- el nombre original. Sin `revisado`/`revisado_por`/`revisado_en`: las
-- tres son agregadas por V1 (líneas 34-42), junto con su FK
-- `fk_analisis_ia_revisado_por`, que tampoco se incluye aquí.
CREATE TABLE analisis_ia (
  id                        UUID PRIMARY KEY,
  solicitud_id              UUID NOT NULL,
  fecha_hora                TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resultado                 TEXT,
  prioridad                 VARCHAR(10),
  informacion_estructurada  JSONB,
  modelo_ia                 VARCHAR(100),
  version_ia                VARCHAR(50),
  estado                    VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE',
  CONSTRAINT fk_analisis_ia_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
  CONSTRAINT chk_analisis_ia_estado CHECK (estado IN ('PENDIENTE','PROCESANDO','COMPLETADO','ERROR')),
  CONSTRAINT chk_analisis_ia_prioridad CHECK (prioridad IS NULL OR prioridad IN ('ALTA','MEDIA','BAJA'))
);

CREATE INDEX ix_analisis_ia_solicitud_id ON analisis_ia(solicitud_id);

-- ---------------------------------------------------------------------
-- 7) ORDENES
-- ---------------------------------------------------------------------
-- [VERIFICADO] Sin `codigo`/`descripcion`/`fecha_programada`/
-- `fecha_finalizacion`/`fecha_cierre`/`observaciones`, sin la secuencia
-- `ordenes_codigo_seq`, sin la función `fn_ordenes_generar_codigo()` y
-- sin el trigger `trg_ordenes_generar_codigo` — todo agregado por V1
-- (líneas 132-169). El CHECK de estado con 4 valores (sin CERRADA)
-- proviene del comentario de auditoría en el encabezado de V1
-- ("ordenes.estado actual: PENDIENTE, EN_PROCESO, FINALIZADA,
-- CANCELADA"). `chk_ordenes_fechas` sí es pre-V1 (V1 línea 141: "NO SE
-- TOCA. Confirmado existente por auditoría").
CREATE TABLE ordenes (
  id             UUID PRIMARY KEY,
  cotizacion_id  UUID NOT NULL,
  responsable_id UUID,
  estado         VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  fecha_inicio   DATE,
  fecha_entrega  DATE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ordenes_cotizacion_id_key UNIQUE (cotizacion_id),
  CONSTRAINT fk_ordenes_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id),
  CONSTRAINT fk_ordenes_responsable FOREIGN KEY (responsable_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT chk_ordenes_estado CHECK (estado IN ('PENDIENTE','EN_PROCESO','FINALIZADA','CANCELADA')),
  CONSTRAINT chk_ordenes_fechas CHECK (fecha_entrega IS NULL OR fecha_inicio IS NULL OR fecha_entrega >= fecha_inicio)
);

-- ---------------------------------------------------------------------
-- 8) ALERTAS
-- ---------------------------------------------------------------------
-- [VERIFICADO] Sin `leida`/`leida_en`: ambas agregadas por V1
-- (líneas 186-188).
CREATE TABLE alertas (
  id        UUID PRIMARY KEY,
  orden_id  UUID NOT NULL,
  tipo      VARCHAR(50) NOT NULL,
  condicion VARCHAR(100) NOT NULL,
  mensaje   TEXT NOT NULL,
  estado    VARCHAR(15) NOT NULL DEFAULT 'PENDIENTE',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alertas_orden FOREIGN KEY (orden_id) REFERENCES ordenes(id),
  CONSTRAINT chk_alertas_estado CHECK (estado IN ('PENDIENTE','ENVIADA','ATENDIDA','CANCELADA'))
);

CREATE INDEX ix_alertas_orden_id ON alertas(orden_id);
CREATE UNIQUE INDEX ux_alertas_orden_tipo_condicion ON alertas(orden_id, tipo, condicion);

COMMIT;

-- =====================================================================
-- FIN DE V0. Estado resultante: esquema PRE-V1.
-- Siguiente paso de una instalación limpia: ejecutar, en orden,
-- V1__ampliacion_modelo_nextproject.sql, V2__mini_crm_leads.sql,
-- V3__lead_seguimientos.sql, y finalmente el script de seed
-- (backend/scripts/generate-admin-hash.ts + seed-initial-data.ts).
-- No se insertan datos en este archivo.
-- =====================================================================
