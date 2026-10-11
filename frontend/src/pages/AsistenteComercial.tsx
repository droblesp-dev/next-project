import { useRef, useState, type FormEvent } from 'react';
import { API_BASE } from '../lib/authClient';

interface AsistenteComercialProps {
  onIrFormulario: () => void;
}

type Paso = 'menu' | 'servicio' | 'asesor' | 'confirmado';

const FUENTES = [
  { value: 'WEB', label: 'Sitio web' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'REFERIDO', label: 'Un referido' },
  { value: 'OTRO', label: 'Otro' },
];

// ASISTENTE-COMERCIAL-02 (autorización explícita — hallazgo de la auditoría
// ASISTENTE-COMERCIAL-01): misma regla que `normalizarTelefonoEc` del
// formulario principal (App.tsx) y del backend (solicitudes.controller.ts) —
// duplicada intencionalmente entre capas/archivos, mismo criterio ya usado en
// todo el proyecto para constantes de validación simples. Un solo número EC,
// nunca varios ni texto libre.
function normalizarTelefonoEc(valor: string): { valido: boolean; normalizado: string } {
  let limpio = valor.trim().replace(/[\s\-().]/g, '');
  if (limpio.startsWith('+593')) {
    limpio = '0' + limpio.slice(4);
  } else if (limpio.startsWith('593') && limpio.length === 12) {
    limpio = '0' + limpio.slice(3);
  }
  const valido = /^0(9\d{8}|[2-7]\d{7})$/.test(limpio);
  return { valido, normalizado: valido ? '+593' + limpio.slice(1) : valor.trim() };
}

// ASISTENTE-COMERCIAL-06 (autorización explícita — decisión nacida de la
// auditoría "ASESOR → ASESOR / Sin correo → con correo"): el correo deja de
// ser opcional en este formulario. Mismo regex que App.tsx
// (validarFormularioLocal) — ahora exigido aquí también.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AsistenteComercial({ onIrFormulario }: AsistenteComercialProps) {
  const [paso, setPaso] = useState<Paso>('menu');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [fuente, setFuente] = useState('WEB');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FORMULARIO-UX-08.1 (autorización explícita): mismo patrón que App.tsx — "tocado" se activa
  // en onBlur o al intentar enviar; la validez NUNCA se guarda aparte, se recalcula en cada
  // render a partir de telefono/email, así que corregir un error se refleja de inmediato.
  const [telefonoTocado, setTelefonoTocado] = useState(false);
  const [emailTocado, setEmailTocado] = useState(false);

  // VALIDACIONES-ASISTENTE-01 (autorización explícita — corrección derivada de la auditoría
  // integral de validaciones): antes, el mensaje de error general se fijaba una sola vez con
  // `setError(...)` dentro de `handleEnviar` y quedaba "congelado" en pantalla aunque el usuario
  // corrigiera el campo que lo causó — solo se actualizaba en el siguiente clic en ENVIAR.
  // `intentoEnvio` solo marca que YA hubo al menos un intento de envío (nunca antes de eso se
  // muestra ningún error general); el mensaje en sí (`errorValidacion`, más abajo) se recalcula
  // en cada render a partir del estado actual de los campos, igual que ya hacían `telefonoEsInvalido`
  // y `emailEsInvalido`.
  const [intentoEnvio, setIntentoEnvio] = useState(false);

  // ASISTENTE-COMERCIAL-02 (autorización explícita — hallazgo de la auditoría
  // ASISTENTE-COMERCIAL-01): mismo patrón que `enviandoRef` en App.tsx — guarda
  // SÍNCRONA e inmediata (no depende de ningún re-render de React), fijada
  // ANTES de iniciar el fetch. Un doble clic casi simultáneo llegaba a
  // disparar 2 peticiones reales porque `disabled={enviando}` por sí solo
  // depende de que React ya haya re-renderizado el botón.
  const enviandoRef = useRef(false);

  async function handleEnviar(e: FormEvent) {
    e.preventDefault();

    if (enviandoRef.current) {
      return;
    }

    // VALIDACIONES-ASISTENTE-01 (autorización explícita): marca que ya hubo un intento de envío
    // — a partir de aquí, `errorValidacion` (derivado más abajo) puede mostrarse. El TEXTO del
    // mensaje ya no se fija aquí: se recalcula en cada render a partir del estado actual de los
    // campos, así que si el usuario corrige el campo que falló, el mensaje avanza o desaparece de
    // inmediato sin necesidad de un nuevo clic en ENVIAR.
    setIntentoEnvio(true);

    if (!telefonoEsValido || emailVacio || !emailEsValido) {
      // FORMULARIO-UX-08.1 (autorización explícita): se marcan ambos campos como "tocados" para
      // que el indicador visual en línea se active aunque el usuario no haya salido de ningún
      // campo.
      setTelefonoTocado(true);
      setEmailTocado(true);
    }
    if (nombreEstaVacio || !telefonoEsValido || emailVacio || !emailEsValido) {
      return;
    }

    const telefonoNormalizado = normalizarTelefonoEc(telefono).normalizado;
    const emailTrim = email.trim();

    enviandoRef.current = true;
    setEnviando(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono: telefonoNormalizado, email: emailTrim, fuente }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        // ASISTENTE-COMERCIAL-02: solo se muestra un mensaje del backend
        // cuando es un mensaje FUNCIONAL real (validación de negocio) — nunca
        // un texto técnico crudo (stack trace, error SQL, "Failed to fetch",
        // etc.), que caía aquí antes vía `error.message` en el catch.
        throw new Error(data?.message || 'No se pudo registrar tu solicitud de contacto.');
      }

      setPaso('confirmado');
    } catch (err) {
      // ASISTENTE-COMERCIAL-02 (autorización explícita — hallazgo de la
      // auditoría ASISTENTE-COMERCIAL-01): antes se mostraba `err.message`
      // directamente, lo que exponía errores técnicos en inglés (ej. "Failed
      // to fetch") ante un fallo de red. Solo se conserva el mensaje real
      // cuando viene del `throw new Error(data?.message ...)` de arriba (un
      // mensaje funcional ya pensado para el usuario); cualquier otro error
      // (de red, CORS, etc.) usa el mensaje amigable fijo.
      const esErrorDeRed = !(err instanceof Error) || err.message === 'Failed to fetch' || err.name === 'TypeError';
      setError(
        esErrorDeRed
          ? 'No pudimos enviar tus datos en este momento. Inténtalo nuevamente.'
          : (err as Error).message,
      );
    } finally {
      setEnviando(false);
      enviandoRef.current = false;
    }
  }

  // FORMULARIO-UX-08.1 (autorización explícita): validez derivada en cada render, igual que
  // App.tsx.
  const nombreEstaVacio = nombre.trim() === '';

  const telefonoVacio = telefono.trim() === '';
  const telefonoEsValido = !telefonoVacio && normalizarTelefonoEc(telefono).valido;
  const telefonoEsInvalido = telefonoTocado && !telefonoVacio && !telefonoEsValido;
  const telefonoMostrarValido = telefonoTocado && telefonoEsValido;

  // VALIDACIONES-ASISTENTE-01 (autorización explícita — corrección derivada de la auditoría
  // integral de validaciones): el correo ahora sigue EXACTAMENTE el mismo patrón que el teléfono
  // — un campo vacío nunca se marca en rojo por sí solo (ni al perder el foco ni al enviar), solo
  // el formato inválido lo hace. `emailFaltaObligatorio` (que sí ponía el campo vacío en rojo al
  // perder el foco) se elimina; la distinción "vacío" vs "formato inválido" para el mensaje
  // GENERAL de envío se conserva en `errorValidacion`, más abajo.
  const emailVacio = email.trim() === '';
  const emailEsValido = !emailVacio && EMAIL_REGEX.test(email.trim());
  const emailEsInvalido = emailTocado && !emailVacio && !emailEsValido;
  const emailMostrarValido = emailTocado && emailEsValido;

  // VALIDACIONES-ASISTENTE-01 (autorización explícita): mensaje general de envío, derivado en
  // cada render — nunca se "congela". Antes de cualquier intento de envío, siempre es `null` (no
  // se muestran errores prematuros). Mantiene el mismo orden de validación que antes: nombre,
  // teléfono, correo (vacío primero, formato inválido después).
  const errorValidacion = !intentoEnvio
    ? null
    : nombreEstaVacio
      ? 'El nombre es obligatorio.'
      : !telefonoEsValido
        ? 'Ingresa un solo número de contacto válido de Ecuador.'
        : emailVacio
          ? 'El correo electrónico es obligatorio.'
          : !emailEsValido
            ? 'Ingresa un correo electrónico válido.'
            : null;

  if (paso === 'menu') {
    return (
      <div className="space-y-4">
        <p className="font-body-md text-sm text-on-surface-variant">
          Cuéntenos qué necesita y le ayudamos a elegir el siguiente paso.
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={onIrFormulario}
            className="w-full text-left px-4 py-3 bg-surface-container-high hover:bg-outline/40 border border-outline transition-colors font-['Inter'] text-[14px] font-semibold"
          >
            1. SOLICITAR COTIZACIÓN
          </button>
          <button
            type="button"
            onClick={() => setPaso('servicio')}
            className="w-full text-left px-4 py-3 bg-surface-container-high hover:bg-outline/40 border border-outline transition-colors font-['Inter'] text-[14px] font-semibold"
          >
            2. CONSULTAR UN SERVICIO
          </button>
          <button
            type="button"
            onClick={() => setPaso('asesor')}
            className="w-full text-left px-4 py-3 bg-primary-container text-on-primary-container hover:bg-primary-fixed-dim transition-colors font-['Inter'] text-[14px] font-semibold"
          >
            3. HABLAR CON UN ASESOR
          </button>
        </div>
      </div>
    );
  }

  if (paso === 'servicio') {
    return (
      <div className="space-y-4">
        <p className="font-body-md text-sm text-on-surface-variant">
          Trabajamos torno industrial, fresado industrial, fabricación de piezas nuevas bajo plano o muestra, y
          reparación/recuperación de componentes desgastados. Si su pieza no está en la lista, igual podemos
          evaluarla.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onIrFormulario}
            className="px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors cursor-pointer"
          >
            SOLICITAR COTIZACIÓN
          </button>
          <button
            type="button"
            onClick={() => setPaso('asesor')}
            className="px-4 py-2 border border-outline text-on-surface font-['Inter'] text-[14px] font-semibold hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            HABLAR CON UN ASESOR
          </button>
          <button
            type="button"
            onClick={() => setPaso('menu')}
            className="px-4 py-2 text-on-surface-variant font-['Inter'] text-[14px] font-semibold hover:text-on-surface transition-colors cursor-pointer"
          >
            VOLVER
          </button>
        </div>
      </div>
    );
  }

  if (paso === 'confirmado') {
    return (
      <div className="text-center py-6 space-y-3">
        <span className="material-symbols-outlined text-4xl text-primary-container">check_circle</span>
        {/* ASISTENTE-COMERCIAL-02 (autorización explícita — hallazgo de la auditoría
            ASISTENTE-COMERCIAL-01): ya no se afirma un canal (WhatsApp) ni un plazo concreto que
            el flujo real no garantiza — "por el medio que proporcionaste" es siempre cierto,
            cualquiera sea el teléfono/correo que el usuario haya dejado. */}
        <p className="font-body-md text-sm text-on-surface">
          {nombre.trim() ? `Gracias, ${nombre.trim()}. ` : ''}Recibimos tu mensaje. En breve, un asesor comercial se pondrá en contacto contigo para responder tus consultas y ayudarte con tu requerimiento.
        </p>
      </div>
    );
  }

  return (
    // ASISTENTE-COMERCIAL-02: `noValidate` — igual que en FORMULARIO-UX-07.1 (App.tsx), sin esto la
    // validación nativa del navegador (`type="email"`) bloquearía el envío antes de que
    // `handleEnviar` pudiera mostrar "Ingresa un correo electrónico válido."; `required` en
    // nombre/teléfono se conserva (semántica/accesibilidad), solo deja de bloquear por sí solo.
    <form className="space-y-4" onSubmit={handleEnviar} noValidate>
      <p className="font-body-md text-sm text-on-surface-variant pl-2">
        Déjenos sus datos y un asesor comercial le contactará.
      </p>
      <div>
        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1 pl-2">Nombre *</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 pl-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          type="text"
        />
      </div>
      <div>
        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1 pl-2">Teléfono / WhatsApp *</label>
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          onBlur={() => setTelefonoTocado(true)}
          required
          maxLength={20}
          aria-invalid={telefonoEsInvalido}
          aria-describedby="asesor-telefono-ayuda"
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 pl-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          placeholder="Ej. 099 999 9999"
          type="tel"
        />
        {/* FORMULARIO-UX-08.1 (autorización explícita): mismo patrón de 4 estados que App.tsx —
            un único párrafo, nunca se agrega/quita el elemento (evita saltos de layout). `maxLength`
            agregado aquí por primera vez (antes solo existía en el formulario principal), verificado
            que no bloquea los formatos internacionales ya aceptados (ver pruebas del informe). */}
        <p
          id="asesor-telefono-ayuda"
          aria-live="polite"
          className={`font-['Inter'] text-[13px] font-normal mt-1 pl-2 flex items-center gap-1 ${
            telefonoEsInvalido ? 'text-error' : telefonoMostrarValido ? 'text-primary-container' : 'text-on-surface-variant'
          }`}
        >
          {telefonoMostrarValido && (
            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">check_circle</span>
          )}
          {telefonoEsInvalido
            ? 'Ingresa un solo número de contacto válido de Ecuador.'
            : telefonoMostrarValido
              ? 'Número válido.'
              : 'Ingresa un número de contacto válido de Ecuador.'}
        </p>
      </div>
      <div>
        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1 pl-2">Correo electrónico *</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTocado(true)}
          required
          aria-invalid={emailEsInvalido}
          aria-describedby="asesor-email-ayuda"
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 pl-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          placeholder="Ej. nombre@empresa.com"
          type="email"
        />
        {/* VALIDACIONES-ASISTENTE-01 (autorización explícita): mismo patrón de 3 estados que el
            teléfono — vacío/neutro, formato inválido en rojo, válido en verde con texto de
            confirmación propio ("Correo válido."), en vez de repetir el texto instructivo. */}
        <p
          id="asesor-email-ayuda"
          aria-live="polite"
          className={`font-['Inter'] text-[13px] font-normal mt-1 pl-2 flex items-center gap-1 ${
            emailEsInvalido ? 'text-error' : emailMostrarValido ? 'text-primary-container' : 'text-on-surface-variant'
          }`}
        >
          {emailMostrarValido && (
            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">check_circle</span>
          )}
          {emailEsInvalido
            ? 'Ingresa un correo electrónico válido.'
            : emailMostrarValido
              ? 'Correo válido.'
              : 'Ingresa un correo electrónico válido.'}
        </p>
      </div>
      <div>
        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1 pl-2">¿Cómo nos encontró?</label>
        <div className="relative">
          <select
            value={fuente}
            onChange={(e) => setFuente(e.target.value)}
            className="w-full appearance-none bg-background border-0 border-b border-outline text-on-surface px-0 pl-2 pr-8 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none cursor-pointer"
          >
            {FUENTES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
            expand_more
          </span>
        </div>
      </div>

      {/* VALIDACIONES-ASISTENTE-01 (autorización explícita): `errorValidacion` (derivado, se
          recalcula en cada render) tiene prioridad — mientras exista un campo local inválido,
          muestra siempre el primero según el orden nombre→teléfono→correo, y se actualiza o
          desaparece de inmediato al corregir el campo, sin esperar un nuevo envío. `error` (el
          mensaje del backend/red, fijado solo tras un intento real de envío) se muestra únicamente
          cuando ya no queda ningún problema de validación local. */}
      {(errorValidacion || error) && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase pl-2">
          {errorValidacion || error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          disabled={enviando}
          type="submit"
          className="px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
        >
          {enviando ? 'ENVIANDO...' : 'ENVIAR'}
        </button>
        <button
          type="button"
          onClick={() => setPaso('menu')}
          className="px-4 py-2 text-on-surface-variant font-['Inter'] text-[14px] font-semibold hover:text-on-surface transition-colors cursor-pointer"
        >
          VOLVER
        </button>
      </div>
    </form>
  );
}
