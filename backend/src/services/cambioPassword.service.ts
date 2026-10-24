import bcrypt from 'bcryptjs';
import {
  actualizarPasswordYVersion,
  findParaCambioPassword,
  type UsuarioPublico,
} from '../repositories/usuarios.repository.js';
import { emitirToken } from './auth.service.js';
import { enviarAvisoCambioPassword } from './email.service.js';
import { evaluarPassword, type NivelPassword, type ProblemaPassword } from './politicaPassword.js';

// Fase 2C — cambio seguro de contraseña del usuario autenticado. Reutiliza bcryptjs (mismo costo
// que usuarios.service.ts::SALT_ROUNDS), el emisor de tokens de auth.service y la integración
// de correo existente. Nunca registra ni devuelve contraseñas o tokens en logs.

const SALT_ROUNDS = 12;

export const MAX_FALLOS_PASSWORD_ACTUAL = 5;
export const VENTANA_FALLOS_MS = 15 * 60 * 1000;

export class DatosCambioPasswordInvalidosError extends Error {}
export class UsuarioNoDisponibleError extends Error {}
export class PasswordActualIncorrectaError extends Error {}
export class ConfirmacionNoCoincideError extends Error {}
export class PasswordIgualALaActualError extends Error {}
export class FuncionNoDisponibleError extends Error {}
export class PasswordNoFuerteError extends Error {
  constructor(
    readonly nivel: NivelPassword,
    readonly problemas: ProblemaPassword[]
  ) {
    super('La nueva contraseña no es lo bastante segura.');
  }
}
export class DemasiadosIntentosError extends Error {
  constructor(readonly reintentarEnSegundos: number) {
    super('Demasiados intentos fallidos.');
  }
}

// Límite de intentos fallidos de contraseña ACTUAL por usuario, en memoria (mismo patrón que el
// OTP de cotizaciones): se reinicia con el servidor y no se comparte entre instancias.
const fallosPorUsuario = new Map<string, number[]>();

function fallosVigentes(usuarioId: string, ahora: number): number[] {
  const vigentes = (fallosPorUsuario.get(usuarioId) ?? []).filter((t) => ahora - t < VENTANA_FALLOS_MS);
  if (vigentes.length > 0) fallosPorUsuario.set(usuarioId, vigentes);
  else fallosPorUsuario.delete(usuarioId);
  return vigentes;
}

function segundosParaReintentar(usuarioId: string, ahora: number): number {
  const vigentes = fallosVigentes(usuarioId, ahora);
  if (vigentes.length < MAX_FALLOS_PASSWORD_ACTUAL) return 0;
  return Math.max(1, Math.ceil((vigentes[0] + VENTANA_FALLOS_MS - ahora) / 1000));
}

function registrarFallo(usuarioId: string, ahora: number): void {
  fallosPorUsuario.set(usuarioId, [...fallosVigentes(usuarioId, ahora), ahora]);
}

export function reiniciarLimitadorPasswordParaPruebas(): void {
  fallosPorUsuario.clear();
}

// Auditoría mínima en el log del servidor: quién, cuándo y resultado. Sin contraseñas ni tokens.
function auditar(evento: string, usuarioId: string, resultado: string, motivo?: string): void {
  console.log(
    `[AUDITORIA] ${JSON.stringify({ evento, usuarioId, resultado, ...(motivo ? { motivo } : {}), fecha: new Date().toISOString() })}`
  );
}

export interface CambioPasswordInput {
  usuarioId: string;
  passwordActual: unknown;
  passwordNueva: unknown;
  confirmacion: unknown;
}

export interface CambioPasswordResultado {
  token: string;
  usuario: UsuarioPublico;
}

export async function cambiarPassword(
  input: CambioPasswordInput,
  ahora: () => number = Date.now
): Promise<CambioPasswordResultado> {
  const { usuarioId, passwordActual, passwordNueva, confirmacion } = input;

  if (
    typeof passwordActual !== 'string' ||
    typeof passwordNueva !== 'string' ||
    typeof confirmacion !== 'string' ||
    !passwordActual ||
    !passwordNueva ||
    !confirmacion
  ) {
    throw new DatosCambioPasswordInvalidosError('passwordActual, passwordNueva y confirmacion son requeridos.');
  }

  const espera = segundosParaReintentar(usuarioId, ahora());
  if (espera > 0) {
    auditar('password_cambio', usuarioId, 'bloqueado', 'limite_intentos');
    throw new DemasiadosIntentosError(espera);
  }

  const usuario = await findParaCambioPassword(usuarioId);
  if (!usuario || !usuario.activo) throw new UsuarioNoDisponibleError();

  if (!(await bcrypt.compare(passwordActual, usuario.password_hash))) {
    registrarFallo(usuarioId, ahora());
    auditar('password_cambio', usuarioId, 'rechazado', 'password_actual_incorrecta');
    throw new PasswordActualIncorrectaError();
  }

  if (passwordNueva !== confirmacion) {
    auditar('password_cambio', usuarioId, 'rechazado', 'confirmacion_no_coincide');
    throw new ConfirmacionNoCoincideError();
  }

  if (passwordNueva === passwordActual) {
    auditar('password_cambio', usuarioId, 'rechazado', 'igual_a_la_actual');
    throw new PasswordIgualALaActualError();
  }

  const evaluacion = evaluarPassword(passwordNueva, { nombre: usuario.nombre, email: usuario.email });
  if (evaluacion.nivel !== 'FUERTE') {
    auditar('password_cambio', usuarioId, 'rechazado', `fortaleza_${evaluacion.nivel.toLowerCase()}`);
    throw new PasswordNoFuerteError(evaluacion.nivel, evaluacion.problemas);
  }

  const nuevoHash = await bcrypt.hash(passwordNueva, SALT_ROUNDS);

  let nuevaVersion: number | null;
  try {
    nuevaVersion = await actualizarPasswordYVersion(usuarioId, nuevoHash);
  } catch (error) {
    // 42703 = undefined_column: V18 (session_version) todavía no está aplicada en esta base.
    if ((error as { code?: string }).code === '42703') {
      auditar('password_cambio', usuarioId, 'no_disponible', 'v18_pendiente');
      throw new FuncionNoDisponibleError();
    }
    throw error;
  }
  if (nuevaVersion === null) throw new UsuarioNoDisponibleError();

  fallosPorUsuario.delete(usuarioId);
  auditar('password_cambio', usuarioId, 'ok');

  // El aviso por correo es un efecto secundario: nunca retrasa ni revierte el cambio (siempre resuelve).
  void enviarAvisoCambioPassword({ destinatarioNombre: usuario.nombre, destinatarioEmail: usuario.email }).catch(
    () => undefined
  );

  return {
    token: emitirToken(usuario.id, usuario.rol, nuevaVersion),
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, activo: usuario.activo, rol: usuario.rol },
  };
}
