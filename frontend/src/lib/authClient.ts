// FORMULARIO-01: única fuente de verdad para la URL del backend en todo el
// frontend — antes se repetía como literal en 3 archivos (este, App.tsx y
// AsistenteComercial.tsx). No existía ninguna variable de entorno para esto
// (verificado: .env.example no tenía nada equivalente, sin VITE_* en uso en
// ningún archivo del proyecto) — se agrega `VITE_API_BASE_URL` como la
// primera, sin inventar un sistema de configuración paralelo: mismo
// mecanismo estándar de Vite (import.meta.env), con el mismo valor de
// siempre como fallback si no está definida, para no romper el desarrollo
// local existente.
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  rol: string;
}

export interface Sesion {
  token: string;
  usuario: Usuario;
}

const STORAGE_KEY_TOKEN = 'nextproject_token';
const STORAGE_KEY_USUARIO = 'nextproject_usuario';

// Sesión expirada/inválida detectada durante una llamada autenticada.
// Se distingue de otros errores para que la UI pueda reaccionar siempre
// de la misma forma: limpiar la sesión y volver a login.
export class SesionInvalidaError extends Error {}

export function guardarSesion(sesion: Sesion): void {
  sessionStorage.setItem(STORAGE_KEY_TOKEN, sesion.token);
  sessionStorage.setItem(STORAGE_KEY_USUARIO, JSON.stringify(sesion.usuario));
}

export function leerSesionGuardada(): Sesion | null {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN);
  const usuarioRaw = sessionStorage.getItem(STORAGE_KEY_USUARIO);

  if (!token || !usuarioRaw) {
    return null;
  }

  try {
    const usuario = JSON.parse(usuarioRaw) as Usuario;
    return { token, usuario };
  } catch {
    return null;
  }
}

export function limpiarSesion(): void {
  sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  sessionStorage.removeItem(STORAGE_KEY_USUARIO);
}

export async function login(email: string, password: string): Promise<Sesion> {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (response.status === 401) {
    throw new Error('Credenciales inválidas.');
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || 'No se pudo iniciar sesión. Intente nuevamente.');
  }

  const data = (await response.json()) as { token: string; usuario: Usuario };
  return { token: data.token, usuario: data.usuario };
}

export async function obtenerMe(token: string): Promise<Usuario> {
  const response = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    throw new SesionInvalidaError('Sesión expirada o inválida.');
  }

  if (!response.ok) {
    throw new Error('No se pudo validar la sesión.');
  }

  const data = (await response.json()) as { usuario: Usuario };
  return data.usuario;
}

// Wrapper mínimo sobre fetch nativo: agrega Authorization y centraliza
// únicamente el caso 401 (sesión inválida), ya que el significado de
// 403/404/409/400 depende de cada endpoint y se maneja en cada pantalla.
export async function fetchAutenticado(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  // Si el body es FormData (subida de archivos, ej. evidencias de orden), no
  // se fuerza Content-Type: el navegador debe fijar el boundary multipart
  // por sí mismo.
  const esFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(options.body && !esFormData ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (response.status === 401) {
    throw new SesionInvalidaError('Sesión expirada o inválida.');
  }

  return response;
}

// Fase 2C — cambio de contraseña del usuario autenticado. Un 401 significa sesión inválida (lo
// lanza fetchAutenticado como SesionInvalidaError); una contraseña actual incorrecta llega como
// 400, así que NO cierra la sesión. Devuelve la sesión con el token NUEVO: el anterior deja de
// ser válido en el servidor.
export class CambioPasswordError extends Error {
  constructor(
    message: string,
    readonly detalles: string[] = []
  ) {
    super(message);
  }
}

export async function cambiarPasswordApi(
  token: string,
  datos: { passwordActual: string; passwordNueva: string; confirmacion: string }
): Promise<Sesion> {
  const response = await fetchAutenticado('/api/auth/password', token, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });

  const data = (await response.json().catch(() => null)) as
    | { token?: string; usuario?: Usuario; message?: string; detalles?: string[] }
    | null;

  if (!response.ok || !data?.token || !data.usuario) {
    throw new CambioPasswordError(
      data?.message || 'No se pudo cambiar la contraseña. Inténtalo de nuevo.',
      Array.isArray(data?.detalles) ? data.detalles : []
    );
  }

  return { token: data.token, usuario: data.usuario };
}
