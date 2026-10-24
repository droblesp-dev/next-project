// Lógica pura del formulario de cuentas bancarias (sin React) para poder
// probarla sin DOM.

// Límites alineados con las columnas de `cuentas_bancarias` (V14):
// banco VARCHAR(100); titular (60) y numero_cuenta (20) son más estrictos que el esquema (decisión de producto). El
// nombre de una entidad personalizada se copia a `cuentas_bancarias.banco`,
// por eso su límite es 100. El backend valida los mismos valores
// (backend/src/services/cuentasBancarias.service.ts::LIMITES_CUENTA_BANCARIA);
// aquí solo se aplican para dar feedback inmediato.
export const LIMITES_CUENTA_BANCARIA = {
  titular: 60,
  numeroCuenta: 20,
  bancoNombre: 100,
} as const;

export interface FormularioCuentaState {
  bancoSeleccionado: string; // id del catálogo, o '__OTRO__'
  bancoPersonalizadoNombre: string;
  tipoEntidad: string;
  titular: string;
  tipoCuenta: string;
  numeroCuenta: string;
  activo: boolean;
  titularVisibleCliente: boolean;
}

export interface CambiosDeLogo {
  logoArchivo: boolean; // hay un archivo nuevo elegido
  logoQuitado: boolean; // se pidió quitar el logo
}

// El logo solo se puede elegir cuando ya hay una entidad seleccionada: al elegir otra
// entidad el formulario descarta el archivo escogido, y sin entidad no se puede guardar.
export function puedeElegirLogo(bancoSeleccionado: string): boolean {
  return bancoSeleccionado.trim() !== '';
}

// Hay cambios sin guardar si algún campo difiere del estado con el que se
// abrió el modal, o si se eligió/quitó un logo. Los espacios sobrantes no
// cuentan como cambio en los campos de texto.
export function hayCambiosSinGuardar(
  actual: FormularioCuentaState,
  inicial: FormularioCuentaState,
  logo: CambiosDeLogo
): boolean {
  if (logo.logoArchivo || logo.logoQuitado) return true;
  const textos: Array<keyof FormularioCuentaState> = [
    'bancoSeleccionado',
    'bancoPersonalizadoNombre',
    'tipoEntidad',
    'titular',
    'tipoCuenta',
    'numeroCuenta',
  ];
  for (const campo of textos) {
    if (String(actual[campo]).trim() !== String(inicial[campo]).trim()) return true;
  }
  return actual.activo !== inicial.activo || actual.titularVisibleCliente !== inicial.titularVisibleCliente;
}

export interface EntradaLogoVisible {
  editando: boolean;
  hayArchivoNuevo: boolean;
  archivoNuevoPreviewUrl: string | null;
  logoPropioUrl: string | null; // logo propio ya guardado de la cuenta editada
  logoQuitado: boolean;
  entidadActual: string;
  entidadInicial: string;
  urlHeredada: string | null; // logo de la entidad elegida en el catálogo
}

// Qué logo muestra el formulario y si «Quitar» está disponible (Fase B, V17).
// Prioridad: archivo recién elegido > logo propio vigente > logo heredado de
// la entidad. El logo propio deja de ser vigente si se quitó o si la cuenta
// cambió de entidad (el backend desasocia el propio anterior). «Quitar» solo
// existe sobre un logo propio (o un archivo recién elegido), nunca sobre el
// heredado, que es compartido.
export function resolverLogoVisible(e: EntradaLogoVisible): { previewUrl: string | null; puedeQuitar: boolean } {
  const propioVigente =
    e.editando && e.logoPropioUrl !== null && !e.logoQuitado && e.entidadActual === e.entidadInicial;
  return {
    previewUrl: e.archivoNuevoPreviewUrl ?? (propioVigente ? e.logoPropioUrl : e.urlHeredada),
    puedeQuitar: e.hayArchivoNuevo || propioVigente,
  };
}
