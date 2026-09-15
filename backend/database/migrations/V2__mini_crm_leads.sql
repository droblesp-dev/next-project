-- FASE 10 — MINI CRM
-- Crea EXCLUSIVAMENTE la tabla `leads`. No modifica ninguna de las 8 tablas
-- existentes (roles, usuarios, clientes, solicitudes, analisis_ia,
-- cotizaciones, ordenes, alertas). Ningún ALTER TABLE en esta migración.
--
-- Relaciones (todas nullable, hacia tablas ya existentes, sin tocarlas):
--   leads.comercial_id -> usuarios.id  (ON DELETE SET NULL, mismo patrón que ordenes.responsable_id)
--   leads.cliente_id   -> clientes.id
--   leads.solicitud_id -> solicitudes.id

CREATE TABLE leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              VARCHAR(150) NOT NULL,
  telefono            VARCHAR(30) NOT NULL,
  email               VARCHAR(150),
  fuente              VARCHAR(20) NOT NULL,
  estado              VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  clasificacion       VARCHAR(20) NOT NULL DEFAULT 'FRIO',
  comercial_id        UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  cliente_id          UUID REFERENCES clientes(id),
  solicitud_id        UUID REFERENCES solicitudes(id),
  ultimo_contacto     TIMESTAMPTZ,
  proximo_seguimiento TIMESTAMPTZ,
  observaciones       TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_leads_fuente CHECK (fuente IN ('WEB','WHATSAPP','FACEBOOK','INSTAGRAM','TIKTOK','REFERIDO','OTRO')),
  CONSTRAINT chk_leads_estado CHECK (estado IN ('ACTIVO','DESCARTADO')),
  CONSTRAINT chk_leads_clasificacion CHECK (clasificacion IN ('FRIO','TIBIO','CALIENTE','CONVERTIDO','RECURRENTE'))
);

CREATE INDEX ix_leads_comercial_id ON leads(comercial_id);
CREATE INDEX ix_leads_solicitud_id ON leads(solicitud_id);
CREATE INDEX ix_leads_cliente_id ON leads(cliente_id);
