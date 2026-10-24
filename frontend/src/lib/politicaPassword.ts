// Política de fortaleza de contraseñas (Fase 2C). Lógica PURA, sin dependencias.
//
// DUPLICADO a propósito en frontend/src/lib/politicaPassword.ts (paquetes separados, mismo
// criterio ya usado con LIMITES_CUENTA_BANCARIA). Ambos archivos deben mantenerse idénticos;
// una prueba en cada paquete verifica los mismos casos. El servidor SIEMPRE vuelve a evaluar:
// el indicador del formulario es solo una ayuda, no una garantía.
//
// Clasificación (solo FUERTE es aceptable; DEBIL y MEDIA se rechazan igual):
//   DEBIL  — menos de 5 caracteres, más de 72 bytes, contraseña común o predecible, contiene
//            datos del propio usuario, repetida o en secuencia.
//   MEDIA  — limpia pero todavía no aceptable: de 5 a 11 caracteres (le faltan para llegar a 12),
//            o 12+ caracteres con poca variedad y menos de 16 caracteres.
//   FUERTE — 12 o más caracteres sin defectos, y 16 o más caracteres, o 8+ caracteres distintos
//            con 3+ tipos.
// MEDIA existe también entre 5 y 11 caracteres para que el indicador avance de rojo a amarillo
// y a verde mientras se escribe; el mínimo de 12 caracteres para ACEPTAR no cambia.
// No se exigen mayúsculas ni símbolos concretos y se permiten frases largas y espacios.

export const LONGITUD_MINIMA_PASSWORD = 12;
// Por debajo de esto (1 a 4 caracteres) es DEBIL; entre este valor y el mínimo es MEDIA (solo visual: no se acepta).
export const LONGITUD_MEDIA_PASSWORD = 5;
// bcrypt solo considera los primeros 72 bytes: se rechaza lo que los exceda para que nadie crea
// tener una contraseña más larga de la que realmente se compara.
export const MAX_BYTES_PASSWORD = 72;

export type NivelPassword = 'DEBIL' | 'MEDIA' | 'FUERTE';

export type ProblemaPassword =
  | 'LONGITUD_MIN'
  | 'MAX_BYTES'
  | 'COMUN'
  | 'CONTIENE_DATOS'
  | 'REPETIDA'
  | 'SECUENCIA'
  | 'POCA_VARIEDAD';

export interface ContextoPassword {
  nombre?: string;
  email?: string;
}

export interface ResultadoPassword {
  nivel: NivelPassword;
  problemas: ProblemaPassword[];
  longitud: number;
  bytes: number;
}

export const MENSAJES_PROBLEMA: Record<ProblemaPassword, string> = {
  LONGITUD_MIN: `Debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres.`,
  // Texto para el usuario: sin términos técnicos (el límite real de 72 bytes se aplica igual).
  MAX_BYTES: 'La contraseña es demasiado larga. Acórtala un poco',
  COMUN: 'Es una contraseña común o fácil de adivinar.',
  CONTIENE_DATOS: 'No debe contener tu nombre ni parte de tu correo.',
  REPETIDA: 'No debe repetir el mismo carácter o bloque.',
  SECUENCIA: 'No debe ser una secuencia como 123456 o abcdef.',
  POCA_VARIEDAD: 'Añade más caracteres distintos, o hazla más larga (16 o más).',
};

// Contraseñas muy comunes (en español e inglés) y términos propios del negocio. Se compara contra
// la contraseña normalizada (minúsculas, sin tildes ni símbolos) y también sin los dígitos finales.
const CONTRASENAS_COMUNES = new Set([
  'password', 'passw0rd', 'p4ssw0rd', 'pass', 'contrasena', 'micontrasena', 'clave', 'claves', 'miclave',
  'qwerty', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdef', 'abcdefgh', 'abc', 'abcd',
  'iloveyou', 'teamo', 'tequiero', 'tequieromucho', 'amor', 'mivida', 'dios', 'jesus', 'familia',
  'admin', 'administrador', 'administrator', 'root', 'toor', 'user', 'usuario', 'test', 'prueba', 'default',
  'welcome', 'bienvenido', 'bienvenida', 'letmein', 'login', 'master', 'secret', 'secreto', 'changeme', 'cambiame',
  'monkey', 'dragon', 'football', 'futbol', 'baseball', 'princesa', 'princess', 'sunshine', 'shadow',
  'superman', 'batman', 'michael', 'jennifer', 'daniel', 'ashley', 'charlie', 'lovely', 'hello', 'hola', 'holamundo',
  'ecuador', 'quito', 'guayaquil', 'cuenca', 'barcelona', 'emelec', 'liguilla', 'madrid', 'realmadrid',
  'nextproject', 'mecanizado', 'torno', 'fresadora', 'taller', 'industrial', 'acero', 'empresa', 'trabajo',
  'gatito', 'perrito', 'corazon', 'angel', 'estrella', 'chocolate', 'verano', 'invierno', 'enero', 'febrero',
  'america', 'colombia', 'peru', 'mexico', 'chile', 'argentina',
]);

// Si la contraseña normalizada CONTIENE alguna de estas cadenas se considera predecible.
const SUBCADENAS_PROHIBIDAS = [
  'password', 'passw0rd', 'p4ssw0rd', 'contrasena', 'nextproject', 'mecanizado',
  'qwerty', 'asdfgh', 'zxcvb', '123456', '654321', 'iloveyou', 'tequiero',
];

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokensDeDatos(contexto: ContextoPassword): string[] {
  const tokens: string[] = [];
  if (contexto.nombre) {
    for (const parte of contexto.nombre.split(/\s+/)) {
      const t = normalizar(parte);
      if (t.length >= 4) tokens.push(t);
    }
  }
  if (contexto.email) {
    const local = normalizar(contexto.email.split('@')[0] ?? '');
    if (local.length >= 4) tokens.push(local);
  }
  return tokens;
}

function esRepetida(caracteres: string[]): boolean {
  if (new Set(caracteres).size <= 2) return true;
  const texto = caracteres.join('');
  for (let tamano = 1; tamano <= 6; tamano++) {
    if (caracteres.length % tamano === 0 && caracteres.length / tamano >= 2) {
      const bloque = caracteres.slice(0, tamano).join('');
      if (bloque.repeat(caracteres.length / tamano) === texto) return true;
    }
  }
  return false;
}

function esSecuencia(caracteres: string[]): boolean {
  if (caracteres.length < 6) return false;
  const codigos = caracteres.map((c) => c.toLowerCase().codePointAt(0) ?? 0);
  let consecutivos = 0;
  for (let i = 1; i < codigos.length; i++) {
    if (Math.abs(codigos[i] - codigos[i - 1]) === 1) consecutivos++;
  }
  return consecutivos / (codigos.length - 1) >= 0.7;
}

function contarTipos(password: string): number {
  const tipos = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{Nd}]/u];
  return tipos.filter((re) => re.test(password)).length;
}

export function evaluarPassword(password: string, contexto: ContextoPassword = {}): ResultadoPassword {
  const caracteres = Array.from(password);
  const longitud = caracteres.length;
  const bytes = new TextEncoder().encode(password).length;
  const problemas: ProblemaPassword[] = [];

  const muyCorta = longitud < LONGITUD_MEDIA_PASSWORD;
  const incompleta = longitud < LONGITUD_MINIMA_PASSWORD;
  if (incompleta) problemas.push('LONGITUD_MIN');
  if (bytes > MAX_BYTES_PASSWORD) problemas.push('MAX_BYTES');

  const base = normalizar(password);
  const sinDigitosFinales = base.replace(/[0-9]+$/, '');
  if (
    base.length > 0 &&
    (CONTRASENAS_COMUNES.has(base) ||
      CONTRASENAS_COMUNES.has(sinDigitosFinales) ||
      SUBCADENAS_PROHIBIDAS.some((s) => base.includes(s)))
  ) {
    problemas.push('COMUN');
  }

  if (tokensDeDatos(contexto).some((t) => base.includes(t))) problemas.push('CONTIENE_DATOS');
  if (longitud > 0 && esRepetida(caracteres)) problemas.push('REPETIDA');
  if (esSecuencia(caracteres)) problemas.push('SECUENCIA');

  // Cualquier defecto distinto de «le faltan caracteres» (o menos de 5 caracteres) es DEBIL.
  const hayDefectoGrave = muyCorta || problemas.some((p) => p !== 'LONGITUD_MIN');
  if (hayDefectoGrave) return { nivel: 'DEBIL', problemas, longitud, bytes };
  // De 5 a 11 caracteres y sin defectos: MEDIA, todavía no aceptable.
  if (incompleta) return { nivel: 'MEDIA', problemas, longitud, bytes };

  const distintos = new Set(caracteres).size;
  const fuerte = longitud >= 16 || (distintos >= 8 && contarTipos(password) >= 3);
  if (fuerte) return { nivel: 'FUERTE', problemas: [], longitud, bytes };

  return { nivel: 'MEDIA', problemas: ['POCA_VARIEDAD'], longitud, bytes };
}
