// Clave React de cada cuenta receptora en la lista pública de cotizaciones.
//
// La respuesta pública no trae ningún identificador de cuenta (a propósito) y
// el sistema NO garantiza que banco + número de cuenta sean únicos: dos cuentas
// activas pueden coincidir en ambos. Usar solo `banco-número` generaba claves
// repetidas entre hermanos y React lo avisa («Encountered two children with the
// same key»). El índice de posición las hace únicas por construcción dentro de
// una misma lista. Es coherente con la selección, que también se hace por
// posición (`indiceElegido`), y los elementos no guardan estado propio, así que
// reutilizar nodos por posición no tiene efectos secundarios.
export function claveCuentaReceptora(cuenta: { banco: string; numero_cuenta: string }, indice: number): string {
  return `${cuenta.banco}-${cuenta.numero_cuenta}-${indice}`;
}

// ---------------------------------------------------------------------------
// Cuenta receptora al gestionar un pago (PC-2026-01)

// Fila que devuelve GET /api/cotizaciones/cuentas-receptoras (solo cuentas
// activas; id, banco, tipo y número — nunca el titular).
export interface CuentaReceptora {
  id: string;
  banco: string;
  tipo_cuenta: string;
  numero_cuenta: string;
}

export function etiquetaCuentaReceptora(c: CuentaReceptora): string {
  return `${c.banco} · ${c.tipo_cuenta} · ${c.numero_cuenta}`;
}

export const TEXTO_CUENTA_NO_REGISTRADA = 'No registrada';

export type EstadoSelectorCuentas = 'cargando' | 'error' | 'sin_cuentas' | 'listo';

// Qué debe mostrar el selector: carga en curso, error (el resto del formulario
// sigue siendo utilizable), ninguna cuenta activa, o la lista de opciones.
export function estadoSelectorCuentas(
  cuentas: CuentaReceptora[] | null,
  cargando: boolean,
  error: string | null
): EstadoSelectorCuentas {
  if (cargando) return 'cargando';
  if (error) return 'error';
  if (!cuentas || cuentas.length === 0) return 'sin_cuentas';
  return 'listo';
}

// Campos de la copia (snapshot) de la cuenta receptora que guarda cada intento de
// pago en el momento de registrarlo.
export interface SnapshotCuentaReceptora {
  banco_cuenta_snapshot: string | null;
  titular_cuenta_snapshot: string | null;
  tipo_cuenta_snapshot: string | null;
  numero_cuenta_snapshot: string | null;
}

export interface ResumenCuentaReceptora {
  banco: string;
  tipo: string;
  numero: string;
  titular: string;
}

// null cuando el registro no tiene cuenta receptora (pagos anteriores a esta
// función o gestionados sin elegirla): la interfaz muestra «No registrada». Un
// dato suelto que falte se muestra como «—»; nunca se inventa ni se completa.
export function resumenCuentaReceptora(t: SnapshotCuentaReceptora): ResumenCuentaReceptora | null {
  const hayAlgo =
    t.banco_cuenta_snapshot !== null ||
    t.titular_cuenta_snapshot !== null ||
    t.tipo_cuenta_snapshot !== null ||
    t.numero_cuenta_snapshot !== null;
  if (!hayAlgo) return null;
  return {
    banco: t.banco_cuenta_snapshot ?? '—',
    tipo: t.tipo_cuenta_snapshot ?? '—',
    numero: t.numero_cuenta_snapshot ?? '—',
    titular: t.titular_cuenta_snapshot ?? '—',
  };
}
