// CORRECCIÓN 01B (H1) — Demuestra que, dentro del comando unitario, una
// importación real de `db.ts` (como la haría un test mal nombrado o un
// repositorio importado por error) queda bloqueada antes de ejecutar
// cualquier consulta real contra PostgreSQL. Esta prueba SÍ importa el
// `pool` real de `db.ts` — deliberadamente, es justo lo que se quiere
// demostrar — pero gracias a `pgUnitGuard.setup.ts` (vi.mock('pg', ...)),
// ese `pool` es la implementación bloqueada, nunca una conexión real.
import { describe, expect, it, vi } from 'vitest';

describe('Corrección 01B (H1) — bloqueo real de PostgreSQL en el entorno unitario', () => {
  it('pool.query() real queda bloqueado antes de ejecutar cualquier consulta', async () => {
    const { pool } = await import('../config/db.js');
    expect(() => pool.query('SELECT 1')).toThrow(/BLOQUEADO/);
  });

  it('pool.connect() real queda bloqueado antes de abrir cualquier conexión', async () => {
    const { pool } = await import('../config/db.js');
    expect(() => pool.connect()).toThrow(/BLOQUEADO/);
  });
});

// Requisito obligatorio #3 de la Corrección 01B: confirmar que un mock de
// repositorio (el patrón que usarían las pruebas unitarias reales de
// negocio, cuando existan) sigue funcionando normalmente con el bloqueo de
// `pg` activo — nunca llega a tocar `db.ts` ni el `pool` bloqueado, porque
// el módulo entero del repositorio queda sustituido antes de ese punto.
vi.mock('../repositories/leads.repository.js', () => ({
  listAll: vi.fn().mockResolvedValue([{ id: 'lead-simulado', nombre: 'Prueba mock' }]),
}));

describe('Corrección 01B — los mocks de repositorios siguen funcionando con pgUnitGuard activo', () => {
  it('un repositorio mockeado devuelve el valor simulado, sin tocar pg/db.ts', async () => {
    const leadsRepo = await import('../repositories/leads.repository.js');
    const resultado = await leadsRepo.listAll();
    expect(resultado).toEqual([{ id: 'lead-simulado', nombre: 'Prueba mock' }]);
  });
});
