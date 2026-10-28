import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/db.js', () => ({ pool: { query: vi.fn() } }));

import { pool } from '../config/db.js';
import { reabrirSaldo, rechazarSaldo, validarSaldo } from './cotizaciones.repository.js';

// Regla F1: la condición del anticipo vive en el propio UPDATE (defensa atómica) para que ni una
// llamada directa ni dos solicitudes concurrentes puedan saltársela. Se revisa el SQL emitido: un
// literal sin comillas lo interpretaría PostgreSQL como una columna.
function ejecutor(filas: unknown[] = [{ id: 'x' }]) {
  return { query: vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: filas })) };
}

const CONDICION_ANTICIPO = "estado_anticipo IN ('VALIDADO', 'NO_APLICA')";

describe('validarSaldo: UPDATE condicional', () => {
  it('exige cotización ACEPTADA, saldo PENDIENTE y anticipo VALIDADO o NO_APLICA', async () => {
    const ex = ejecutor();
    await validarSaldo('cot-1', 'usuario-1', 'EFECTIVO', ex as never);

    const [sql, params] = ex.query.mock.calls[0];
    expect(sql).toContain("estado = 'ACEPTADA'");
    expect(sql).toContain("estado_saldo = 'PENDIENTE'");
    expect(sql).toContain(CONDICION_ANTICIPO);
    expect(params).toEqual(['cot-1', 'usuario-1', 'EFECTIVO']);
  });

  it('no deja literales sin comillas (se confundirían con columnas)', async () => {
    const ex = ejecutor();
    await validarSaldo('cot-1', 'usuario-1', 'EFECTIVO', ex as never);
    expect(ex.query.mock.calls[0][0]).not.toMatch(/(=|IN \()\s*(ACEPTADA|PENDIENTE|VALIDADO|NO_APLICA)\b/);
  });

  it('devuelve null cuando el UPDATE condicional no afecta ninguna fila (p. ej. anticipo PENDIENTE)', async () => {
    const ex = ejecutor([]);
    await expect(validarSaldo('cot-1', 'usuario-1', 'EFECTIVO', ex as never)).resolves.toBeNull();
  });
});

describe('rechazarSaldo: UPDATE condicional', () => {
  it('exige cotización ACEPTADA, saldo PENDIENTE y anticipo VALIDADO o NO_APLICA', async () => {
    const ex = ejecutor();
    await rechazarSaldo('cot-1', 'usuario-1', ex as never);

    const [sql, params] = ex.query.mock.calls[0];
    expect(sql).toContain("estado = 'ACEPTADA'");
    expect(sql).toContain("estado_saldo = 'PENDIENTE'");
    expect(sql).toContain(CONDICION_ANTICIPO);
    expect(params).toEqual(['cot-1', 'usuario-1']);
  });

  it('devuelve null cuando el UPDATE condicional no afecta ninguna fila', async () => {
    const ex = ejecutor([]);
    await expect(rechazarSaldo('cot-1', 'usuario-1', ex as never)).resolves.toBeNull();
  });
});

describe('reabrirSaldo: UPDATE condicional', () => {
  it('solo reabre un saldo RECHAZADO con el anticipo VALIDADO o NO_APLICA', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 'x' }] } as never);
    await reabrirSaldo('cot-1');

    const [sql, params] = vi.mocked(pool.query).mock.calls.at(-1) as unknown as [string, unknown[]];
    expect(sql).toContain("estado = 'ACEPTADA'");
    expect(sql).toContain("estado_saldo = 'RECHAZADO'");
    expect(sql).toContain(CONDICION_ANTICIPO);
    expect(params).toEqual(['cot-1']);
  });
});
