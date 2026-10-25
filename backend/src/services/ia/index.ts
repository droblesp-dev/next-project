import { geminiProvider } from './gemini.provider.js';
import { openRouterProvider } from './openrouter.provider.js';
import type { NombreProveedorIa, ProveedorIa } from './proveedorIa.types.js';

export type { EsquemaJson, ProveedorIa, RespuestaIa, SolicitudIa } from './proveedorIa.types.js';

// ÚNICO punto de configuración del proveedor de IA: cambiar esta constante
// cambia el proveedor usado por todos los servicios (análisis, NexIA, ficha
// técnica y asistente del formulario).
export const PROVEEDOR_IA_ACTIVO: NombreProveedorIa = 'openrouter';

const PROVEEDORES: Record<NombreProveedorIa, ProveedorIa> = {
  gemini: geminiProvider,
  openrouter: openRouterProvider,
};

export function obtenerProveedorIa(nombre: NombreProveedorIa = PROVEEDOR_IA_ACTIVO): ProveedorIa {
  const proveedor = PROVEEDORES[nombre];
  if (!proveedor) {
    throw new Error(`Proveedor de IA desconocido: ${nombre}`);
  }
  return proveedor;
}

// Lanza (con la clase de error indicada) si el proveedor no tiene API key.
export function asegurarProveedorConfigurado(
  proveedor: ProveedorIa,
  ErrorClase: new (mensaje: string) => Error = Error
): void {
  if (!proveedor.estaConfigurado()) {
    throw new ErrorClase(`${proveedor.variableApiKey} no está configurada.`);
  }
}

// Redacta las API keys de todos los proveedores de un mensaje de error.
export function redactarSecretosIa(mensaje: string): string {
  return Object.values(PROVEEDORES).reduce((limpio, p) => {
    const clave = p.apiKey();
    return clave ? limpio.split(clave).join('[REDACTED]') : limpio;
  }, mensaje);
}
