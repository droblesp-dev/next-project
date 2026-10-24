-- =======================================================================
-- V13 — Fase 1 de PC-2026-01: esquema mínimo de transferencias_pago
-- =======================================================================
-- Autorización explícita del propietario ("NEXTPROJECT PC-2026-01 — Fase 1:
-- esquema de transferencias_pago"), basada en la propuesta documental
-- PC-2026-01 (revisión 5, simplificada para esta primera fase). Esta
-- migración SOLO crea el esquema — no implementa backend, permisos,
-- interfaz ni lógica de negocio, y no toca ninguna columna existente de
-- `cotizaciones`.
--
-- Alcance deliberadamente mínimo (decisión explícita del propietario para
-- esta fase): quedan fuera comprobantes rechazados (motivo, cadena de
-- correcciones), retención/purga, migración de datos históricos,
-- `cuenta_bancaria_id` (depende de la tabla `cuentas_bancarias`, todavía
-- no implementada), y cualquier cambio de permisos/rutas/interfaz.
--
-- `cotizacion_id`, `gestionado_por`, `verificado_por` y `registrado_por`
-- son UUID porque `cotizaciones.id` y `usuarios.id` son UUID (verificado
-- por consulta real a information_schema antes de escribir esta
-- migración, no asumido).
--
-- `ON DELETE RESTRICT` en las referencias a `usuarios`, igual que el
-- patrón ya usado en `fk_cotizaciones_anticipo_confirmado_por` y
-- `fk_cotizaciones_saldo_confirmado_por` — nunca se permite borrar un
-- usuario que ya gestionó, verificó o registró un pago.
--
-- El índice único parcial garantiza, a nivel de PostgreSQL, que exista
-- como máximo un registro `vigente = true` por (cotizacion_id, tipo_pago)
-- — mismo patrón ya usado en `ux_cotizaciones_una_aceptada`.
--
-- Verificación de que `verificado_por` corresponde a un usuario con rol
-- ADMIN: no es expresable como CHECK declarativo de PostgreSQL (exige
-- resolver usuarios.rol_id -> roles.nombre en el momento de la escritura)
-- — queda documentado como responsabilidad del backend en una fase
-- posterior, no de este esquema.
-- ---------------------------------------------------------------------

CREATE TABLE transferencias_pago (
  id                 UUID PRIMARY KEY,
  cotizacion_id      UUID NOT NULL,
  tipo_pago          VARCHAR(10) NOT NULL,
  importe_declarado  NUMERIC(12,2) NOT NULL,
  comprobante_path   TEXT,
  estado             VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  gestionado_por     UUID NOT NULL,
  verificado_por     UUID,
  registrado_por     UUID NOT NULL,
  medio_confirmacion VARCHAR(20),
  vigente            BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transferencias_pago_cotizacion FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id),
  CONSTRAINT fk_transferencias_pago_gestionado_por FOREIGN KEY (gestionado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transferencias_pago_verificado_por FOREIGN KEY (verificado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_transferencias_pago_registrado_por FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_transferencias_pago_tipo_pago CHECK (tipo_pago IN ('ANTICIPO','SALDO')),
  CONSTRAINT chk_transferencias_pago_estado CHECK (estado IN ('PENDIENTE','VALIDADO','RECHAZADO')),
  CONSTRAINT chk_transferencias_pago_medio_confirmacion CHECK (medio_confirmacion IS NULL OR medio_confirmacion IN ('DIRECTO','TELEFONICO')),
  CONSTRAINT chk_transferencias_pago_importe_no_negativo CHECK (importe_declarado >= 0)
);

-- Se crea únicamente el índice único parcial autorizado para esta fase —
-- ningún índice adicional (p. ej. sobre cotizacion_id) que no haya sido
-- pedido explícitamente, para no exceder el alcance autorizado.
CREATE UNIQUE INDEX ux_transferencias_pago_vigente
  ON transferencias_pago (cotizacion_id, tipo_pago) WHERE vigente = TRUE;

-- Ninguna tabla existente se modifica en esta migración (0 ALTER, 0 UPDATE, 0 DELETE).
