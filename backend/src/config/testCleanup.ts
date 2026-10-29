import type { Pool } from 'pg';

// Infraestructura de pruebas de integración: limpieza de los registros que una
// prueba crea, SOLO por los IDs que ella misma registró (nunca por patrón de
// nombre ni "todo lo que parezca de prueba"), en el orden que respetan las
// claves foráneas actuales:
//   transferencias_pago.cuenta_bancaria_id -> cuentas_bancarias  (RESTRICT)
//   cuentas_bancarias.banco_catalogo_id    -> bancos_catalogo    (RESTRICT)
// Es decir: primero las transferencias registradas (ninguna FK las referencia),
// después las cuentas y por último las entidades. Una cuenta con pagos NO
// registrados sigue bloqueando la limpieza.
//
// Si algo registrado tiene dependencias no previstas, NO se borra nada y se
// lanza `LimpiezaBloqueadaError` describiendo el caso (la transacción se
// revierte): nunca se eliminan registros relacionados para "hacer caber" la
// limpieza.

const BASE_DE_PRUEBAS = 'nextproject_test';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LimpiezaBloqueadaError extends Error {}

export interface ResultadoLimpieza {
  cuentasEliminadas: number;
  entidadesEliminadas: number;
  // Solo presente cuando la prueba registró transferencias de pago.
  transferenciasEliminadas?: number;
}

export class RegistroLimpieza {
  private readonly cuentas = new Set<string>();
  private readonly entidades = new Set<string>();
  private readonly transferencias = new Set<string>();

  registrarCuenta(id: string | null | undefined): void {
    if (id) this.cuentas.add(this.validar(id));
  }

  registrarEntidad(id: string | null | undefined): void {
    if (id) this.entidades.add(this.validar(id));
  }

  registrarTransferencia(id: string | null | undefined): void {
    if (id) this.transferencias.add(this.validar(id));
  }

  get transferenciasRegistradas(): string[] {
    return [...this.transferencias];
  }

  get cuentasRegistradas(): string[] {
    return [...this.cuentas];
  }

  get entidadesRegistradas(): string[] {
    return [...this.entidades];
  }

  private validar(id: string): string {
    if (!UUID.test(id)) {
      throw new LimpiezaBloqueadaError(`Identificador no válido para limpieza: "${id}".`);
    }
    return id;
  }

  async limpiar(pool: Pool): Promise<ResultadoLimpieza> {
    const cuentas = this.cuentasRegistradas;
    const entidades = this.entidadesRegistradas;
    const transferencias = this.transferenciasRegistradas;
    if (cuentas.length === 0 && entidades.length === 0 && transferencias.length === 0) {
      return { cuentasEliminadas: 0, entidadesEliminadas: 0 };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Identidad real de la base antes de cualquier escritura.
      const identidad = await client.query<{ base: string }>('SELECT current_database() AS base');
      if (identidad.rows[0]?.base !== BASE_DE_PRUEBAS) {
        throw new LimpiezaBloqueadaError(
          `Limpieza abortada: la base conectada es "${identidad.rows[0]?.base}", no "${BASE_DE_PRUEBAS}".`
        );
      }

      if (cuentas.length > 0) {
        const pagos = await client.query<{ id: string; n: string }>(
          `SELECT cuenta_bancaria_id AS id, count(*) AS n
           FROM transferencias_pago
           WHERE cuenta_bancaria_id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[])) GROUP BY 1`,
          [cuentas, transferencias]
        );
        if (pagos.rows.length > 0) {
          throw new LimpiezaBloqueadaError(
            `Cuentas registradas con pagos asociados (no se elimina nada): ${pagos.rows
              .map((r) => `${r.id} (${r.n} pago/s)`)
              .join(', ')}`
          );
        }
      }

      if (entidades.length > 0) {
        const ajenas = await client.query<{ id: string; banco_catalogo_id: string }>(
          `SELECT id, banco_catalogo_id FROM cuentas_bancarias
           WHERE banco_catalogo_id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))`,
          [entidades, cuentas]
        );
        if (ajenas.rows.length > 0) {
          throw new LimpiezaBloqueadaError(
            `Entidades registradas referenciadas por cuentas NO registradas (no se elimina nada): ${ajenas.rows
              .map((r) => `cuenta ${r.id} -> entidad ${r.banco_catalogo_id}`)
              .join(', ')}`
          );
        }
      }

      // Primero las transferencias que registró la prueba (por ID): ninguna FK las
      // referencia, así que su borrado no arrastra nada más.
      // V21: transferencias_pago es inmutable salvo en nextproject_test con esta marca, local a la transacción.
      if (transferencias.length > 0) await client.query("SELECT set_config('app.permitir_limpieza_pruebas', 'on', true)");
      const transferenciasBorradas = transferencias.length
        ? await client.query('DELETE FROM transferencias_pago WHERE id = ANY($1::uuid[])', [transferencias])
        : { rowCount: 0 };
      const cuentasBorradas = cuentas.length
        ? await client.query('DELETE FROM cuentas_bancarias WHERE id = ANY($1::uuid[])', [cuentas])
        : { rowCount: 0 };
      const entidadesBorradas = entidades.length
        ? await client.query('DELETE FROM bancos_catalogo WHERE id = ANY($1::uuid[])', [entidades])
        : { rowCount: 0 };

      await client.query('COMMIT');
      this.cuentas.clear();
      this.entidades.clear();
      this.transferencias.clear();
      return {
        cuentasEliminadas: cuentasBorradas.rowCount ?? 0,
        entidadesEliminadas: entidadesBorradas.rowCount ?? 0,
        ...(transferencias.length > 0 ? { transferenciasEliminadas: transferenciasBorradas.rowCount ?? 0 } : {}),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
