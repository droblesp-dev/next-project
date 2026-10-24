import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import { consumirInvocacionNexiaPublica, LimiteNexiaError } from './nexiaRateLimit.service.js';

// FORMULARIO-01 (autorización explícita del usuario, tras plantear la
// alternativa de un ayudante sin IA real): asistente PÚBLICO y ANÓNIMO del
// formulario de cotización ("Ayúdame con IA"). Reutiliza el mismo cliente y
// configuración de Gemini ya usados por solicitudMensajes.service.ts
// (NexIA del chat interno) y analisisIa.service.ts — mismas variables de
// entorno (GEMINI_API_KEY, GEMINI_MODEL), mismo SDK, mismo criterio de
// nunca dejar que un fallo del proveedor se propague como error al
// visitante. NO es la misma función ni el mismo endpoint: aquella exige
// sesión y una solicitud ya existente (persiste en solicitud_mensajes);
// esta es anónima, sin persistencia y sin historial de conversación — por
// diseño (nunca debe acumular contexto entre visitantes distintos).
//
// NEXIA-UX-04: `LimiteAsistenteFormularioError` (429 por límite agotado) se
// retiró — el límite de IA ya no puede terminar en un error para el
// visitante, siempre cae al respaldo determinístico (ver consultarAsistente).
export class PromptInvalidoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// NEXIA-UX-05.1 (autorización explícita — hallazgo crítico de la auditoría
// NEXIA-UX-05: "el servicio seleccionado nunca llega al backend"): el
// servicio ahora es un campo requerido y validado — nunca se confía
// únicamente en que el frontend ya lo validó.
export class ServicioInvalidoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// Marcadores internos de causa (nunca se exponen al visitante — ver
// `RazonFallback` y `registrarFallback` más abajo). Existen solo para que el
// log del servidor pueda distinguir NO_API_KEY y RESPUESTA_VACIA de un error
// genérico del proveedor, sin depender de adivinar el motivo a partir del
// texto de un `Error` cualquiera.
class SinApiKeyError extends Error {}
class RespuestaVaciaError extends Error {}

const PROMPT_MAX_CARACTERES = 1000;
const GEMINI_TIMEOUT_MS = 20_000;

// FORMULARIO-01.1 (autorización explícita — "NEXIA HÍBRIDO"): NexIA público
// tiene 2 modos. MODO_IA cuando Gemini responde con contenido real. MODO_ESTANDAR
// — sin API key, error del proveedor o timeout — cuando se usa el respaldo
// determinístico (ver generarSugerenciaDeterministica). En ningún caso se
// propaga un error al visitante ni se bloquea el envío del formulario: NexIA
// es siempre opcional y ajeno al submit principal (App.tsx no depende de esto).
export type ModoAsistente = 'IA' | 'ESTANDAR';

export interface SugerenciaFormulario {
  sugerencia: string;
  modo: ModoAsistente;
}

// ---------------------------------------------------------------------
// NEXIA-UX-05.1: contexto derivado EXCLUSIVAMENTE del servicio seleccionado
// explícitamente por el usuario en el formulario — nunca de palabras clave
// del texto libre (hallazgo crítico de NEXIA-UX-05: antes el contexto se
// adivinaba del prompt y podía contradecir el servicio ya elegido). El
// contrato del endpoint pasa a exigir `servicio` además de `prompt`; se
// valida aquí contra la lista cerrada de las 5 opciones reales del
// `<select>` del formulario (App.tsx) — un valor fuera de esta lista se
// rechaza con 400, nunca se adivina ni se ignora en silencio.
// ---------------------------------------------------------------------
export type ContextoNexia = 'TORNO' | 'FRESADO' | 'FABRICACION' | 'REPARACION_RECUPERACION' | 'NO_ESTOY_SEGURO';

// Las claves son EXACTAMENTE los `value` de las 5 <option> del select de
// servicio en App.tsx — cualquier cambio en esos textos debe reflejarse aquí.
const SERVICIO_A_CONTEXTO: Record<string, ContextoNexia> = {
  'TORNO INDUSTRIAL': 'TORNO',
  'FRESADO INDUSTRIAL': 'FRESADO',
  'FABRICACIÓN A MEDIDA': 'FABRICACION',
  'REPARACIÓN Y RECUPERACIÓN': 'REPARACION_RECUPERACION',
  'NO ESTOY SEGURO / NECESITO ORIENTACIÓN': 'NO_ESTOY_SEGURO',
};

function resolverContexto(servicioSeleccionado: string): ContextoNexia {
  const contexto = SERVICIO_A_CONTEXTO[servicioSeleccionado.trim()];
  if (!contexto) {
    throw new ServicioInvalidoError('servicio debe ser una de las opciones válidas del formulario.');
  }
  return contexto;
}

// Nombre en español natural del contexto — se usa dentro del prompt de
// Gemini (nunca se expone tal cual al visitante) para que MODO IA respete
// la misma prioridad absoluta del servicio que ya respeta MODO ESTÁNDAR.
const NOMBRE_CONTEXTO: Record<ContextoNexia, string> = {
  TORNO: 'Torno industrial',
  FRESADO: 'Fresado industrial',
  FABRICACION: 'Fabricación a medida (pieza nueva)',
  REPARACION_RECUPERACION: 'Reparación y recuperación (pieza o componente existente)',
  NO_ESTOY_SEGURO: 'el visitante indicó que no está seguro / necesita orientación',
};

// NEXIA-UX-06 (autorización explícita — "Implementación controlada de
// preguntas de orientación técnica"): pregunta orientativa adicional por
// contexto, usada tanto como sugerencia para Gemini (construirPrompt, nunca
// exigida de forma literal) como en el respaldo determinístico
// (generarSugerenciaDeterministica). NO_ESTOY_SEGURO queda deliberadamente
// fuera de este mapa — su plantilla se conserva sin cambios por instrucción
// explícita del alcance autorizado. Ninguna de estas preguntas afirma que el
// servicio ya seleccionado es correcto o incorrecto: solo ayuda al propio
// visitante a describir mejor su necesidad dentro del servicio elegido.
const PREGUNTA_ORIENTATIVA_CONTEXTO: Partial<Record<ContextoNexia, string>> = {
  TORNO: '¿La pieza ya existe y está dañada, o necesitas fabricar una nueva?',
  FRESADO: '¿La pieza ya existe y está dañada, o necesitas fabricar una nueva?',
  FABRICACION: '¿Tienes un plano, croquis o una pieza similar que podamos usar como referencia?',
  REPARACION_RECUPERACION:
    '¿Qué parte específica de la pieza está dañada y qué parte permanece en buen estado?',
};

// Nunca inventa: la regla central del prompt es "organiza lo que el usuario
// ya escribió; si falta algo relevante, pregúntalo, no lo asumas" — ninguna
// especificación técnica (material/dimensión/tolerancia/norma/proceso) ni
// comercial (precio/plazo) puede aparecer si el usuario no la mencionó.
//
// NEXIA-UX-05.1: se añade el servicio ya seleccionado como dato de contexto
// OBLIGATORIO para Gemini, con prioridad absoluta — MODO IA ya no puede
// "cambiar de tema" hacia otro servicio solo porque el texto libre mencione
// una palabra de otro contexto (regla #1/#2 del pedido, antes solo aplicada
// al respaldo determinístico).
function construirPrompt(promptUsuario: string, contexto: ContextoNexia): string {
  const preguntaOrientativa = PREGUNTA_ORIENTATIVA_CONTEXTO[contexto];
  return [
    'Eres un asistente de redacción para el formulario público de cotización de NEXTPROJECT, un centro de',
    'mecanizado industrial. Ayudas a un visitante SIN conocimientos técnicos a expresar mejor, en español',
    'sencillo, lo que YA escribió sobre su necesidad — nunca a completarla con datos que no dio.',
    '',
    `El visitante YA seleccionó explícitamente el servicio en el formulario: ${NOMBRE_CONTEXTO[contexto]}.`,
    'Esa selección tiene PRIORIDAD ABSOLUTA: aunque el texto del visitante mencione palabras asociadas a otro',
    'servicio (por ejemplo "reparar" habiendo seleccionado fabricación, o "fabricar" habiendo seleccionado',
    'reparación), NUNCA cambies de servicio ni dejes entender que corresponde otro — organiza el texto dentro',
    'del servicio ya seleccionado. Si el visitante seleccionó "no está seguro/necesita orientación", mantén tu',
    'respuesta neutral: NUNCA decidas ni sugieras automáticamente cuál de los otros 4 servicios le corresponde.',
    '',
    'REGLAS ESTRICTAS (nunca las rompas):',
    '- NUNCA inventes ni sugieras materiales, dimensiones, tolerancias, normas técnicas (DIN, ISO, etc.) ni',
    '  procesos de mecanizado (torneado, fresado, soldadura...) que el usuario no haya mencionado explícitamente.',
    '- NUNCA calcules ni menciones precios, costos, plazos de entrega ni ninguna decisión comercial.',
    '- NUNCA afirmes saber algo que el usuario no dijo. Si falta información relevante, formúlala como una',
    '  pregunta simple para el propio usuario — nunca como un dato asumido o ya confirmado.',
    '- NUNCA preguntes por la cantidad de unidades — ese dato ya se captura por separado en el formulario.',
    '- Responde en español, en texto plano (sin markdown, sin viñetas), breve (máximo 6 líneas en total).',
    '- Reorganiza literalmente lo que el usuario ya escribió en frases más claras, y agrega como máximo 2 o 3',
    '  preguntas simples y no técnicas que lo ayuden a dar más contexto útil (ej.: "¿Tienes una muestra o',
    '  fotografía de la pieza?").',
    ...(preguntaOrientativa
      ? [
          '- Pregunta orientativa sugerida para este servicio (reformúlala con tus propias palabras, nunca la',
          '  copies de forma literal, e inclúyela solo si es realmente relevante para lo que el usuario escribió;',
          `  nunca la uses para afirmar que el servicio elegido es correcto o incorrecto): "${preguntaOrientativa}"`,
        ]
      : []),
    '- Nunca actúes como si la solicitud ya estuviera enviada, cotizada o aceptada — el visitante decidirá si',
    '  usa este texto o no; no es una respuesta oficial de la empresa.',
    '',
    'Texto que escribió el visitante:',
    '"""',
    promptUsuario,
    '"""',
    '',
    'Reescribe y organiza ese texto siguiendo las reglas anteriores, dentro del servicio ya seleccionado.',
  ].join('\n');
}

// Nunca lanza por ningún motivo relacionado con IA/límite/Gemini: siempre
// resuelve con {sugerencia, modo}. Lanza PromptInvalidoError o
// ServicioInvalidoError — ambos 400 genuinos de validación de entrada, nada
// que ningún modo pueda responder sin un dato de entrada válido.
export async function generarSugerenciaFormulario(
  promptUsuario: string,
  servicioSeleccionado: string,
  ip: string
): Promise<SugerenciaFormulario> {
  const limpio = promptUsuario.trim();
  if (!limpio) {
    throw new PromptInvalidoError('prompt es requerido.');
  }
  if (limpio.length > PROMPT_MAX_CARACTERES) {
    throw new PromptInvalidoError(`prompt no puede superar ${PROMPT_MAX_CARACTERES} caracteres.`);
  }

  const contexto = resolverContexto(servicioSeleccionado);

  return consultarAsistente(limpio, contexto, ip);
}

// NEXIA-UX-04: causa interna del respaldo — exclusivamente para el log del
// servidor (registrarFallback más abajo). NUNCA viaja en la respuesta HTTP ni
// se expone al visitante de ninguna forma (ni en `sugerencia` ni en `modo`,
// que solo distingue IA/ESTANDAR, no el motivo).
type RazonFallback = 'RATE_LIMIT' | 'NO_API_KEY' | 'TIMEOUT' | 'RESPUESTA_VACIA' | 'GEMINI_ERROR';

function clasificarRazonFallback(error: unknown): RazonFallback {
  if (error instanceof LimiteNexiaError) return 'RATE_LIMIT';
  if (error instanceof SinApiKeyError) return 'NO_API_KEY';
  if (error instanceof RespuestaVaciaError) return 'RESPUESTA_VACIA';
  const mensaje = error instanceof Error ? error.message : '';
  const nombre = error instanceof Error ? error.name : '';
  if (nombre === 'AbortError' || /timeout|timed out|deadline exceeded|etimedout/i.test(mensaje)) {
    return 'TIMEOUT';
  }
  return 'GEMINI_ERROR';
}

// Registro técnico interno (consola del servidor únicamente): distingue
// RATE_LIMIT de un fallo real del proveedor — un límite agotado es un evento
// normal y esperado (nunca un error), mientras que GEMINI_ERROR/TIMEOUT sí
// interesa investigarlos. Nunca incluye el prompt del visitante ni la API key.
function registrarFallback(razon: RazonFallback, error: unknown): void {
  if (razon === 'RATE_LIMIT') {
    console.info('[asistente-formulario] límite de invocaciones IA alcanzado — se usa MODO ESTÁNDAR (recupera automáticamente al liberarse cupo).');
    return;
  }
  const mensajeError = error instanceof Error ? error.message : 'Error desconocido al consultar el asistente.';
  console.error(`[asistente-formulario] fallback a MODO ESTÁNDAR (razon=${razon}):`, sanitizarMensajeError(mensajeError));
}

// MODO_IA: hay cupo de Gemini para esta IP Y Gemini responde con contenido
// real -> se usa tal cual (ya respetando el servicio, ver construirPrompt).
// MODO_ESTANDAR: agotado el cupo de IA, o cualquier fallo del proveedor (sin
// API key, error de red, timeout, respuesta vacía) -> respaldo
// determinístico, también fijado por el mismo `contexto`. Un único
// try/catch: NUNCA se propaga ningún error de esta función — NexIA siempre
// responde, en un modo u otro, siempre dentro del servicio seleccionado.
async function consultarAsistente(promptUsuario: string, contexto: ContextoNexia, ip: string): Promise<SugerenciaFormulario> {
  try {
    // NEXIA-UX-04: sin API key, Gemini NUNCA se llega a contactar — por eso
    // esta comprobación va ANTES de tocar el limitador: el límite protege
    // EXCLUSIVAMENTE el consumo real de Gemini, así que un intento que ni
    // siquiera puede alcanzar la red no debe gastar cupo (si lo gastara,
    // una mala configuración temporal de la API key podría retrasar la
    // recuperación de MODO IA sin ninguna razón real).
    if (!env.geminiApiKey) {
      throw new SinApiKeyError('GEMINI_API_KEY no está configurada.');
    }

    // A partir de aquí SÍ se va a intentar la llamada real — recién ahora se
    // consulta el límite. Si no hay cupo, cae directo al catch de abajo
    // (mismo destino que cualquier otro fallo de Gemini), sin llegar a
    // llamar a la red.
    consumirInvocacionNexiaPublica(ip);

    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
    const response = await ai.models.generateContent({
      model: env.geminiModel,
      contents: construirPrompt(promptUsuario, contexto),
      config: {
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      },
    });

    const texto = response.text?.trim();
    if (!texto) {
      throw new RespuestaVaciaError('El proveedor de IA no devolvió contenido.');
    }
    return { sugerencia: texto, modo: 'IA' };
  } catch (error) {
    registrarFallback(clasificarRazonFallback(error), error);
    return { sugerencia: generarSugerenciaDeterministica(promptUsuario, contexto), modo: 'ESTANDAR' };
  }
}

// ---------------------------------------------------------------------
// NEXIA-UX-05.1: respaldo determinístico y ESTRUCTURADO de MODO_ESTANDAR,
// ahora con exactamente los 5 contextos del formulario (reemplaza los 6
// contextos por intención de NEXIA-UX-01 — FABRICAR/REPARAR/RECUPERAR/
// MODIFICAR/NO_ESTOY_SEGURO/GENERAL —, retirados en este mismo bloque tras
// confirmar por `grep` en todo el repositorio que no tenían ninguna
// referencia fuera de este archivo: ver informe de este bloque). El
// contexto llega ya resuelto desde `resolverContexto()` — esta función
// nunca vuelve a mirar el texto libre para decidir el contexto, solo para
// reproducirlo (regla #2: "las palabras clave NO pueden cambiar el contexto
// seleccionado").
//
// Ninguna plantilla pregunta por cantidad (regla #4/#5 — corrige el hallazgo
// de NEXIA-UX-05: las plantillas anteriores sí preguntaban "¿Cuántas
// unidades necesitas?"/"una o varias unidades").
// ---------------------------------------------------------------------

// Capitalización/puntuación mínima — nunca reescribe ni interpreta el contenido.
function normalizarOracion(texto: string): string {
  const t = texto.trim();
  if (!t) return t;
  const conMayuscula = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(conMayuscula) ? conMayuscula : `${conMayuscula}.`;
}

// NEXIA-UX-05.2 (autorización explícita — "AJUSTE FINAL DE UX: PREGUNTAS Y MATERIAL DE APOYO"):
// las preguntas deben presentarse como algo que el usuario debe RESPONDER para completar su
// solicitud (regla #1/#2 del pedido), no como texto meramente informativo — y debe quedar claro que
// no responder no bloquea nada (regla #3/#4). Mismo texto exacto pedido, reutilizado en los 4
// contextos que usan `plantillaConEco` (antes cada uno tenía su propio "cierre"; ahora es un único
// texto fijo, ya que el pedido dio un solo ejemplo válido para todos).
const INSTRUCCION_RESPONDER = 'Para completar tu solicitud, responde estas preguntas si conoces la información:';
const NOTA_SIN_DATO = 'Si no conoces algún dato, puedes indicarlo y continuar.';

function plantillaConEco(introduccion: string, promptUsuario: string, preguntas: string[]): string {
  return [
    introduccion,
    '',
    normalizarOracion(promptUsuario),
    '',
    INSTRUCCION_RESPONDER,
    '',
    ...preguntas.map((p) => `- ${p}`),
    '',
    NOTA_SIN_DATO,
  ].join('\n');
}

function generarSugerenciaDeterministica(promptUsuario: string, contexto: ContextoNexia): string {
  switch (contexto) {
    // No debe diagnosticar qué operación específica debe realizarse (regla del pedido).
    case 'TORNO':
      return plantillaConEco('Puedes describirlo así:', promptUsuario, [
        '¿La pieza ya existe y está dañada, o necesitas fabricar una nueva?',
        '¿Qué tipo de pieza necesitas (eje, buje, tornillo, etc.) y para qué la vas a usar?',
        '¿Tienes una pieza de muestra, fotografía o plano de referencia?',
        '¿Conoces alguna medida o característica de la pieza (diámetro, longitud, rosca)?',
      ]);

    // No debe determinar técnicamente el proceso requerido.
    case 'FRESADO':
      return plantillaConEco('Puedes describirlo así:', promptUsuario, [
        '¿La pieza ya existe y está dañada, o necesitas fabricar una nueva?',
        '¿Qué pieza y qué zona de ella necesita el trabajo?',
        '¿Tienes una pieza de muestra, fotografía o plano de referencia?',
        '¿Conoces alguna medida o característica de la pieza?',
      ]);

    case 'FABRICACION':
      return plantillaConEco('Puedes describirlo así:', promptUsuario, [
        '¿Qué pieza necesitas fabricar y en qué equipo o máquina se va a usar?',
        '¿Tienes un plano, croquis, fotografía o una pieza similar que podamos usar como referencia?',
        '¿Conoces alguna medida o característica de la pieza?',
      ]);

    // No debe asumir la causa de la falla ni decidir técnicamente el método de recuperación.
    case 'REPARACION_RECUPERACION':
      return plantillaConEco('Puedes describir tu necesidad así:', promptUsuario, [
        '¿Qué parte específica de la pieza está dañada y qué parte permanece en buen estado?',
        '¿En qué equipo o máquina se utiliza?',
        '¿Tienes una fotografía o pieza de muestra?',
      ]);

    // Permanece neutral: nunca decide automáticamente TORNO/FRESADO/FABRICACION/REPARACION_RECUPERACION.
    //
    // NEXIA-UX-05.3 (autorización explícita — "SEPARAR ORIENTACIÓN NEXIA DEL AVISO SOBRE
    // FOTOGRAFÍAS"): la responsabilidad de NEXIA es únicamente ayudar a estructurar el
    // requerimiento — nunca hablar de fotografías/planos/piezas de muestra ni del flujo de
    // WhatsApp (eso vive exclusivamente en el bloque informativo independiente de App.tsx).
    // Antes de este ajuste, esta plantilla agregaba una frase adicional después de
    // NOTA_SIN_DATO mencionando fotografía/plano/muestra/WhatsApp, duplicando ese bloque
    // cuando el usuario seleccionaba este contexto. Se retira esa frase; la respuesta ahora
    // termina en NOTA_SIN_DATO, igual que los otros 4 contextos.
    case 'NO_ESTOY_SEGURO':
    default:
      return [
        'No necesitas conocer el nombre técnico del trabajo.',
        '',
        'Para ayudarnos a definir tu necesidad, responde estas preguntas si conoces la información:',
        '',
        '- ¿Qué pieza o equipo está involucrado?',
        '- ¿Para qué se utiliza?',
        '- ¿Qué problema o necesidad tienes?',
        '',
        NOTA_SIN_DATO,
      ].join('\n');
  }
}

function sanitizarMensajeError(mensaje: string): string {
  let limpio = mensaje;
  if (env.geminiApiKey) {
    limpio = limpio.split(env.geminiApiKey).join('[REDACTED]');
  }
  return limpio.slice(0, 500);
}
