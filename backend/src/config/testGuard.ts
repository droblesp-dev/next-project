// SALVAGUARDAS-BD-PRUEBAS — Corrección 01A (autorización explícita).
// Protege contra ejecutar pruebas o scripts de siembra de datos ficticios
// contra la base productiva `nextproject`. Nunca se importa desde
// `server.ts` ni desde ningún archivo de arranque de la aplicación.
//
// Importación perezosa de `./db.js` (dentro de `obtenerIdentidadRealConectada`,
// nunca en el nivel superior de este archivo): así, importar `testGuard.ts`
// para probarlo con un verificador simulado nunca dispara `dotenv/config` ni
// exige que `JWT_SECRET`/`COTIZACION_LINK_SECRET`/`LEAD_LINK_SECRET` estén
// definidos — las pruebas negativas quedan completamente aisladas.
//
// RIESGO REVISADO (Corrección 01A, punto 5 — documentado, no corregido con
// un cambio de `db.ts`, fuera del alcance autorizado): `db.ts` construye su
// `Pool` una sola vez, con la configuración vigente en el momento en que ese
// módulo se importa por primera vez en el proceso — los imports de ESM se
// cachean. En el uso previsto (esta guardia se ejecuta vía `setupFiles`,
// ANTES de que Vitest cargue cualquier archivo de prueba), esto no es un
// problema: nada más ha importado `db.ts` todavía cuando la guardia corre, y
// las variables de entorno del proceso ya están fijas desde antes de invocar
// `vitest` (nunca se mutan a mitad de la ejecución). El riesgo SÍ seguiría
// vigente si un futuro archivo de prueba mutara `process.env.DB_NAME`/`DB_HOST`
// en tiempo de ejecución después de que algún código ya hubiera importado
// `db.ts` con una configuración distinta — ese patrón debe evitarse
// explícitamente en cualquier prueba de integración futura.

export class ConfiguracionBaseDePruebasInvalidaError extends Error {}

export interface IdentidadBaseReal {
  base: string;
  host: string;
  puerto: number;
}

export type VerificadorIdentidadReal = () => Promise<IdentidadBaseReal>;

// ---------------------------------------------------------------------
// PENDIENTE DE VERIFICACIÓN REAL (Corrección 01A, punto 6 — documentado
// expresamente): esta función es la ÚNICA que de verdad se conecta a
// PostgreSQL. No tiene ninguna prueba automatizada que la ejecute contra una
// base real — hacerlo violaría la restricción de esta tarea de no
// conectarse a PostgreSQL. Su corrección solo podrá confirmarse en una fase
// futura, autorizada aparte, una vez exista `nextproject_test`. Hasta
// entonces, NO declarar que "la conexión real fue validada" — solo que la
// lógica que la rodea (comparaciones, orden de las comprobaciones) lo fue,
// mediante un verificador simulado.
// ---------------------------------------------------------------------
export async function obtenerIdentidadRealConectada(): Promise<IdentidadBaseReal> {
  const { pool } = await import('./db.js');
  const resultado = await pool.query<{ base: string; host: string | null; puerto: number }>(
    `SELECT current_database() AS base,
            inet_server_addr()::text AS host,
            inet_server_port() AS puerto`
  );
  const fila = resultado.rows[0];
  // inet_server_addr() devuelve NULL si la conexión usa un socket Unix en
  // vez de TCP — no es el caso observado en esta máquina (confirmado antes:
  // '::1'), pero se maneja sin asumir TCP como garantía universal.
  return { base: fila.base, host: fila.host ?? 'socket-local-sin-ip', puerto: fila.puerto };
}

export interface IdentidadEsperada {
  base: string;
  // CORRECCIÓN 01B (H2): lista cerrada de direcciones reales aceptadas —
  // nunca un comodín. `inet_server_addr()` puede reportar '::1' (IPv6) o
  // '127.0.0.1' (IPv4) para la MISMA máquina local según cómo resuelva la
  // conexión, así que un único valor fijo rechazaba configuraciones locales
  // igualmente válidas. Ambas siguen siendo exclusivamente locales — no se
  // amplía a ningún host remoto.
  hostsRealesPermitidos: string[];
  puerto: number;
}

export interface AssertIdentidadOpciones {
  verificarIdentidadReal?: VerificadorIdentidadReal;
}

// Requisito de seguridad explícito: DB_NAME nunca es suficiente por sí
// solo. Lista blanca de hosts DECLARADOS aceptables (nunca se compara
// directamente contra el formato de inet_server_addr(), que no coincide ni
// en una configuración correcta — "localhost" vs "::1").
const HOSTS_DECLARADOS_PERMITIDOS = ['localhost', '127.0.0.1', '::1'];

// Orden deliberado, de más barato a más caro: las primeras 3 comprobaciones
// (nombre, host en lista blanca, puerto) nunca
// tocan la red. Solo si las 3 pasan se ejecuta la comprobación real
// (quinta), que sí requiere una conexión — y compara la identidad COMPLETA
// (base + host + puerto), no solo el nombre.
export async function assertIdentidadBaseDePruebas(
  esperado: IdentidadEsperada,
  opciones: AssertIdentidadOpciones = {}
): Promise<void> {
  const baseDeclarada = process.env.DB_NAME;
  const hostDeclarado = process.env.DB_HOST;
  const puertoDeclarado = Number(process.env.DB_PORT) || 5432;

  if (!baseDeclarada) {
    throw new ConfiguracionBaseDePruebasInvalidaError(
      'testGuard: DB_NAME no está definido. Abortando antes de cualquier conexión a PostgreSQL.'
    );
  }

  if (baseDeclarada !== esperado.base) {
    throw new ConfiguracionBaseDePruebasInvalidaError(
      `testGuard: DB_NAME="${baseDeclarada}" no coincide EXACTAMENTE con la base de pruebas esperada ("${esperado.base}"). Abortando antes de cualquier conexión.`
    );
  }

  if (!hostDeclarado || !HOSTS_DECLARADOS_PERMITIDOS.includes(hostDeclarado)) {
    throw new ConfiguracionBaseDePruebasInvalidaError(
      `testGuard: DB_HOST="${hostDeclarado ?? ''}" no está en la lista de hosts locales permitidos (${HOSTS_DECLARADOS_PERMITIDOS.join(', ')}). DB_NAME correcto no es suficiente por sí solo. Abortando antes de cualquier conexión.`
    );
  }

  if (puertoDeclarado !== esperado.puerto) {
    throw new ConfiguracionBaseDePruebasInvalidaError(
      `testGuard: DB_PORT declarado (${puertoDeclarado}) no coincide con el puerto esperado (${esperado.puerto}). Abortando antes de cualquier conexión.`
    );
  }

  const verificar = opciones.verificarIdentidadReal ?? obtenerIdentidadRealConectada;
  const real = await verificar();
  const hostRealNormalizado = normalizarHostReal(real.host);

  if (
    real.base !== esperado.base ||
    !esperado.hostsRealesPermitidos.includes(hostRealNormalizado) ||
    real.puerto !== esperado.puerto
  ) {
    throw new ConfiguracionBaseDePruebasInvalidaError(
      `testGuard: la identidad real reportada por PostgreSQL (${real.base}@${real.host}:${real.puerto}) no coincide con la esperada (${esperado.base}@[${esperado.hostsRealesPermitidos.join('|')}]:${esperado.puerto}). Lo declarado y lo real no concuerdan — abortando.`
    );
  }
}

// CORRECCIÓN P0.3B-2 (hallazgo real de P0.3B-1 — autorización explícita,
// alternativa B): `inet_server_addr()::text` puede devolver la dirección
// con sufijo CIDR según la instalación/versión de PostgreSQL (confirmado en
// esta máquina: '::1/128' en vez de '::1'). En vez de enumerar cada
// variante con sufijo dentro de `hostsRealesPermitidos` (alternativa A,
// descartada), se normaliza aquí retirando ÚNICAMENTE un sufijo
// "/<prefijo>" si existe, antes de comparar contra la lista blanca. Esto
// NUNCA relaja la lista blanca: una dirección real que no esté en
// `hostsRealesPermitidos` sigue rechazándose igual, con o sin sufijo — solo
// cambia qué se compara, no contra qué se compara.
function normalizarHostReal(host: string): string {
  const posicionBarra = host.indexOf('/');
  return posicionBarra === -1 ? host : host.slice(0, posicionBarra);
}

// Valor por defecto para los comandos de integración. '::1' se basa en una
// observación REAL hecha en una fase anterior de esta sesión (consulta de
// solo lectura confirmó inet_server_addr()='::1' en esta máquina) — NO fue
// reconfirmado en esta tarea. Se agrega también '127.0.0.1' (Corrección
// 01B, H2) porque es la otra forma habitual en que la MISMA conexión local
// puede resolverse, y ya estaba aceptada como DB_HOST declarado
// (HOSTS_DECLARADOS_PERMITIDOS) sin tener su contraparte real correspondiente.
// Si el futuro servidor de pruebas real reportara un valor distinto, esta
// lista debería actualizarse entonces, nunca asumirse de antemano.
export const IDENTIDAD_ESPERADA_POR_DEFECTO: IdentidadEsperada = {
  base: 'nextproject_test',
  hostsRealesPermitidos: ['::1', '127.0.0.1'],
  puerto: 5432,
};

// Mecanismo adicional (defensa en profundidad, opcional) para el comando
// UNITARIO normal: no hace nada a menos que REQUIERE_BD_PRUEBAS=1 esté
// fijada explícitamente. El comando de integración (ver
// `testGuard.integration.setup.ts`) NO usa esta función — en ese comando la
// guardia es obligatoria e incondicional, sin ninguna variable que permita
// omitirla, tal como exige esta corrección.
export async function aplicarGuardiaSiCorresponde(
  esperado: IdentidadEsperada = IDENTIDAD_ESPERADA_POR_DEFECTO
): Promise<void> {
  if (process.env.REQUIERE_BD_PRUEBAS !== '1') {
    return;
  }
  await assertIdentidadBaseDePruebas(esperado);
}
