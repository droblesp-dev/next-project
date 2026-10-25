import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/db.js', () => ({ pool: { query: vi.fn() } }));

import { guardarComprobante, guardarComprobanteSaldo } from './cotizaciones.repository.js';

// Las condiciones de estas sentencias son la protección real (atómica) de las reglas de comprobantes.
// Se revisa el SQL emitido: un literal sin comillas lo interpretaría PostgreSQL como una columna.
function ejecutor() {
  return { query: vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [{ id: 'x' }] })) };
}

describe('guardarComprobante (anticipo): UPDATE condicional', () => {
  it('solo aplica con cotización ACEPTADA, método TRANSFERENCIA y anticipo PENDIENTE sin comprobante o RECHAZADO', async () => {
    const ex = ejecutor();
    await guardarComprobante('cot-1', 'a.png', ex as never);

    const [sql, params] = ex.query.mock.calls[0];
    expect(sql).toContain("estado = 'ACEPTADA'");
    expect(sql).toContain("metodo_anticipo = 'TRANSFERENCIA'");
    expect(sql).toContain("estado_anticipo = 'PENDIENTE' AND comprobante_anticipo IS NULL");
    expect(sql).toContain("estado_anticipo = 'RECHAZADO'");
    // tras una nueva carga el anticipo vuelve a PENDIENTE y se limpian los datos del rechazo anterior
    expect(sql).toContain("estado_anticipo = 'PENDIENTE',");
    expect(sql).toContain('anticipo_confirmado_en = NULL');
    expect(params).toEqual(['cot-1', 'a.png']);
  });

  it('no deja literales sin comillas (se confundirían con columnas)', async () => {
    const ex = ejecutor();
    await guardarComprobante('cot-1', 'a.png', ex as never);
    expect(ex.query.mock.calls[0][0]).not.toMatch(/=\s*(ACEPTADA|PENDIENTE|RECHAZADO|TRANSFERENCIA)\b/);
  });
});

describe('guardarComprobanteSaldo (saldo): regla QA-04 dentro del UPDATE', () => {
  it('exige anticipo VALIDADO o NO_APLICA, ACEPTADA y saldo PENDIENTE sin comprobante o RECHAZADO', async () => {
    const ex = ejecutor();
    await guardarComprobanteSaldo('cot-1', 's.png', ex as never);

    const sql = ex.query.mock.calls[0][0];
    expect(sql).toContain("estado = 'ACEPTADA'");
    expect(sql).toContain("estado_anticipo IN ('VALIDADO', 'NO_APLICA')");
    expect(sql).toContain("estado_saldo = 'PENDIENTE' AND comprobante_saldo IS NULL");
    expect(sql).toContain("estado_saldo = 'RECHAZADO'");
    expect(sql).toContain("(metodo_saldo IS NULL OR metodo_saldo = 'TRANSFERENCIA')");
    expect(sql).toContain("metodo_saldo = 'TRANSFERENCIA'");
  });

  it('no deja literales sin comillas (se confundirían con columnas)', async () => {
    const ex = ejecutor();
    await guardarComprobanteSaldo('cot-1', 's.png', ex as never);
    expect(ex.query.mock.calls[0][0]).not.toMatch(/(=|IN \()\s*(ACEPTADA|PENDIENTE|RECHAZADO|VALIDADO|TRANSFERENCIA)\b/);
  });

  it('devuelve null cuando el UPDATE condicional no afecta ninguna fila', async () => {
    const ex = { query: vi.fn(async () => ({ rows: [] })) };
    await expect(guardarComprobanteSaldo('cot-1', 's.png', ex as never)).resolves.toBeNull();
  });
});
