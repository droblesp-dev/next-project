-- FASE 10 — CORRECCIÓN DE SEGUIMIENTO
-- Crea EXCLUSIVAMENTE la tabla `lead_seguimientos`. No modifica `leads` ni
-- ninguna de las 8 tablas originales. Ningún ALTER TABLE en esta migración.
-- `leads.ultimo_contacto/proximo_seguimiento/observaciones` se conservan
-- sin eliminar, aunque dejan de ser el mecanismo principal de historial.

CREATE TABLE lead_seguimientos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES leads(id),
  comercial_id  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo          VARCHAR(20) NOT NULL,
  observacion   TEXT,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_lead_seguimientos_tipo
    CHECK (tipo IN ('LLAMADA','WHATSAPP','EMAIL','VISITA','OTRO'))
);

CREATE INDEX ix_lead_seguimientos_lead_id ON lead_seguimientos(lead_id);
