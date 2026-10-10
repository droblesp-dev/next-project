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

    // ASISTENTE-COMERCIAL-02: validación local — mismo mensaje que el
    // formulario principal para el mismo caso. No depende únicamente de
    // `type="tel"`/`type="email"` del navegador (que no validan formato EC
    // ni bloquean varios números).
    // ASISTENTE-COMERCIAL-06 (autorización explícita): el correo ya no es
    // opcional — vacío se trata como un caso de validación propio, con su
    // propio mensaje ("obligatorio"), distinto del de formato inválido.
    const resultadoTelefono = normalizarTelefonoEc(telefono);
    const emailTrim = email.trim();
    const emailVacio = emailTrim === '';
    const emailFormatoInvalido = !emailVacio && !EMAIL_REGEX.test(emailTrim);
    if (!resultadoTelefono.valido || emailVacio || emailFormatoInvalido) {
      // FORMULARIO-UX-08.1 (autorización explícita): "Al enviar: ejecutar nuevamente la
      // validación existente" — además, se marcan ambos campos como "tocados" para que el
      // indicador visual en línea se active aunque el usuario no haya salido de ningún campo.
      setTelefonoTocado(true);
      setEmailTocado(true);
    }
    if (!resultadoTelefono.valido) {
      setError('Ingresa un solo número de contacto válido de Ecuador.');
      return;
    }
    if (emailVacio) {
      setError('El correo electrónico es obligatorio.');
      return;
    }
    if (emailFormatoInvalido) {
      setError('Ingresa un correo electrónico válido.');
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono: resultadoTelefono.normalizado, email: emailTrim, fuente }),
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
  // ASISTENTE-COMERCIAL-06 (autorización explícita): el correo ya NO es opcional aquí — se
  // distingue "vacío" (mensaje de obligatoriedad) de "formato inválido" (mensaje de formato),
  // igual que exige el bloque. Mismo patrón de "tocado" que el teléfono.
  const telefonoVacio = telefono.trim() === '';
  const telefonoEsValido = !telefonoVacio && normalizarTelefonoEc(telefono).valido;
  const telefonoEsInvalido = telefonoTocado && !telefonoVacio && !telefonoEsValido;
  const telefonoMostrarValido = telefonoTocado && telefonoEsValido;

  const emailVacio = email.trim() === '';
  const emailEsValido = !emailVacio && EMAIL_REGEX.test(email.trim());
  const emailFaltaObligatorio = emailTocado && emailVacio;
  const emailEsInvalido = emailTocado && !emailVacio && !emailEsValido;
  const emailMostrarValido = emailTocado && emailEsValido;

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
            className="w-full text-left px-4 py-3 bg-surface-container-high hover:bg-outline/40 border border-outline transition-colors font-code-sm text-sm"
          >
            1. SOLICITAR COTIZACIÓN
          </button>
          <button
            type="button"
            onClick={() => setPaso('servicio')}
            className="w-full text-left px-4 py-3 bg-surface-container-high hover:bg-outline/40 border border-outline transition-colors font-code-sm text-sm"
          >
            2. CONSULTAR UN SERVICIO
          </button>
          <button
            type="button"
            onClick={() => setPaso('asesor')}
            className="w-full text-left px-4 py-3 bg-primary-container text-on-primary-container hover:bg-primary-fixed-dim transition-colors font-code-sm text-sm"
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
            className="px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-xs uppercase hover:bg-primary-fixed-dim transition-colors cursor-pointer"
          >
            SOLICITAR COTIZACIÓN
          </button>
          <button
            type="button"
            onClick={() => setPaso('asesor')}
            className="px-4 py-2 border border-outline text-on-surface font-label-caps text-xs uppercase hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            HABLAR CON UN ASESOR
          </button>
          <button
            type="button"
            onClick={() => setPaso('menu')}
            className="px-4 py-2 text-on-surface-variant font-label-caps text-xs uppercase hover:text-on-surface transition-colors cursor-pointer"
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
          Gracias, {nombre || 'recibimos tu mensaje'}. Recibimos tu mensaje. En breve, un asesor comercial se pondrá en contacto contigo para responder tus consultas y ayudarte con tu requerimiento.
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
      <p className="font-body-md text-sm text-on-surface-variant">
        Déjenos sus datos y un asesor comercial le contactará.
      </p>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          type="text"
        />
      </div>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">Teléfono / WhatsApp</label>
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          onBlur={() => setTelefonoTocado(true)}
          required
          maxLength={20}
          aria-invalid={telefonoEsInvalido}
          aria-describedby="asesor-telefono-ayuda"
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
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
          className={`font-code-sm text-[10px] mt-1 flex items-center gap-1 ${
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
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">Correo electrónico *</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTocado(true)}
          required
          aria-invalid={emailEsInvalido || emailFaltaObligatorio}
          aria-describedby="asesor-email-ayuda"
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          placeholder="Ej. nombre@empresa.com"
          type="email"
        />
        {/* ASISTENTE-COMERCIAL-06 (autorización explícita): correo ahora OBLIGATORIO — se
            distingue "vacío tras tocar" (mensaje de obligatoriedad) de "formato inválido"
            (mensaje de formato), sin mezclarlos. Mientras se escribe (no tocado) o válido, se
            conserva el texto de ayuda/confirmación ya existente. */}
        <p
          id="asesor-email-ayuda"
          aria-live="polite"
          className={`font-code-sm text-[10px] mt-1 flex items-center gap-1 ${
            emailEsInvalido || emailFaltaObligatorio
              ? 'text-error'
              : emailMostrarValido
                ? 'text-primary-container'
                : 'text-on-surface-variant'
          }`}
        >
          {emailMostrarValido && (
            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">check_circle</span>
          )}
          {emailFaltaObligatorio ? 'El correo electrónico es obligatorio.' : 'Ingresa un correo electrónico válido.'}
        </p>
      </div>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">¿Cómo nos encontró?</label>
        <select
          value={fuente}
          onChange={(e) => setFuente(e.target.value)}
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none cursor-pointer"
        >
          {FUENTES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="font-code-sm text-xs text-error uppercase">{error}</p>}

      <div className="flex gap-3">
        <button
          disabled={enviando}
          type="submit"
          className="px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-xs uppercase hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
        >
          {enviando ? 'ENVIANDO...' : 'ENVIAR'}
        </button>
        <button
          type="button"
          onClick={() => setPaso('menu')}
          className="px-4 py-2 text-on-surface-variant font-label-caps text-xs uppercase hover:text-on-surface transition-colors cursor-pointer"
        >
          VOLVER
        </button>
      </div>
    </form>
  );
}
