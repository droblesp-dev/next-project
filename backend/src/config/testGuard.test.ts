// SALVAGUARDAS-BD-PRUEBAS — Corrección 01A: pruebas negativas de
// `assertIdentidadBaseDePruebas`. Ninguna se conecta a PostgreSQL ni
// realiza ninguna escritura: el caso que simula "la conexión real reporta
// otra identidad" usa un `verificarIdentidadReal` inyectado (una función de
// prueba), nunca `obtenerIdentidadRealConectada()` (la única que de verdad
// abre una conexión). Esto es, explícitamente, una prueba unitaria aislada.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertIdentidadBaseDePruebas, ConfiguracionBaseDePruebasInvalidaError } from './testGuard.js';

const ENV_ORIGINAL = { ...process.env };
const ESPERADO = { base: 'nextproject_test', hostsRealesPermitidos: ['::1', '127.0.0.1'], puerto: 5432 };

beforeEach(() => {
  delete process.env.DB_NAME;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe('testGuard.assertIdentidadBaseDePruebas — pruebas negativas (sin conexión real)', () => {
  it('N1: aborta si DB_NAME no está definido', async () => {
    await expect(assertIdentidadBaseDePruebas(ESPERADO)).rejects.toThrow(
      ConfiguracionBaseDePruebasInvalidaError
    );
  });

  it('N2: aborta si DB_NAME es la base productiva real ("nextproject")', async () => {
    process.env.DB_NAME = 'nextproject';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    await expect(assertIdentidadBaseDePruebas(ESPERADO)).rejects.toThrow(/no coincide EXACTAMENTE/);
  });

  it('N3: aborta si DB_NAME es similar pero no idéntico a la base esperada', async () => {
    process.env.DB_NAME = 'nextproject_test2';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    await expect(assertIdentidadBaseDePruebas(ESPERADO)).rejects.toThrow(/no coincide EXACTAMENTE/);
  });

  it('N4: aborta si DB_HOST no está en la lista blanca, aunque DB_NAME sea correcto (DB_NAME no basta por sí solo)', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'db-remoto-desconocido.ejemplo.com';
    process.env.DB_PORT = '5432';
    await expect(assertIdentidadBaseDePruebas(ESPERADO)).rejects.toThrow(/no está en la lista de hosts locales permitidos/);
  });

  it('N5: aborta si DB_PORT declarado no coincide con el puerto esperado', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '6543';
    await expect(assertIdentidadBaseDePruebas(ESPERADO)).rejects.toThrow(/DB_PORT declarado/);
  });

  it('N7: aborta si la identidad real (simulada) reporta un host distinto al declarado/esperado', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '192.0.2.1', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).rejects.toThrow(/no concuerdan/);
  });

  it('N8: aborta si la identidad real (simulada) reporta un puerto distinto', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '::1', puerto: 9999 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).rejects.toThrow(/no concuerdan/);
  });

  it('Caso positivo (IPv6): resuelve sin error cuando la identidad real reporta "::1" (verificador simulado, sin red real)', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '::1', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).resolves.toBeUndefined();
  });

  it('Caso positivo (IPv4) — Corrección 01B/H2: resuelve sin error cuando la identidad real reporta "127.0.0.1" (verificador simulado, sin red real)', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '127.0.0.1', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).resolves.toBeUndefined();
  });
});

// CORRECCIÓN P0.3B-2 (hallazgo real de P0.3B-1, autorización explícita):
// `inet_server_addr()::text` puede devolver la dirección con sufijo CIDR
// (confirmado en esta máquina: '::1/128' en vez de '::1' — ver informe de
// P0.3B-1). Estas pruebas cubren la normalización (alternativa B) sin tocar
// la lista blanca: con sufijo debe seguir aceptando exactamente las mismas
// direcciones que antes, y seguir rechazando cualquier otra.
describe('testGuard.assertIdentidadBaseDePruebas — Corrección P0.3B-2 (normalización de sufijo CIDR)', () => {
  it('P0.3B-2.1: acepta IPv6 con sufijo CIDR real ("::1/128") cuando "::1" está en la lista blanca', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '::1/128', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).resolves.toBeUndefined();
  });

  it('P0.3B-2.2: acepta IPv4 con sufijo CIDR ("127.0.0.1/32") cuando "127.0.0.1" está en la lista blanca', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '127.0.0.1/32', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).resolves.toBeUndefined();
  });

  it('P0.3B-2.3: sigue rechazando una dirección real NO permitida aunque traiga sufijo CIDR ("192.0.2.1/32")', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '192.0.2.1/32', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).rejects.toThrow(/no concuerdan/);
  });

  it('P0.3B-2.4: sigue rechazando una dirección real NO permitida sin sufijo (regresión — la lista blanca no se amplió)', async () => {
    process.env.DB_NAME = 'nextproject_test';
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const verificadorSimulado = async () => ({ base: 'nextproject_test', host: '10.0.0.5', puerto: 5432 });
    await expect(
      assertIdentidadBaseDePruebas(ESPERADO, { verificarIdentidadReal: verificadorSimulado })
    ).rejects.toThrow(/no concuerdan/);
  });
});
