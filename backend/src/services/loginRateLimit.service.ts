// Límite de intentos fallidos de login (OWASP A07). En memoria del propio proceso, mismo
// criterio que nexiaRateLimit.service.ts y los contadores de cotizaciones: se reinicia con
// el proceso y no se comparte entre instancias (limitación conocida; persistirlo exigiría
// una tabla nueva, que requiere autorización).
//
// Dos contadores: por IP+correo (frena la fuerza bruta sobre una cuenta sin que un tercero
// desde otra IP pueda bloquear al usuario legítimo) y por IP (frena el barrido de muchos
// correos desde un mismo origen). Un login correcto limpia solo el contador IP+correo.

export const LOGIN_MAX_FALLOS_CUENTA = 5;
export const LOGIN_MAX_FALLOS_IP = 30;
export const LOGIN_VENTANA_MS = 15 * 60_000;

export class LimiteLoginError extends Error {
  constructor(public readonly reintentarEnSegundos: number) {
    super('Demasiados intentos de inicio de sesión.');
  }
}

const fallosPorCuenta = new Map<string, number[]>();
const fallosPorIp = new Map<string, number[]>();

function vigentes(mapa: Map<string, number[]>, clave: string, ahora: number): number[] {
  const desde = ahora - LOGIN_VENTANA_MS;
  const marcas = (mapa.get(clave) ?? []).filter((t) => t > desde);
  if (marcas.length > 0) mapa.set(clave, marcas);
  else mapa.delete(clave);
  return marcas;
}

function claveCuenta(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

function limpiarSiCrece(mapa: Map<string, number[]>, ahora: number): void {
  if (mapa.size <= 5000) return;
  for (const clave of mapa.keys()) vigentes(mapa, clave, ahora);
}

// Lanza LimiteLoginError si la combinación ya agotó sus intentos. Se llama ANTES de comprobar la contraseña.
export function verificarLoginPermitido(ip: string, email: string, ahora: number = Date.now()): void {
  for (const [mapa, clave, max] of [
    [fallosPorCuenta, claveCuenta(ip, email), LOGIN_MAX_FALLOS_CUENTA],
    [fallosPorIp, ip, LOGIN_MAX_FALLOS_IP],
  ] as const) {
    const marcas = vigentes(mapa, clave, ahora);
    if (marcas.length >= max) {
      const espera = Math.ceil((marcas[0] + LOGIN_VENTANA_MS - ahora) / 1000);
      throw new LimiteLoginError(Math.max(espera, 1));
    }
  }
}

export function registrarLoginFallido(ip: string, email: string, ahora: number = Date.now()): void {
  for (const [mapa, clave] of [
    [fallosPorCuenta, claveCuenta(ip, email)],
    [fallosPorIp, ip],
  ] as const) {
    const marcas = vigentes(mapa, clave, ahora);
    marcas.push(ahora);
    mapa.set(clave, marcas);
    limpiarSiCrece(mapa, ahora);
  }
}

export function registrarLoginExitoso(ip: string, email: string): void {
  fallosPorCuenta.delete(claveCuenta(ip, email));
}

// Solo para pruebas.
export function reiniciarLimitesLogin(): void {
  fallosPorCuenta.clear();
  fallosPorIp.clear();
}
