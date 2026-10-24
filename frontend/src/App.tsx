/**
 * NEXTPROJECT - CENTRO DE MECANIZADO INDUSTRIAL
 * Implementación fiel y exacta del prototipo Stitch
 */

import React, { useState, useRef, useEffect } from 'react';
import AsistenteComercial from './pages/AsistenteComercial';
import { API_BASE } from './lib/authClient';
import {
  NEXT_PROJECT_NAME,
  NEXT_PROJECT_UBICACION_TEXTO,
  construirEnlaceWhatsApp,
  construirMapaUbicacion,
} from './lib/config';
import piezasMecanizadasImg from './assets/images/piezas_mecanizadas_1788228769715.jpg';
import tornoGalleryImg from './assets/images/torno_industrial_gallery_1788229002934.jpg';
import fabricacionGalleryImg from './assets/images/fabricacion_gallery_1788229017518.jpg';
// MEJORA-UX-HERO-GIF-01 (autorización explícita): GIF animado aprobado del torno industrial,
// provisto por el usuario (verificado reproduciendo correctamente en Antigravity) — copiado
// byte a byte al proyecto (hash SHA-256 verificado idéntico al archivo subido), mismo mecanismo
// de import ya usado para el resto de imágenes locales (Vite sirve .gif como asset estático sin
// configuración adicional). Nunca se generó ni se convirtió ningún recurso nuevo.
import tornoIndustrialHeroGif from './assets/images/torno_industrial_hero.gif';

interface AppProps {
  onAcceso: () => void;
}

// Íconos de redes sociales: SVG inline (sin dependencias nuevas ni CDN externo,
// currentColor para heredar el color del sitio) — no Material Symbols porque
// ese set no incluye logos de marca.
type IconoProps = { className?: string };

function IconoFacebook({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M13.5 21v-7.5h2.5l.5-3h-3V8.5c0-.87.24-1.46 1.49-1.46H16.5V4.36C16.24 4.32 15.36 4.25 14.33 4.25c-2.15 0-3.62 1.31-3.62 3.72V10.5H8.19v3h2.52V21h2.79Z" />
    </svg>
  );
}

function IconoInstagram({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconoLinkedIn({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6.94 8.5H4V20h2.94V8.5ZM5.47 4a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM20 13.34c0-3.07-1.64-4.5-3.83-4.5-1.77 0-2.56.97-3 1.65V8.5H10.2c.04.86 0 11.5 0 11.5h2.97v-6.42c0-.34.02-.69.13-.94.28-.69.9-1.4 1.96-1.4 1.38 0 1.94 1.05 1.94 2.59V20H20v-6.66Z" />
    </svg>
  );
}

function IconoYouTube({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21.6 7.2s-.2-1.44-.82-2.07c-.79-.83-1.67-.83-2.07-.88C15.9 4 12 4 12 4h-.01s-3.89 0-6.7.25c-.4.05-1.28.05-2.07.88-.62.63-.82 2.07-.82 2.07S2.2 8.9 2.2 10.6v1.8c0 1.7.2 3.4.2 3.4s.2 1.44.82 2.07c.79.83 1.82.8 2.28.89 1.65.16 7 .25 7 .25s3.9-.01 6.71-.26c.4-.05 1.28-.05 2.07-.88.62-.63.82-2.07.82-2.07s.2-1.7.2-3.4v-1.8c0-1.7-.2-3.4-.2-3.4ZM9.96 14.5v-5l4.8 2.51-4.8 2.49Z" />
    </svg>
  );
}

function IconoTikTok({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.6 5.2c.6 1.02 1.6 1.78 2.8 2.02v2.55a5.86 5.86 0 0 1-2.8-.77v5.5a4.9 4.9 0 1 1-4.9-4.9c.17 0 .34 0 .5.03v2.6a2.3 2.3 0 1 0 1.9 2.27V3h2.5c0 .77.03 1.5 0 2.2Z" />
    </svg>
  );
}

// CORRECCIÓN FINAL — ICONO WHATSAPP REAL (autorización explícita): mismo patrón que los íconos de
// redes sociales de arriba (SVG inline, sin dependencia nueva — verificado antes: `lucide-react`
// ya está en package.json pero sin uso en todo el proyecto y sin ícono de WhatsApp disponible;
// Material Symbols tampoco incluye logos de marca, igual que ya documentaba el comentario
// original de esta sección). Glifo estándar del logotipo de WhatsApp (auricular dentro del globo
// de diálogo), `fill="currentColor"` para heredar el color (blanco) que le da el botón contenedor.
function IconoWhatsApp({ className }: IconoProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2c-5.52 0-10 4.48-10 10 0 1.76.46 3.48 1.34 5L2 22l5.17-1.36a9.96 9.96 0 0 0 4.87 1.24h.01c5.52 0 10-4.48 10-10s-4.48-9.88-10.01-9.88Zm0 18.12h-.01a8.3 8.3 0 0 1-4.24-1.16l-.3-.18-3.07.8.82-3-.2-.31a8.27 8.27 0 0 1-1.27-4.43c0-4.58 3.73-8.3 8.31-8.3 2.22 0 4.3.87 5.87 2.44a8.24 8.24 0 0 1 2.43 5.86c0 4.58-3.73 8.3-8.34 8.3Zm4.55-6.22c-.25-.13-1.47-.73-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.78.98-.14.17-.29.19-.54.06-.25-.13-1.04-.38-1.99-1.23-.74-.66-1.23-1.46-1.38-1.71-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.42-.14 0-.31-.02-.47-.02-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.6.13.17 1.77 2.7 4.28 3.79.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  );
}

// [TEMPORAL] Ninguna cuenta oficial de NextProject/Centro de Mecanizado está
// configurada todavía en el proyecto (verificado en env.ts, .env y en todo el
// frontend). Por indicación explícita del usuario, mientras tanto se usan los
// enlaces generales oficiales de cada plataforma (no representan la cuenta de
// la empresa). Para migrar a las cuentas reales, basta con reemplazar el
// `href` de la red correspondiente aquí abajo — el resto del componente
// (composición, tamaños, colores, target/rel) no necesita ningún cambio.
const SOCIAL_LINKS: { nombre: string; href: string | null; Icono: (props: IconoProps) => React.JSX.Element }[] = [
  { nombre: 'Facebook', href: 'https://www.facebook.com/', Icono: IconoFacebook },
  { nombre: 'Instagram', href: 'https://www.instagram.com/', Icono: IconoInstagram },
  { nombre: 'LinkedIn', href: 'https://www.linkedin.com/', Icono: IconoLinkedIn },
  { nombre: 'YouTube', href: 'https://www.youtube.com/', Icono: IconoYouTube },
  { nombre: 'TikTok', href: 'https://www.tiktok.com/', Icono: IconoTikTok },
];

// FORMULARIO-01: validación/normalización de teléfono ecuatoriano en el
// frontend — misma regla que `normalizarTelefonoEc` en
// backend/src/controllers/solicitudes.controller.ts (duplicada
// intencionalmente entre capas, mismo criterio ya usado en todo el proyecto
// para constantes de validación simples, ej. TRANSICIONES de estado).
// Nunca reescribe lo que el usuario ve en el campo — solo valida y, al
// enviar, calcula el valor normalizado que viaja al backend.
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

// FORMULARIO-UX-08.1 (autorización explícita): mismo regex que ya usaba
// validarFormularioLocal (antes escrito en línea) y que AsistenteComercial.tsx
// ya tenía como constante — se nombra aquí para reutilizarla también en la
// validación visual en tiempo real (onBlur), sin duplicar el patrón una
// tercera vez dentro de este mismo archivo.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fechaHoyIso(): string {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
}

type EstadoEnvio = 'idle' | 'enviando' | 'enviado' | 'error';

export default function App({ onAcceso }: AppProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('inicio');

  // RESTAURACIÓN + CORRECCIÓN WHATSAPP — 03 (autorización explícita): WhatsApp flotante — un
  // único elemento DOM que NUNCA cambia de `position` (siempre `fixed`, siempre en coordenadas de
  // viewport). Las versiones anteriores (CAMBIO-CTA-02/02.2, 02B, 02C, 02D) alternaban entre
  // `absolute` (dentro del HERO) y `fixed` (viewport) y necesitaban "puentear" la posición cada vez
  // que cambiaba el marco de referencia (técnica FLIP, con rampas y `requestAnimationFrame`) — ese
  // puente fue la causa raíz de los saltos, desapariciones y sobrepasos detectados en
  // AUDITORÍA-WHATSAPP-FLUJO-04 y AUDITORÍA VISUAL-WHATSAPP-05.
  //
  // Solución (sin FLIP, sin rampas, sin transición de `bottom`, sin estados temporales): el botón
  // permanece SIEMPRE `position: fixed`, en su posición flotante normal (`margenReposo()`, 16px /
  // 24px desde el borde inferior real del viewport — igual que las clases `bottom-4 sm:bottom-6`
  // de siempre), salvo cuando CONTACTO (el borde inferior real de `<section id="contacto">`) se
  // acerca al final de la página — en ese caso se sube lo justo para no sobrepasarlo (idéntica
  // fórmula, sin cambios, a la ya aprobada en CAMBIO-CTA-02.2).
  //
  // RESTAURACIÓN VISUAL WHATSAPP — 04 (autorización explícita): al cargar la página, el botón
  // debe verse integrado en la esquina inferior derecha del HERO, como en las versiones previas a
  // este bloque — "desvanecido" suavemente hacia la posición fija apenas se empieza a hacer
  // scroll. Esto se agrega como un término ADICIONAL, puramente aditivo (vía `Math.max`, igual que
  // el de CONTACTO) — no reemplaza ni modifica nada de lo anterior. A diferencia del intento
  // descartado en el bloque 03 (que perseguía al HERO sin límite mientras se seguía bajando y por
  // eso no podía converger sin una transición), este término es una interpolación puramente
  // ESPACIAL (función de `scrollY`, nunca de tiempo — sin `transition`, sin `requestAnimationFrame`
  // propio, sin capa nueva): se calcula a partir de una sola lectura, tomada una única vez al
  // montar (antes de que el usuario haga ningún scroll), de dónde está el borde inferior del HERO
  // en el DOCUMENTO (`heroBottomDocumento` — un número fijo, el HERO no cambia de tamaño, nunca se
  // vuelve a leer). Ese "extra" se desvanece linealmente a 0 en los primeros
  // `DISTANCIA_DESVANECIMIENTO` píxeles de scroll y queda en 0 para siempre después — acotado por
  // construcción (nunca puede crecer, solo decrecer desde un valor fijo), así que no hay riesgo de
  // que el botón termine fuera de pantalla como en el intento descartado. Como ya se recalcula en
  // cada frame de scroll (igual que el resto de esta fórmula), se ve tan fluido como el propio
  // scroll del usuario — es la "transición visual natural" pedida, sin necesidad de ninguna rampa
  // de tiempo ni de reintroducir el puente FLIP de 02D.
  const [bottomWhatsApp, setBottomWhatsApp] = useState(16);

  useEffect(() => {
    let frameId: number | null = null;

    // Mismo breakpoint (640px = `sm:` de Tailwind) y mismos valores (16px/24px) que ya usaban las
    // clases `bottom-4 sm:bottom-6` — no se inventa un margen nuevo.
    function margenReposo(): number {
      return window.innerWidth >= 640 ? 24 : 16;
    }

    // Foto única del borde inferior del HERO en el documento, tomada antes de cualquier scroll del
    // usuario. `getBoundingClientRect().bottom` es relativo al viewport ACTUAL; sumarle `scrollY`
    // lo vuelve una coordenada de documento (constante, independiente del scroll futuro).
    const heroAlMontar = document.getElementById('inicio');
    const heroBottomDocumento = heroAlMontar
      ? heroAlMontar.getBoundingClientRect().bottom + window.scrollY
      : null;
    const DISTANCIA_DESVANECIMIENTO = 100;

    function calcular() {
      frameId = null;
      const margen = margenReposo();
      let bottom = margen;

      if (heroBottomDocumento != null) {
        const extraAlCargar = window.innerHeight - heroBottomDocumento;
        const fraccion = Math.max(0, 1 - window.scrollY / DISTANCIA_DESVANECIMIENTO);
        bottom = Math.max(bottom, margen + extraAlCargar * fraccion);
      }

      // Idéntica fórmula a CAMBIO-CTA-02.2, sin cambios: sube lo justo para no sobrepasar el
      // borde inferior real de CONTACTO, nunca más de lo necesario.
      const contacto = document.getElementById('contacto');
      if (contacto) {
        const terminoContacto = window.innerHeight - contacto.getBoundingClientRect().bottom + margen;
        bottom = Math.max(bottom, terminoContacto);
      }

      setBottomWhatsApp(bottom);
    }

    function solicitarCalculo() {
      if (frameId == null) frameId = window.requestAnimationFrame(calcular);
    }

    calcular();
    window.addEventListener('scroll', solicitarCalculo, { passive: true });
    window.addEventListener('resize', solicitarCalculo);
    return () => {
      window.removeEventListener('scroll', solicitarCalculo);
      window.removeEventListener('resize', solicitarCalculo);
      if (frameId != null) window.cancelAnimationFrame(frameId);
    };
  }, []);

  // Form State
  const [formData, setFormData] = useState({
    nombre: '',
    empresa: '',
    telefono: '',
    email: '',
    servicio: '',
    descripcion: '',
    cantidad: '',
    fecha: '',
  });
  const [cantidadDesconocida, setCantidadDesconocida] = useState(false);
  const [consentimiento, setConsentimiento] = useState(false);

  // FORMULARIO-UX-08.1 (autorización explícita): "tocado" = el usuario ya salió del campo
  // (onBlur) al menos una vez, o ya intentó enviar el formulario. Antes de eso, el campo se
  // mantiene neutro (nunca error prematuro). La validez en sí NUNCA se guarda en un estado
  // aparte — se recalcula en cada render a partir de formData.telefono/email (ver más abajo),
  // así que corregir un error se refleja de inmediato, sin esperar un nuevo blur ni un envío.
  const [telefonoTocado, setTelefonoTocado] = useState(false);
  const [emailTocado, setEmailTocado] = useState(false);

  const [estadoEnvio, setEstadoEnvio] = useState<EstadoEnvio>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [codigoSolicitud, setCodigoSolicitud] = useState<string | null>(null);
  const [modalType, setModalType] = useState<
    'terminos' | 'privacidad' | 'galeria' | 'asistente_ia' | 'asistente_comercial' | null
  >(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSugerencia, setAiSugerencia] = useState<string | null>(null);
  // FORMULARIO-01.1 (NexIA híbrido): 'IA' cuando Gemini respondió realmente; 'ESTANDAR' cuando se
  // usó el respaldo determinístico del backend (Gemini no disponible/falló/timeout). Se muestra
  // honestamente al visitante — nunca se presenta el respaldo como si fuera una respuesta de IA.
  const [aiModo, setAiModo] = useState<'IA' | 'ESTANDAR' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // FORMULARIO-UX-07.1 (autorización explícita — hallazgo de la auditoría FORMULARIO-UX-07):
    // al cambiar de servicio, se limpia únicamente el texto que el usuario haya escrito en NEXIA
    // sin haber consultado todavía — nunca debe quedar visible una consulta redactada para un
    // servicio distinto al que ahora está seleccionado. `aiSugerencia`/`aiModo`/`aiError` no hace
    // falta tocarlos aquí: el modal cubre toda la pantalla, así que el <select> de servicio es
    // físicamente inalcanzable mientras el modal está abierto (solo puede cambiarse con el modal
    // ya cerrado, momento en el que esos 3 estados ya quedaron en null por el botón de cierre).
    // No se toca resolverContexto/SERVICIO_A_CONTEXTO ni el backend — esto es únicamente estado
    // local del formulario público.
    if (name === 'servicio') {
      setAiPrompt('');
    }
  };

  const handleSelectServiceFromCard = (serviceName: string) => {
    setFormData((prev) => ({ ...prev, servicio: serviceName }));
    setAiPrompt('');
    const target = document.getElementById('cotizacion');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Validación 100% local, antes de tocar la red — feedback inmediato y
  // evita una llamada al backend para un dato que ya sabemos inválido.
  // El backend vuelve a validar exactamente lo mismo (defensa en
  // profundidad, nunca confía solo en esta comprobación de UI).
  function validarFormularioLocal(): string | null {
    if (!formData.nombre.trim()) return 'El nombre completo es requerido.';
    if (!normalizarTelefonoEc(formData.telefono).valido) {
      // FORMULARIO-UX-06.1 (autorización explícita — auditoría previa "AUDITORÍA
      // FORMULARIO — PENDIENTES UX-06"): mensaje comprensible en vez del genérico
      // anterior — cubre tanto un formato inválido como el intento de escribir más
      // de un número (ambos casos fallan el mismo regex de un único número EC).
      return 'Ingresa un solo número de contacto válido de Ecuador.';
    }
    if (!formData.email.trim() || !EMAIL_REGEX.test(formData.email.trim())) {
      return 'El correo electrónico no es válido.';
    }
    if (!formData.servicio) return 'Selecciona un tipo de servicio.';
    if (!formData.descripcion.trim()) return 'Cuéntanos tu necesidad en la descripción.';
    if (!cantidadDesconocida) {
      const cantidadNum = Number(formData.cantidad);
      if (!formData.cantidad || !Number.isInteger(cantidadNum) || cantidadNum <= 0) {
        // FORMULARIO-UX-07.1 (autorización explícita — hallazgo de la auditoría FORMULARIO-UX-07):
        // el checkbox se renombró en FORMULARIO-UX-06.2 a "Todavía no conozco la cantidad"; este
        // mensaje seguía citando el texto viejo ("Aún no lo sé").
        return 'Indica una cantidad válida o selecciona "Todavía no conozco la cantidad".';
      }
    }
    if (formData.fecha && formData.fecha < fechaHoyIso()) {
      return 'La fecha requerida no puede ser una fecha pasada.';
    }
    if (!consentimiento) {
      return 'Debes aceptar el tratamiento de tus datos personales para continuar.';
    }
    return null;
  }

  // FORMULARIO-01 (prueba C — doble clic): el estado `disabled` del botón depende de un
  // re-render de React, que no es instantáneo dentro del mismo ciclo síncrono de eventos —
  // dos clics disparados prácticamente a la vez podrían ejecutar handleFormSubmit dos veces
  // antes de que React llegue a deshabilitar el botón en el DOM. Este ref es la guarda REAL
  // e inmediata (no depende de ningún render): se comprueba y se fija de forma síncrona al
  // entrar a la función, independiente del estado visual del botón.
  const enviandoRef = useRef(false);

  // FORMULARIO-UX-07.1 (autorización explícita — hallazgo de la auditoría FORMULARIO-UX-07):
  // referencia al textarea de descripción, usada únicamente para devolver el foco allí (con el
  // cursor al final) justo después de "APLICAR AL FORMULARIO" — ver el botón más abajo.
  const descripcionRef = useRef<HTMLTextAreaElement>(null);

  // SOLICITUD-RECUPERACION-01A (autorización explícita — Bloque B/H): identifica la OPERACIÓN
  // DE ENVÍO, no los datos del formulario — se genera una sola vez por operación y se reutiliza
  // en cada reintento de esa MISMA operación (error de red, doble clic, pérdida de respuesta).
  // `null` significa "sin operación en curso todavía"; se genera perezosamente en el primer
  // intento real de envío, nunca en cada render. Solo se limpia (nueva clave en el próximo envío)
  // cuando el usuario inicia una solicitud intencionalmente nueva (handleNuevaSolicitud) — nunca
  // simplemente porque hubo un error.
  const idempotencyKeyRef = useRef<string | null>(null);
  function obtenerIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    return idempotencyKeyRef.current;
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (enviandoRef.current) {
      return;
    }

    const errorLocal = validarFormularioLocal();
    if (errorLocal) {
      // FORMULARIO-UX-08.1 (autorización explícita): "Al enviar: ejecutar nuevamente la
      // validación existente" — además de eso, se marcan ambos campos como "tocados" para que
      // el indicador visual en línea (bajo cada campo) también se active, incluso si el usuario
      // nunca llegó a salir de alguno de los dos con el teclado/mouse (ej. autocompletado).
      setTelefonoTocado(true);
      setEmailTocado(true);
      setSubmitError(errorLocal);
      setEstadoEnvio('error');
      return;
    }

    enviandoRef.current = true;
    setSubmitError(null);
    setEstadoEnvio('enviando');

    try {
      const telefonoNormalizado = normalizarTelefonoEc(formData.telefono).normalizado;
      const response = await fetch(`${API_BASE}/api/solicitudes`, {
        method: 'POST',
        // SOLICITUD-RECUPERACION-01A (autorización explícita — Bloque B/H): misma clave en
        // cada reintento de esta operación — `obtenerIdempotencyKey()` nunca genera una nueva
        // mientras `idempotencyKeyRef.current` siga teniendo valor (solo handleNuevaSolicitud lo
        // limpia). El backend garantiza "misma clave -> misma solicitud" (ver informe).
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': obtenerIdempotencyKey() },
        body: JSON.stringify({
          nombre: formData.nombre,
          empresa: formData.empresa || undefined,
          email: formData.email,
          telefono: telefonoNormalizado,
          servicio: formData.servicio,
          descripcion: formData.descripcion,
          cantidad: cantidadDesconocida ? undefined : Number(formData.cantidad),
          cantidad_desconocida: cantidadDesconocida,
          fecha_requerida: formData.fecha || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || 'No se pudo registrar la solicitud. Intente nuevamente.');
      }

      const data = (await response.json()) as { solicitud?: { codigo?: string | null } };
      const codigo = data.solicitud?.codigo ?? null;
      setCodigoSolicitud(codigo);
      setEstadoEnvio('enviado');

      // SOLICITUD-RECUPERACION-01A (autorización explícita — Bloque I): referencia mínima de
      // apoyo (nunca fuente de verdad — la BD lo sigue siendo). Solo código + fecha, nada
      // sensible (sin descripción, documentos, tokens ni datos internos). `try/catch` porque
      // localStorage puede fallar (modo privado, cuota agotada, etc.) y eso nunca debe romper
      // el flujo de éxito ya confirmado por el backend.
      if (codigo) {
        try {
          localStorage.setItem(
            'nextproject_ultima_solicitud',
            JSON.stringify({ codigo, fecha: new Date().toISOString() })
          );
        } catch {
          // Persistencia local es solo un apoyo — su fallo no afecta el éxito ya confirmado.
        }
      }
    } catch (error) {
      // Los datos ingresados NUNCA se borran ante un error (formData no se toca aquí).
      setSubmitError(
        error instanceof Error ? error.message : 'No se pudo registrar la solicitud. Intente nuevamente.'
      );
      setEstadoEnvio('error');
    } finally {
      enviandoRef.current = false;
    }
  };

  function handleNuevaSolicitud() {
    // SOLICITUD-RECUPERACION-01A (autorización explícita — Bloque H): esta es la única forma
    // válida de empezar una NUEVA operación de envío — a partir de aquí, el próximo
    // `obtenerIdempotencyKey()` genera una clave distinta (un error de red NUNCA llega aquí).
    idempotencyKeyRef.current = null;
    setEstadoEnvio('idle');
    setSubmitError(null);
    setCodigoSolicitud(null);
    setFormData({
      nombre: '',
      empresa: '',
      telefono: '',
      email: '',
      servicio: '',
      descripcion: '',
      cantidad: '',
      fecha: '',
    });
    setCantidadDesconocida(false);
    setConsentimiento(false);
    // FORMULARIO-UX-08.1: una solicitud nueva empieza con los indicadores visuales en blanco,
    // igual que los campos que acompañan.
    setTelefonoTocado(false);
    setEmailTocado(false);
  }

  // FORMULARIO-UX-08.1 (autorización explícita): validez derivada en cada render — nunca un
  // estado aparte que pueda quedar desactualizado. "Vacío" es su propio caso (nunca cuenta como
  // inválido): un campo requerido vacío ya lo cubre el mensaje de envío (validarFormularioLocal/
  // submitError); el indicador en línea solo distingue "correcto" de "formato roto" cuando hay
  // contenido real.
  const telefonoVacio = formData.telefono.trim() === '';
  const telefonoEsValido = !telefonoVacio && normalizarTelefonoEc(formData.telefono).valido;
  const telefonoEsInvalido = telefonoTocado && !telefonoVacio && !telefonoEsValido;
  const telefonoMostrarValido = telefonoTocado && telefonoEsValido;

  const emailVacio = formData.email.trim() === '';
  const emailEsValido = !emailVacio && EMAIL_REGEX.test(formData.email.trim());
  const emailEsInvalido = emailTocado && !emailVacio && !emailEsValido;
  const emailMostrarValido = emailTocado && emailEsValido;

  const navLinks = [
    { name: 'INICIO', href: '#inicio', id: 'inicio' },
    { name: 'NOSOTROS', href: '#nosotros', id: 'nosotros' },
    { name: 'SERVICIOS', href: '#servicios', id: 'servicios' },
    { name: 'PROCESO', href: '#proceso', id: 'proceso' },
    { name: 'TRABAJOS', href: '#trabajos', id: 'trabajos' },
    { name: 'COTIZACIÓN', href: '#cotizacion', id: 'cotizacion' },
    { name: 'CONTACTO', href: '#contacto', id: 'contacto' },
  ];

  return (
    <div className="bg-background text-on-surface font-body-md antialiased selection:bg-primary-container selection:text-on-primary-container min-h-screen">
      {/* 1. HEADER (TopNavBar Shared Component adapted) */}
      <header className="bg-background dark:bg-background border-b border-surface-container-highest docked full-width top-0 sticky z-50">
        <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
          {/* Brand */}
          <a
            className="font-headline-lg-responsive font-black text-on-surface uppercase tracking-tighter flex items-center"
            href="#inicio"
            onClick={() => setActiveNav('inicio')}
          >
            <span>NEXT</span>
            <span className="text-primary-container">PROJECT</span>
          </a>

          {/* Navigation (Desktop) */}
          <nav className="hidden lg:flex items-center space-x-6">
            {navLinks.map((link) => (
              <a
                key={link.id}
                className={`font-['Inter'] text-[14px] font-semibold transition-colors ${activeNav === link.id
                  ? 'text-primary-container border-b-2 border-primary-container pb-1'
                  : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                href={link.href}
                onClick={() => setActiveNav(link.id)}
              >
                {link.name}
              </a>
            ))}
          </nav>

          {/* Trailing Action */}
          {/* CAMBIO-CTA-02 (autorización explícita): se elimina el CTA textual "COTIZAR POR
              WHATSAPP" — reemplazado por el icono flotante único (ver WhatsAppFlotante más abajo,
              dentro del HERO). "ACCESO" se conserva sin cambios. */}
          <div className="hidden md:flex items-center">
            <button
              type="button"
              onClick={onAcceso}
              className="inline-flex items-center justify-center px-3 py-2 text-on-surface-variant hover:text-on-surface transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined mr-1 text-[16px]">login</span>
              ACCESO
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="lg:hidden text-on-surface p-2 focus:outline-none"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menú principal"
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>

        {/* Mobile Navigation Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-surface border-b border-outline px-margin-mobile py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.id}
                className={`block font-['Inter'] text-[14px] font-semibold py-2 ${activeNav === link.id ? 'text-primary-container font-bold' : 'text-on-surface-variant'
                  }`}
                href={link.href}
                onClick={() => {
                  setActiveNav(link.id);
                  setMobileMenuOpen(false);
                }}
              >
                {link.name}
              </a>
            ))}
            {/* CAMBIO-CTA-02 (autorización explícita): mismo cambio que el header desktop — el CTA
                textual de WhatsApp se elimina (sustituido por el icono flotante único). */}
            <div className="pt-2 border-t border-outline space-y-3">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onAcceso();
                }}
                className="w-full inline-flex items-center justify-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">login</span>
                ACCESO
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 2. HERO */}
      <section
        className="relative w-full min-h-[80vh] flex items-center bg-background overflow-hidden border-b border-outline"
        id="inicio"
      >
        <div className="absolute inset-0 w-full h-full lg:w-1/2 lg:right-0 lg:left-auto opacity-30 lg:opacity-100 z-0">
          {/* MEJORA-UX-HERO-GIF-01 (autorización explícita): mismo contenedor/dimensiones/
              composición/clases de siempre — únicamente la fuente visual cambia. <picture> con
              <source media="(prefers-reduced-motion: reduce)"> es el mecanismo NATIVO del
              navegador (sin JS) para mostrar la foto estática cuando el usuario tiene activado
              "reducir movimiento" — el <img> normal reproduce el GIF animado. `onError` es el
              único JavaScript agregado (mínimo e indispensable, no una librería): si el GIF no
              llega a cargar por cualquier motivo, recupera automáticamente la misma fotografía
              que ya se usaba aquí (la URL original, sin generar ningún recurso nuevo). */}
          <picture>
            <source media="(prefers-reduced-motion: reduce)" srcSet="https://lh3.googleusercontent.com/aida-public/AB6AXuAxINyOYyKfP0ZUyKFcoPaAwjwKr1IClCcJmq_beVHrU-Se8gQIrv7VRk9GckQc-nMCcFvn5ib00VjaZvSVUXvHZFfs0-vZnf4pV4G9LbIJcV07UH-mDkOg_UV6_EZ1285UrFCNZzefSuKqpSZGn18tmyGnNokIylnqklviDBJNJiM77Pn0PzjT29VTdIuV1YVjPBRccgipPfkEQvBxQauoGSTijovTNCtCCoB-FY9GrjOeAOCVyBXS" />
            <img
              className="w-full h-full object-cover grayscale-[20%] sepia-[10%] brightness-75"
              data-alt="Professional high-quality photography of a large industrial lathe (torno industrial) machining a large metal component. Visible metal shavings (viruta), cutting tool, and sparks. Industrial workshop setting, dramatic lighting, dark background, technical precision. Real industrial machining process. No hand tools."
              src={tornoIndustrialHeroGif}
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src =
                  'https://lh3.googleusercontent.com/aida-public/AB6AXuAxINyOYyKfP0ZUyKFcoPaAwjwKr1IClCcJmq_beVHrU-Se8gQIrv7VRk9GckQc-nMCcFvn5ib00VjaZvSVUXvHZFfs0-vZnf4pV4G9LbIJcV07UH-mDkOg_UV6_EZ1285UrFCNZzefSuKqpSZGn18tmyGnNokIylnqklviDBJNJiM77Pn0PzjT29VTdIuV1YVjPBRccgipPfkEQvBxQauoGSTijovTNCtCCoB-FY9GrjOeAOCVyBXS';
              }}
              alt="Torno industrial de mecanizado de precisión"
            />
          </picture>
          {/* Fade gradient for text legibility on desktop */}
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent lg:w-1/3"></div>
        </div>
        <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 lg:py-0 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="flex flex-col justify-center pl-4 border-l-4 border-primary-container">
            <h1 className="font-display-lg-responsive font-black uppercase text-on-surface flex flex-col leading-none mb-6">
              <span>CENTRO DE</span>
              <span className="text-primary-container">MECANIZADO</span>
              <span>INDUSTRIAL</span>
            </h1>
            <h2 className="font-headline-md text-body-lg md:text-headline-md text-on-surface-variant font-semibold mb-4 uppercase">
              SOLUCIONES PARA LA INDUSTRIA
            </h2>
            <p className="font-body-lg text-body-md md:text-body-lg text-on-surface-variant mb-8 max-w-md">
              Fabricamos, reparamos y recuperamos componentes industriales a medida, según las necesidades técnicas de cada proyecto.            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                className="inline-flex items-center justify-center px-6 py-4 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors"
                href="#cotizacion"
                onClick={() => setActiveNav('cotizacion')}
              >
                <span className="material-symbols-outlined mr-2 text-[18px]">request_quote</span>
                SOLICITAR COTIZACIÓN
              </a>
              <a
                className="inline-flex items-center justify-center px-6 py-4 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold"
                href="#servicios"
                onClick={() => setActiveNav('servicios')}
              >
                VER SERVICIOS
                <span className="material-symbols-outlined ml-2 text-[18px]">arrow_forward</span>
              </a>
            </div>
          </div>
        </div>

        {/* RESTAURACIÓN + CORRECCIÓN WHATSAPP — 03 (autorización explícita): WhatsApp flotante —
            ÚNICO elemento (nunca duplicado), SIEMPRE `position: fixed` (ver el efecto más arriba
            que calcula `bottomWhatsApp`). z-40: por debajo del header/modal (z-50, escala ya
            existente) y por encima del contenido normal (z-10). Reutiliza EXCLUSIVAMENTE la
            configuración centralizada de frontend/src/lib/config.ts (NEXT_PROJECT_WHATSAPP vía
            construirEnlaceWhatsApp) — nunca se vuelve a escribir el número aquí. Mismo mensaje ya
            usado por el CTA textual que este botón reemplaza (sin cambiarlo). */}
        <a
          href={construirEnlaceWhatsApp('Hola NEXTPROJECT, deseo solicitar una cotización para un trabajo de mecanizado industrial.')}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Contactar por WhatsApp"
          title="Contactar por WhatsApp"
          // Sin transición de `bottom`: cada frame de scroll/resize ya calcula el valor correcto
          // (ver el efecto `calcular()` más arriba) — no hay un valor "previo" del que animar, así
          // que no hace falta (ni conviene) suavizarlo con CSS.
          style={{ bottom: `${bottomWhatsApp}px` }}
          // CORRECCIÓN FINAL — ICONO WHATSAPP REAL (autorización explícita): el fondo es el verde
          // característico de WhatsApp (#25D366), con el glifo en blanco. Tamaño, enlace,
          // accesibilidad: sin cambios.
          className="fixed right-4 sm:right-6 z-40 flex items-center justify-center w-[50px] h-[50px] sm:w-[56px] sm:h-[56px] rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#20bd5b] transition-[background-color] duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          <IconoWhatsApp className="w-[26px] h-[26px] sm:w-[28px] sm:h-[28px]" />
        </a>
      </section>

      {/* 3. INDUSTRIAL BAND / FRANJA INDUSTRIAL DE SEGURIDAD */}
      <div
        id="franja-seguridad-hero"
        className="w-full h-4 hazard-stripe bg-hazard-stripe block z-10 relative"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, #fabd00, #fabd00 10px, #000000 10px, #000000 20px)',
        }}
      ></div>

      {/* 4. QUIÉNES SOMOS */}
      <section className="w-full bg-surface py-[74px] border-b border-outline" id="nosotros">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="relative sharp-border p-2">
            <img
              alt="Professional high-quality photography of a large conventional industrial metal lathe in a workshop"
              className="w-full h-auto object-cover grayscale hover:grayscale-0 transition-all duration-500"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCJVxc1pANjAnJ16iDfWb64WvTbbcPO3taz5_8SNYB0tpbHrOTM0WxUT-jl_ZAV9monNgtt4MvE_ihxPCiNTdK__WS68nOoAyYO9TjYvPXL2KP67SLrpXi-ZgNEa-R1BxFGQ-1-9D1RVOLMO9sS8CjsWtWMgEQDAhOgm2yHvu-np2w9aTXE04Gp2UKq3sxo7hlLXPy76Gf00yqABzKdaWFS7P_ngQxN9KaKcR6gjORulioSARS6IeXO"
            />
            <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary-container text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                precision_manufacturing
              </span>
            </div>
          </div>
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-[2px] bg-primary-container mr-4"></div>
              <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase">Nosotros</h3>
            </div>
            <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase mb-6">
              QUIÉNES SOMOS
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-6">
              NEXTPROJECT es un centro de mecanizado industrial orientado a brindar soluciones de fabricación, reparación y mecanizado de componentes para empresas, contratistas y clientes que requieren trabajos bajo medidas, muestras o especificaciones técnicas.
            </p>
            <p className="font-body-md text-body-md text-on-surface-variant mb-8">
              Nuestro compromiso es ofrecer soluciones precisas y funcionales, adaptadas a las necesidades de cada proyecto, desde la fabricación de componentes hasta la recuperación de piezas para prolongar su vida útil.
            </p>
            <ul className="space-y-4 font-['Inter'] text-[13px] font-normal text-on-surface uppercase">
              <li className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[18px]">check_box</span>
                MECANIZADO CONVENCIONAL: Torno y fresado industrial
              </li>
              <li className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[18px]">check_box</span>
                FABRICACIÓN A MEDIDA: Piezas bajo plano o muestra
              </li>
              <li className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[18px]">check_box</span>
                CONTROL Y REVISIÓN: Verificación del trabajo realizado
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5. NUESTROS SERVICIOS (Cards) */}
      <section className="w-full bg-background py-[74px] border-b border-outline" id="servicios">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-12 border-l-4 border-primary-container pl-4">
            <div>
              <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-2">ESPECIALIDADES</h3>
              <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
                NUESTROS SERVICIOS
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">01</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  construction
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">TORNO INDUSTRIAL</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Mecanizado de componentes cilíndricos para ejes, bujes, bridas y piezas rotativas.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('TORNO INDUSTRIAL')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-['Inter'] text-[14px] font-semibold text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            {/* Card 2 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">02</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  settings_overscan
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">FRESADO INDUSTRIAL</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Mecanizado de superficies planas, ranuras, engranajes y perfiles complejos con tolerancias específicas.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('FRESADO INDUSTRIAL')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-['Inter'] text-[14px] font-semibold text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            {/* Card 3 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">03</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  precision_manufacturing
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">FABRICACIÓN</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Desarrollo y manufactura de piezas a medida a partir de planos, muestras o requerimientos específicos.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('FABRICACIÓN A MEDIDA')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-['Inter'] text-[14px] font-semibold text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>

            {/* Card 4 */}
            <div className="bg-surface sharp-border p-6 flex flex-col group hover:border-primary-container transition-colors">
              <div className="flex justify-between items-start mb-8 border-b border-outline pb-4">
                <span className="font-code-sm text-code-sm text-on-surface-variant">04</span>
                <span className="material-symbols-outlined text-primary-container text-3xl group-hover:scale-110 transition-transform">
                  build
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-4">REPARACIÓN Y RECUPERACIÓN</h4>
              <p className="font-body-md text-body-md text-on-surface-variant mb-8 flex-grow">
                Restauración de componentes desgastados o dañados, devolviéndolos a sus especificaciones operativas.
              </p>
              <button
                onClick={() => handleSelectServiceFromCard('REPARACIÓN Y RECUPERACIÓN')}
                className="inline-flex items-center justify-between w-full border border-outline px-4 py-2 font-['Inter'] text-[14px] font-semibold text-on-surface group-hover:bg-primary-container group-hover:text-on-primary-container group-hover:border-primary-container transition-all cursor-pointer text-left"
              >
                SOLICITAR COTIZACIÓN
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 6. SOLUCIONES PARA SUS NECESIDADES INDUSTRIALES */}
      <section className="w-full bg-surface py-[74px] border-b border-outline" id="soluciones">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="flex items-center mb-4">
              <div className="w-8 h-[2px] bg-primary-container mr-4"></div>
              <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase">APLICACIONES</h3>
            </div>
            <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase mb-6">
              SOLUCIONES PARA SUS NECESIDADES INDUSTRIALES
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mb-8">
              Atendemos requerimientos de fabricación, reposición y recuperación de componentes para diferentes aplicaciones industriales.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-['Inter'] text-[13px] font-normal text-on-surface uppercase">
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                REPUESTOS INDUSTRIALES
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                MANTENIMIENTO DE MAQUINARIA
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                COMPONENTES PARA EQUIPOS
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                PIEZAS BAJO PLANO O MUESTRA
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                RECUPERACIÓN DE COMPONENTES
              </div>
              <div className="flex items-center border-b border-outline pb-2">
                <span className="material-symbols-outlined text-primary-container mr-3 text-[18px]">check_box</span>
                SOLUCIONES ESPECIALES
              </div>
            </div>
          </div>
          <div className="relative sharp-border p-2">
            {/* MEJORA-UX-IMAGEN-APLICACIONES-01 (autorización explícita): misma fotografía,
                mismo grayscale(1)->grayscale(0) de siempre — se agrega únicamente, al hover,
                un leve realce de saturación/contraste/brillo (valores exactos del bloque:
                saturate(1.25) contrast(1.05) brightness(1.03)) para que el paso gris->color
                se perciba con claridad en esta foto de tonos metálicos de baja saturación, sin
                verse artificial. Único cambio de este bloque; ninguna otra imagen/sección se
                tocó (QUIÉNES SOMOS, HERO, TRABAJOS, etc. conservan exactamente su clase previa). */}
            <img
              alt="Piezas y componentes industriales mecanizados"
              className="w-full h-auto object-cover grayscale hover:grayscale-0 hover:saturate-[1.25] hover:contrast-[1.05] hover:brightness-[1.03] transition-all duration-500"
              src={piezasMecanizadasImg}
            />
          </div>
        </div>
      </section>

      {/* 7. SECTORES QUE ATENDEMOS */}
      <section className="w-full bg-background py-[74px] border-b border-outline" id="sectores">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="text-center mb-12">
            <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-2">ALCANCE</h3>
            <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
              SECTORES QUE ATENDEMOS
            </h2>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                factory
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">INDUSTRIA</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                engineering
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">MANTENIMIENTO INDUSTRIAL</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                precision_manufacturing
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">MAQUINARIA</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                construction
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">CONSTRUCCIÓN</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                agriculture
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">AGROINDUSTRIA</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                local_shipping
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">TRANSPORTE</span>
            </div>
            <div className="bg-surface sharp-border p-6 flex flex-col items-center justify-center text-center group hover:border-primary-container transition-colors w-full md:w-[calc(33.333%-1rem)] lg:w-[calc(25%-1rem)]">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4 group-hover:scale-110 transition-transform">
                handyman
              </span>
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface uppercase">CONTRATISTAS</span>
            </div>
          </div>
        </div>
      </section>

      {/* 8. NUESTRO PROCESO */}
      <section className="w-full bg-surface py-[74px] border-b border-outline" id="proceso">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="border-l-4 border-primary-container pl-4 mb-16">
            <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-2">METODOLOGÍA</h3>
            <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
              NUESTRO PROCESO
            </h2>
          </div>
          <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center space-y-8 md:space-y-0">
            {/* Horizontal line for desktop */}
            <div className="absolute left-0 right-0 top-6 h-[2px] bg-outline z-0 hidden md:block"></div>
            {/* Vertical line for mobile */}
            <div className="absolute left-6 top-0 bottom-0 w-[2px] bg-outline z-0 md:hidden block"></div>

            {/* Step 1 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-surface group-hover:scale-110 transition-transform">
                01
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">SOLICITUD</h4>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">Recepción del requerimiento</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                02
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">EVALUACIÓN</h4>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">Análisis técnico</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                03
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">COTIZACIÓN</h4>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">Propuesta comercial</p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                04
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">FABRICACIÓN</h4>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">Ejecución del trabajo</p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                05
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">CONTROL</h4>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">Revisión de calidad</p>
              </div>
            </div>

            {/* Step 6 */}
            <div className="relative z-10 flex flex-row md:flex-col items-center group">
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary-container flex items-center justify-center font-headline-md font-bold text-lg border-4 border-outline group-hover:border-primary-container transition-colors">
                06
              </div>
              <div className="ml-6 md:ml-0 md:mt-4 md:text-center">
                <h4 className="font-label-caps text-label-caps text-on-surface uppercase">ENTREGA</h4>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">Entrega del trabajo terminado</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. TRABAJOS REALIZADOS */}
      <section className="w-full bg-background py-[74px] border-b border-outline" id="trabajos">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-12 border-l-4 border-primary-container pl-4">
            <div>
              <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-2">GALERÍA</h3>
              <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
                TRABAJOS REALIZADOS
              </h2>
            </div>
            <div className="mt-6 md:mt-0">
              <a
                className="inline-flex items-center justify-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors"
                href="#cotizacion"
                onClick={() => setActiveNav('cotizacion')}
              >
                SOLICITAR COTIZACIÓN
              </a>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 01 - TORNO */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Torno industrial"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src={tornoGalleryImg}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  TORNO
                </h4>
              </div>
            </div>

            {/* 02 - FRESADO */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Fresado industrial"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGbni7SxU6HfhLwtUbc9PiI9SwSC5HnczCuf96vGHrsaNsvL8-ll_JZCS-jBVrau46yHhSCTFOeQY26blZzoSlih7eMKzcoJjVpol4eexW0Ks4CqrxITmxPGdaUGQKxstx6KkcA9XfXvSbfkIZNvAwihvCPSynh0TuI-3gGZtu7Ylt0qVGXDckO5msKreqr9wCZrzdaLsxAtE9gD3pPaJb8wPPRihJNS4ULPBtFPMtfjUr24VEXY5n"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  FRESADO
                </h4>
              </div>
            </div>

            {/* 03 - FABRICACIÓN */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Fabricación de piezas"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src={fabricacionGalleryImg}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  FABRICACIÓN
                </h4>
              </div>
            </div>

            {/* 04 - REPARACIÓN */}
            <div className="relative group overflow-hidden sharp-border">
              <img
                alt="Reparación"
                className="w-full h-72 object-cover grayscale group-hover:grayscale-0 transition-all duration-500 scale-100 group-hover:scale-105"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRCedTnyrRhfyXwCd0psVMyBFX20Ka8yTV4DaHIY6Jn_a7LF4C7GkI2GUyQwL_V9FT3Ib51efRwZcOk-Gf11HWzjV3ac6jXvGCdCshatdKtMEv6Jx1wTv__-nW4L0PK6z0PwgWPJKivX-JHbdShSVnFeP_J-5-NF6vlQohmNjkipiXehYt9MUC1wQpwBFQOujw0a5dRrJ6C4tHbvh300WDSgVffaAoDxozsHmEZUEwElVIC7jwlDk0"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-80"></div>
              <div className="absolute bottom-4 left-4">
                <h4 className="font-headline-md text-headline-md text-on-surface uppercase font-bold">
                  REPARACIÓN
                </h4>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 10. ¿POR QUÉ NEXTPROJECT? */}
      <section className="w-full bg-surface py-[74px] border-b border-outline" id="por-que">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="text-center mb-12">
            <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-2">VENTAJAS</h3>
            <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
              ¿POR QUÉ NEXTPROJECT?
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">straighten</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">PRECISIÓN</h4>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">En cada detalle</p>
            </div>
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">verified</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">CALIDAD</h4>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">En cada trabajo</p>
            </div>
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">handshake</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">COMPROMISO</h4>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Con cada proyecto</p>
            </div>
            <div className="bg-background sharp-border p-8 text-center border-t-4 border-t-primary-container">
              <span className="material-symbols-outlined text-primary-container text-4xl mb-4">shield</span>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase mb-2">CONFIANZA</h4>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">En nuestra relación con el cliente</p>
            </div>
          </div>
        </div>
      </section>

      {/* 11. SOLICITAR COTIZACIÓN */}
      <section className="w-full bg-background border-b border-outline">
        {/* CABECERA: banda amplia con la imagen de mecanizado integrada al fondo (mismo
            recurso que la propia HERO section: imagen absoluta + degradado hacia
            bg-background) — a propósito NO es una tarjeta con borde. */}
        <div className="relative overflow-hidden border-b border-outline">
          <div className="absolute inset-0 w-full h-full lg:w-1/2 lg:right-0 lg:left-auto opacity-20 lg:opacity-100">
            <img
              src={tornoGalleryImg}
              alt="Mecanizado industrial de precisión en torno convencional"
              className="w-full h-full object-cover grayscale-[15%] brightness-75"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent lg:w-2/3"></div>
          </div>

          <div className="relative z-10 max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16 md:py-[74px]">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <div className="border-l-4 border-primary-container pl-4 mb-4">
                  <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-1">
                    CONTACTO COMERCIAL
                  </h3>
                  <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
                    CONECTA CON NEXTPROJECT
                  </h2>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant max-w-lg mb-8">
                  Cuéntanos qué necesitas y nuestro equipo evaluará tu requerimiento. No necesitas conocer todos los
                  detalles técnicos.
                </p>

                <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                  {/* Ver servicios — visible y con presencia real, mismo estilo del hero, más grande */}
                  <a
                    className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-5 border-2 border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold"
                    href="#servicios"
                    onClick={() => setActiveNav('servicios')}
                  >
                    <span className="material-symbols-outlined mr-2 text-[20px]">apps</span>
                    VER SERVICIOS
                    <span className="material-symbols-outlined ml-2 text-[20px]">arrow_forward</span>
                  </a>

                  <div>
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mb-2">
                      Encuéntranos en
                    </p>
                    {/* [TEMPORAL] Los 5 enlazan hoy a la plataforma general (ver SOCIAL_LINKS
                        arriba) mientras no exista la cuenta oficial de NextProject. La rama
                        <span> de abajo queda para cuando algún href vuelva a ser null. */}
                    <div className="flex items-center gap-3">
                      {SOCIAL_LINKS.map((red) =>
                        red.href ? (
                          <a
                            key={red.nombre}
                            href={red.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={red.nombre}
                            className="w-11 h-11 flex items-center justify-center border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors"
                          >
                            <red.Icono className="w-5 h-5" />
                          </a>
                        ) : (
                          <span
                            key={red.nombre}
                            aria-label={red.nombre}
                            className="w-11 h-11 flex items-center justify-center border border-primary-container text-primary-container"
                          >
                            <red.Icono className="w-5 h-5" />
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-16">
          {/* 3. Formulario — camino principal, único bloque grande de la pantalla.
              id="cotizacion" vive aquí (no en el <section> exterior, que arranca con el
              banner de imagen) para que los enlaces/scrolls "COTIZACIÓN" lleven directo al
              formulario real, no a la imagen. scroll-mt-20 reproduce el mismo offset de 80px
              que index.css ya aplica a `section` (encabezado fijo), ya que este elemento es
              un <div>, no un <section>, y no hereda esa regla. */}
          <div className="bg-surface sharp-border p-6 md:p-10 lg:p-12 relative scroll-mt-20" id="cotizacion">
            {estadoEnvio === 'enviado' ? (
              <div className="text-center py-12 space-y-6">
                <div className="w-16 h-16 bg-primary-container text-on-primary-container flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined text-4xl">check_circle</span>
                </div>
                <div className="space-y-2">
                  <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
                    ✅ ¡Tu solicitud fue enviada correctamente!
                  </h3>
                  <p className="font-body-md text-on-surface-variant max-w-md mx-auto">
                    Hemos recibido tu solicitud de cotización. Un asesor revisará la información y se pondrá en
                    contacto contigo para continuar con la atención.
                  </p>
                  {codigoSolicitud && (
                    <p className="font-code-sm text-sm text-primary-container uppercase pt-2">
                      Solicitud N.º {codigoSolicitud}
                    </p>
                  )}
                </div>

                <div className="max-w-md mx-auto bg-background sharp-border p-5 text-left space-y-3">
                  {/* FORMULARIO-UX-07.1 (autorización explícita — hallazgo de la auditoría
                        FORMULARIO-UX-07): unificado exactamente con el texto del bloque
                        equivalente del formulario (NEXIA-UX-05.4/05.3) — antes decía algo distinto
                        aquí ("Puedes enviarlo directamente por WhatsApp"), sin haberse actualizado
                        cuando se corrigió el otro bloque. Mismo texto exacto, sin insinuar que la
                        solicitud se envía por WhatsApp (ya se registró por el formulario web). */}
                  <p className="font-body-md text-sm text-on-surface-variant">
                    ¿Tienes una foto, plano o pieza de muestra?
                    <br />
                    Después de registrar tu solicitud, puedes compartirlos por WhatsApp para que nuestro equipo
                    revise mejor tu necesidad.
                  </p>
                  <a
                    // SOLICITUD-RECUPERACION-01A (autorización explícita — Bloque L): mensaje
                    // dinámico reemplazado por el texto exacto pedido en el bloque, centralizado
                    // junto con el número vía construirEnlaceWhatsApp() (lib/config.ts).
                    href={construirEnlaceWhatsApp(
                      `Hola, quiero continuar con mi solicitud ${codigoSolicitud ?? 'SOL-XXXXXX'} de ${NEXT_PROJECT_NAME}.`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full px-6 py-3 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors inline-flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined mr-2 text-[18px]">chat</span>
                    CONTINUAR POR WHATSAPP
                  </a>
                </div>

                <button
                  onClick={handleNuevaSolicitud}
                  className="px-6 py-3 border border-outline text-on-surface font-label-caps text-label-caps hover:bg-surface-container-high transition-colors"
                >
                  ENVIAR OTRA SOLICITUD
                </button>
              </div>
            ) : (
              /* FORMULARIO-UX-07.1 (autorización explícita — hallazgo de la auditoría
                 FORMULARIO-UX-07): `noValidate` desactiva el bloqueo nativo del navegador (que
                 antes interceptaba el envío ANTES de que corriera `validarFormularioLocal()`,
                 mostrando el globo genérico del navegador en vez del mensaje en español
                 diseñado por NEXTPROJECT). `validarFormularioLocal()` pasa a ser la única
                 autoridad de UX — ya cubría los 8 casos pedidos antes de este cambio, ahora
                 todos son alcanzables. Los atributos `required`/`type`/`min` de cada campo NO
                 se quitan: siguen aportando semántica/accesibilidad y el teclado correcto en
                 móvil, solo dejan de bloquear el submit por sí solos. La validación del
                 backend (segunda barrera) tampoco se toca. */
              <form className="space-y-8" onSubmit={handleFormSubmit} noValidate>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-10">
                  {/* COLUMNA IZQUIERDA: Tus datos */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 border-b border-outline pb-3 mb-2">
                      <div className="w-9 h-9 shrink-0 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-headline-md font-bold text-sm">
                        1
                      </div>
                      <div>
                        <h4 className="font-['Montserrat'] text-[14px] font-bold text-on-surface uppercase">Tus datos</h4>
                        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                          Completa la información para contactarte.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                        NOMBRE COMPLETO
                      </label>
                      <input
                        name="nombre"
                        value={formData.nombre}
                        onChange={handleInputChange}
                        required
                        className="w-full bg-background border-0 border-b border-outline text-on-surface pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal outline-none"
                        placeholder="Ej. Juan Pérez"
                        type="text"
                      />
                    </div>

                    <div>
                      <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                        EMPRESA (OPCIONAL)
                      </label>
                      <input
                        name="empresa"
                        value={formData.empresa}
                        onChange={handleInputChange}
                        className="w-full bg-background border-0 border-b border-outline text-on-surface pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal outline-none"
                        placeholder="Nombre de la industria"
                        type="text"
                      />
                      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1 pl-2">
                        Si corresponde, escribe el nombre de tu empresa
                      </p>
                    </div>

                    <div>
                      <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                        TELÉFONO / WHATSAPP
                      </label>
                      <input
                        name="telefono"
                        value={formData.telefono}
                        onChange={handleInputChange}
                        onBlur={() => setTelefonoTocado(true)}
                        required
                        maxLength={20}
                        aria-invalid={telefonoEsInvalido}
                        aria-describedby="telefono-ayuda"
                        className="w-full bg-background border-0 border-b border-outline text-on-surface pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal outline-none"
                        placeholder="Ej. 099 999 9999"
                        type="tel"
                      />
                      {/* FORMULARIO-UX-08.1 (autorización explícita): 4 estados en el MISMO párrafo
                          (nunca se agrega/quita el elemento, solo cambia texto+color) para no
                          provocar saltos de layout. 1) inicial/vacío: ayuda neutral. 2) escribiendo
                          sin salir del campo todavía: sigue la ayuda neutral (sin error prematuro).
                          3) inválido (tras onBlur o intento de envío, con contenido real): mensaje
                          de error. 4) válido (tras onBlur): confirmación discreta. `aria-live` avisa
                          el cambio a lectores de pantalla sin que el usuario tenga que buscarlo. */}
                      <p
                        id="telefono-ayuda"
                        aria-live="polite"
                        className={`font-['Inter'] text-[13px] font-normal mt-1 pl-2 flex items-center gap-1 ${telefonoEsInvalido ? 'text-error' : telefonoMostrarValido ? 'text-primary-container' : 'text-on-surface-variant'
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
                      <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                        CORREO ELECTRÓNICO
                      </label>
                      <input
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        onBlur={() => setEmailTocado(true)}
                        required
                        aria-invalid={emailEsInvalido}
                        aria-describedby="email-ayuda"
                        className="w-full bg-background border-0 border-b border-outline text-on-surface pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal outline-none"
                        placeholder="Ej. nombre@empresa.com"
                        type="email"
                      />
                      {/* FORMULARIO-UX-08.1 (autorización explícita): mismo patrón de 4 estados que
                          teléfono. El correo es obligatorio en este formulario, pero vacío nunca
                          muestra el error de formato — eso lo cubre el mensaje de envío. */}
                      <p
                        id="email-ayuda"
                        aria-live="polite"
                        className={`font-['Inter'] text-[13px] font-normal mt-1 pl-2 flex items-center gap-1 ${emailEsInvalido ? 'text-error' : emailMostrarValido ? 'text-primary-container' : 'text-on-surface-variant'
                          }`}
                      >
                        {emailMostrarValido && (
                          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">check_circle</span>
                        )}
                        Ingresa un correo electrónico válido.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                          CANTIDAD ESTIMADA
                        </label>
                        <input
                          name="cantidad"
                          value={formData.cantidad}
                          onChange={handleInputChange}
                          disabled={cantidadDesconocida}
                          required={!cantidadDesconocida}
                          className="w-full bg-background border-0 border-b border-outline text-on-surface pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal outline-none disabled:opacity-40"
                          placeholder="Ej. 10 piezas"
                          type="number"
                          min="1"
                        />
                        <label className="mt-2 flex items-center gap-2 font-code-sm text-[11px] text-on-surface-variant uppercase cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cantidadDesconocida}
                            onChange={(e) => {
                              setCantidadDesconocida(e.target.checked);
                              if (e.target.checked) setFormData((prev) => ({ ...prev, cantidad: '' }));
                            }}
                            className="cursor-pointer"
                          />
                          {/* FORMULARIO-UX-06.2 (autorización explícita): solo el texto visible
                                cambia — el checkbox, su comportamiento (deshabilita/limpia cantidad,
                                envía cantidad_desconocida=true) y el resto de la lógica siguen igual. */}
                          Todavía no conozco la cantidad
                        </label>
                      </div>
                      <div>
                        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                          FECHA TENTATIVA (OPCIONAL)
                        </label>
                        <input
                          name="fecha"
                          value={formData.fecha}
                          onChange={handleInputChange}
                          min={fechaHoyIso()}
                          className="w-full bg-background border-0 border-b border-outline text-on-surface-variant pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal [color-scheme:dark] outline-none"
                          type="date"
                        />
                      </div>
                    </div>
                  </div>

                  {/* COLUMNA DERECHA: Tu requerimiento */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 border-b border-outline pb-3 mb-2">
                      <div className="w-9 h-9 shrink-0 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-headline-md font-bold text-sm">
                        2
                      </div>
                      <div>
                        <h4 className="font-['Montserrat'] text-[14px] font-bold text-on-surface uppercase">Tu requerimiento</h4>
                        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                          Cuéntanos los detalles de lo que necesitas.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2 pl-2">
                        TIPO DE SERVICIO
                      </label>
                      <div className="relative">
                        <select
                          name="servicio"
                          value={formData.servicio}
                          onChange={handleInputChange}
                          required
                          className="w-full appearance-none bg-background border-0 border-b border-outline text-on-surface pl-2 pr-8 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal outline-none cursor-pointer"
                        >
                          <option value="" disabled>SELECCIONE UN SERVICIO</option>
                          <option value="TORNO INDUSTRIAL">TORNO INDUSTRIAL</option>
                          <option value="FRESADO INDUSTRIAL">FRESADO INDUSTRIAL</option>
                          <option value="FABRICACIÓN A MEDIDA">FABRICACIÓN A MEDIDA</option>
                          <option value="REPARACIÓN Y RECUPERACIÓN">REPARACIÓN Y RECUPERACIÓN</option>
                          <option value="NO ESTOY SEGURO / NECESITO ORIENTACIÓN">NO ESTOY SEGURO / NECESITO ORIENTACIÓN</option>
                        </select>
                        <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                          expand_more
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                        <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase pl-2">
                          DESCRIPCIÓN DEL REQUERIMIENTO
                        </label>
                        <button
                          type="button"
                          onClick={() => { setAiError(null); setModalType('asistente_ia'); }}
                          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold uppercase cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                          Ayúdame con IA
                        </button>
                      </div>
                      <p className="font-['Inter'] text-[14px] font-normal text-on-surface-variant mb-2 pl-2">
                        No necesitas conocer términos técnicos. Explícanos tu necesidad con tus propias palabras.
                      </p>
                      <textarea
                        ref={descripcionRef}
                        name="descripcion"
                        value={formData.descripcion}
                        onChange={handleInputChange}
                        required
                        className="w-full bg-background border-0 border-b border-outline text-on-surface pl-2 pr-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] font-normal resize-none outline-none"
                        placeholder="Ej.: Necesito fabricar 4 piezas iguales a una muestra que tengo."
                        rows={4}
                      ></textarea>
                    </div>

                    {/* NEXIA-UX-05.4 (autorización explícita — "CORREGIR TEXTO DEL BLOQUE DE
                          FOTOGRAFÍAS"): el texto describe el flujo ACTUAL y correcto (WhatsApp NO
                          registra la solicitud; la solicitud ya quedó registrada por el formulario web
                          — WhatsApp se usa DESPUÉS, solo para compartir material adicional) — nunca el
                          sistema de carga de archivos que ya no existe. Texto aprobado, sin variaciones
                          de contenido (solo el salto de línea/formato visual del párrafo). */}
                    <div className="border border-outline border-dashed p-4 bg-background flex items-start gap-3">
                      <span className="material-symbols-outlined text-on-surface-variant text-2xl shrink-0">photo_camera</span>
                      <div>
                        <p className="font-['Inter'] text-[14px] font-semibold text-on-surface-variant">
                          ¿Tienes una foto, plano o pieza de muestra?
                        </p>
                        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                          Después de registrar tu solicitud, puedes compartirlos por WhatsApp para que nuestro
                          equipo revise mejor tu necesidad.
                        </p>
                      </div>
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={consentimiento}
                        onChange={(e) => setConsentimiento(e.target.checked)}
                        required
                        className="mt-1 cursor-pointer shrink-0"
                      />
                      <span className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                        Acepto el tratamiento de mis datos personales para gestionar mi solicitud de servicio y
                        recibir atención relacionada con ella.{' '}
                        <button
                          type="button"
                          onClick={() => setModalType('privacidad')}
                          className="underline text-primary-container hover:text-primary cursor-pointer"
                        >
                          Ver política de privacidad
                        </button>
                        .
                      </span>
                    </label>
                  </div>
                </div>

                {submitError && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase text-center">
                    {submitError}
                  </p>
                )}

                {/* 6. Botón principal — único, grande, dominante. 3 estados: idle / enviando
                      (deshabilitado de inmediato, impide doble clic) / error (vuelve a habilitarse).
                      En escritorio (lg:) ancho fijo ~180px y lg:mx-auto lo centra respecto al
                      ancho total del formulario (ambas columnas), sin necesitar ningún
                      contenedor nuevo — el botón ya es hijo directo de <form>, que abarca las
                      dos columnas. whitespace-nowrap evita que el texto se parta en 2 líneas a
                      ese ancho (ver medición real), lo que habría cambiado la altura del botón
                      en escritorio frente a tablet/móvil. En tablet/móvil (sin prefijo lg:)
                      el botón conserva exactamente su w-full de siempre. */}
                <button
                  disabled={estadoEnvio === 'enviando'}
                  className="w-full lg:w-[280px] lg:mx-auto flex items-center justify-center px-6 py-4 lg:px-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold whitespace-nowrap hover:bg-primary-fixed-dim transition-colors cursor-pointer disabled:opacity-50"
                  type="submit"
                >
                  {estadoEnvio === 'enviando' ? '⏳ SOLICITUD EN PROCESO...' : 'ENVIAR SOLICITUD'}
                  {estadoEnvio !== 'enviando' && (
                    <span className="material-symbols-outlined ml-2 text-[18px]">send</span>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* 7. Atención humana — una sola acción visible (no WhatsApp + asesor por separado) */}
          <div className="mt-8 bg-surface sharp-border p-8 border-l-4 border-l-primary-container flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div>
              <p className="font-headline-md text-headline-md text-on-surface uppercase mb-1">
                ¿Necesitas hablar con alguien?
              </p>
              {/* ASISTENTE-COMERCIAL-02 (autorización explícita — hallazgo de la auditoría
                    ASISTENTE-COMERCIAL-01): este flujo NO envía el contacto por WhatsApp (crea un
                    Lead vía POST /api/leads) — el subtítulo ya no debe prometer ese canal. */}
              <p className="font-body-md text-body-md text-on-surface-variant">
                Nuestro equipo comercial puede ayudarte directamente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModalType('asistente_comercial')}
              className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center px-8 py-4 border-2 border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined mr-2 text-[20px]">support_agent</span>
              HABLAR CON UN ASESOR
            </button>
          </div>
        </div>
      </section>

      {/* 12. CONTACTO */}

      <section className="w-full bg-surface py-[56px]" id="contacto">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="border-l-4 border-primary-container pl-4 mb-8">
              <h3 className="font-label-caps text-label-caps !text-[14px] text-primary-container tracking-widest uppercase mb-2">
                UBICACIÓN Y DATOS
              </h3>
              <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
                CONTACTO
              </h2>
            </div>
            <div className="space-y-6 mt-8">
              <div className="flex items-start">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[24px]">location_on</span>
                <div>
                  <h4 className="font-['Inter'] text-[13px] font-semibold text-on-surface uppercase mb-1">UBICACIÓN</h4>
                  <p className="font-body-md text-body-md text-on-surface-variant">Shushufindi – Sucumbíos – Ecuador</p>
                </div>
              </div>
              <div className="flex items-start">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[24px]">phone</span>
                <div>
                  <h4 className="font-['Inter'] text-[13px] font-semibold text-on-surface uppercase mb-1">TELÉFONO / WHATSAPP</h4>
                  <a
                    href={construirEnlaceWhatsApp()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors"
                  >
                    093 906 7666
                  </a>
                </div>
              </div>
              <div className="flex items-start">
                <span className="material-symbols-outlined text-primary-container mr-4 text-[24px]">email</span>
                <div>
                  <h4 className="font-['Inter'] text-[13px] font-semibold text-on-surface uppercase mb-1">CORREO ELECTRÓNICO</h4>
                  <a
                    href="mailto:next.project84@gmail.com"
                    className="font-body-md text-body-md text-on-surface-variant hover:text-primary transition-colors"
                  >
                    next.project84@gmail.com
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Mapa de ubicación: mapa de Google Maps incrustado (carga diferida, sin clave de API) con una
              franja inferior con la ubicación y el enlace para abrirlo en Google Maps. */}
          <div className="bg-background sharp-border flex flex-col h-72 sm:h-80 overflow-hidden">
            <iframe
              title={`Mapa de ubicación de NextProject: ${NEXT_PROJECT_UBICACION_TEXTO}`}
              src={construirMapaUbicacion().embed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              className="w-full flex-1 min-h-0 border-0"
            />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-t border-outline bg-background">
              <p className="flex items-center gap-2 min-w-0 font-body-md text-body-md text-on-surface-variant">
                <span className="material-symbols-outlined text-primary-container text-[20px] shrink-0">location_on</span>
                <span className="truncate">{NEXT_PROJECT_UBICACION_TEXTO}</span>
              </p>
              <a
                className="inline-flex items-center justify-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[13px] font-semibold cursor-pointer whitespace-nowrap"
                href={construirMapaUbicacion().enlace}
                target="_blank"
                rel="noopener noreferrer"
              >
                VER EN GOOGLE MAPS
                <span className="material-symbols-outlined ml-2 text-[16px]">open_in_new</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 13. FOOTER (Shared Component Exact Implementation) */}
      <footer className="w-full bg-[#0A0A0A] border-t-4 border-primary hazard-border-top">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 grid grid-cols-1 md:grid-cols-3 gap-gutter">
          {/* Brand/Logo Col */}
          <div className="flex flex-col space-y-4">
            <div className="font-headline-md text-headline-md text-primary font-black uppercase tracking-tighter">
              <span>NEXT</span>
              <span className="text-primary-container">PROJECT</span>
            </div>
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant max-w-xs mt-2">
              Centro de mecanizado industrial de precisión. Soluciones técnicas para maquinaria y equipos pesados.
            </p>
          </div>

          {/* Links Col */}
          <div className="flex flex-col space-y-2">
            <h4 className="font-label-caps text-label-caps text-on-surface mb-2 border-b border-outline inline-block w-max pb-1">
              ENLACES
            </h4>
            <button
              onClick={() => setModalType('terminos')}
              className="font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-primary underline transition-colors w-max text-left cursor-pointer"
            >
              TÉRMINOS DE SERVICIO
            </button>
            <button
              onClick={() => setModalType('privacidad')}
              className="font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-primary underline transition-colors w-max text-left cursor-pointer"
            >
              POLÍTICA DE PRIVACIDAD
            </button>
          </div>

          {/* Copyright / Contact Info Col */}
          <div className="flex flex-col space-y-2 md:items-end md:text-right">
            <h4 className="font-label-caps text-label-caps text-on-surface mb-2 border-b border-outline inline-block w-max pb-1">
              LEGAL
            </h4>
            <span className="font-['Inter'] text-[13px] font-normal text-primary">
              © 2026 NEXTPROJECT CENTRO DE MECANIZADO INDUSTRIAL. TODOS LOS DERECHOS RESERVADOS.
            </span>
            <div className="mt-4 flex items-center space-x-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px]">location_on</span>
              <span className="font-['Inter'] text-[13px] font-normal uppercase">SHUSHUFINDI, SUCUMBÍOS, ECUADOR</span>
            </div>
          </div>
        </div>
      </footer>

      {/* MODAL DIALOGS (Terms / Privacy / Gallery) */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div
            className={`bg-surface sharp-border border-t-4 border-t-primary-container max-w-2xl w-full ${modalType === 'asistente_comercial' ? 'px-6 sm:px-10 md:px-14 py-6 md:py-8' : 'p-6 md:p-8'
              } max-h-[85vh] overflow-y-auto`}
          >
            <div className="flex justify-between items-center pb-4 border-b border-outline mb-6">
              <h3 className="font-headline-md text-headline-md uppercase text-on-surface flex items-center gap-2 flex-wrap">
                {modalType === 'terminos' && 'TÉRMINOS DE SERVICIO'}
                {modalType === 'privacidad' && 'POLÍTICA DE PRIVACIDAD'}
                {modalType === 'galeria' && 'GALERÍA TÉCNICA DE TRABAJOS'}
                {/* NEXIA-UX-01: el modo lo decide exclusivamente el backend (campo `modo` de la
                    respuesta) — el encabezado solo representa ese estado, nunca se ofrece un
                    control para que el usuario lo cambie. Antes de la primera consulta (aiModo
                    aún null) se muestra "NEXIA" sin modo, porque todavía no se sabe cuál aplica. */}
                {modalType === 'asistente_ia' && (
                  <>
                    <span>NEXIA</span>
                    {aiModo && (
                      <span className="inline-flex items-center gap-1.5 text-body-md normal-case">
                        <span className="text-on-surface-variant">·</span>
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${aiModo === 'IA' ? 'bg-primary-container' : 'bg-on-surface-variant'}`}
                          aria-hidden="true"
                        />
                        <span className="text-sm text-on-surface-variant tracking-normal">
                          MODO {aiModo === 'IA' ? 'IA' : 'ESTÁNDAR'}
                        </span>
                      </span>
                    )}
                  </>
                )}
                {modalType === 'asistente_comercial' && 'ASISTENTE COMERCIAL'}
              </h3>
              <button
                onClick={() => {
                  setModalType(null);
                  setAiSugerencia(null);
                  setAiModo(null);
                  setAiError(null);
                }}
                className="text-on-surface-variant hover:text-on-surface p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-2xl">close</span>
              </button>
            </div>

            {/* FORMULARIO-01: asistente conectado a un servicio real de IA (backend
                POST /api/asistente-formulario, mismo cliente/config de Gemini que NexIA
                interno) — reemplaza la versión anterior, que era lógica local por
                palabras clave y fabricaba material/proceso sin ninguna base real. El
                usuario siempre decide si aplica el texto sugerido; nunca se aplica solo. */}
            {modalType === 'asistente_ia' && !formData.servicio && (
              // NEXIA-UX-03 (autorización explícita): sin servicio seleccionado, NexIA no debe
              // intentar adivinar uno — ni Gemini (MODO IA) ni la detección por palabras clave
              // (MODO ESTÁNDAR) llegan a ejecutarse: no se llama al backend en absoluto. Es una
              // guarda puramente de frontend (formData.servicio ya se conoce sin preguntar a nadie),
              // por eso aplica igual sin importar qué modo hubiera correspondido después.
              <div className="space-y-4">
                <p className="font-body-md text-sm text-on-surface">
                  Selecciona un tipo de servicio para ayudarte de manera más precisa.
                </p>
                <p className="font-body-md text-sm text-on-surface-variant">
                  Cierra esta ventana y elige una opción en <strong>"Tipo de servicio"</strong>. Si todavía no sabes
                  cuál necesitas, selecciona <strong>"No estoy seguro / necesito orientación"</strong> — también te
                  ayudaremos a describir tu necesidad con esa opción.
                </p>
              </div>
            )}

            {modalType === 'asistente_ia' && formData.servicio && (
              <div className="space-y-6">
                <p className="font-body-md text-sm text-on-surface-variant">
                  Escribe en tus propias palabras la pieza, falla o trabajo que necesitas. El asistente te ayuda a
                  organizarlo y te hace preguntas simples — nunca inventa materiales, medidas ni precios. Es
                  opcional: puedes cerrar esta ventana y seguir escribiendo tú mismo sin ningún problema.
                </p>

                <div className="space-y-2">
                  <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase">
                    Describe tu requerimiento o pieza
                  </label>
                  <textarea
                    rows={3}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Ejemplo: Necesito reparar un eje que tiene desgaste donde asienta el rodamiento, o fabricar unos bujes iguales a una muestra que tengo..."
                    className="w-full bg-background border border-outline p-3 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={!aiPrompt.trim() || aiAnalyzing}
                    onClick={async () => {
                      setAiAnalyzing(true);
                      setAiError(null);
                      setAiSugerencia(null);
                      setAiModo(null);
                      try {
                        const response = await fetch(`${API_BASE}/api/asistente-formulario`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          // NEXIA-UX-05.1: el servicio ya seleccionado viaja siempre — este bloque solo
                          // se alcanza cuando formData.servicio no está vacío (ver el bloque
                          // `!formData.servicio` de arriba, sin cambios), así que aquí siempre hay un
                          // valor real de los 5 del <select>.
                          body: JSON.stringify({ prompt: aiPrompt.trim(), servicio: formData.servicio }),
                        });
                        const data = await response.json().catch(() => null);
                        if (!response.ok) {
                          throw new Error(data?.message || 'El asistente no está disponible en este momento.');
                        }
                        setAiSugerencia(data?.sugerencia ?? null);
                        setAiModo(data?.modo === 'ESTANDAR' ? 'ESTANDAR' : 'IA');
                      } catch (error) {
                        setAiError(
                          error instanceof Error ? error.message : 'El asistente no está disponible en este momento.'
                        );
                      } finally {
                        setAiAnalyzing(false);
                      }
                    }}
                    className="w-full sm:w-auto px-6 py-2.5 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold uppercase hover:bg-primary-fixed-dim transition-colors inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    {aiAnalyzing ? (
                      <>
                        <span className="material-symbols-outlined animate-spin mr-2 text-[16px]">sync</span>
                        CONSULTANDO...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined mr-2 text-[16px]">search_check</span>
                        AYUDARME A ORGANIZARLO
                      </>
                    )}
                  </button>
                </div>

                {aiError && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error">{aiError}</p>
                )}

                {aiSugerencia && (
                  <div className="bg-background sharp-border p-4 border-l-4 border-l-primary-container space-y-3">
                    {/* NEXIA-UX-03: se retira la insignia "Modo estándar (sin IA)" de aquí — el modo
                        ya se identifica en el encabezado del modal (NEXIA-UX-01), no hace falta
                        repetirlo dentro de la tarjeta de sugerencia. */}
                    <h5 className="font-label-caps text-xs text-primary-container uppercase font-bold">
                      SUGERENCIA DEL ASISTENTE
                    </h5>
                    <pre className="font-code-sm text-xs text-on-surface whitespace-pre-wrap leading-relaxed">
                      {aiSugerencia}
                    </pre>
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                      Tú decides si la incorporas — puedes editarla después en el formulario.
                    </p>
                    <div className="pt-2 flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const descripcionFinal = (formData.descripcion ? formData.descripcion + '\n\n' : '') + aiSugerencia;
                          setFormData((prev) => ({ ...prev, descripcion: descripcionFinal }));
                          setModalType(null);
                          setAiSugerencia(null);
                          setAiModo(null);
                          const el = document.getElementById('cotizacion');
                          if (el) el.scrollIntoView({ behavior: 'smooth' });
                          // FORMULARIO-UX-07.1 (autorización explícita — hallazgo de la auditoría
                          // FORMULARIO-UX-07): el textarea no quedaba con el foco tras aplicar,
                          // obligando a un clic manual antes de poder seguir escribiendo. Se
                          // devuelve el foco con el cursor al FINAL del contenido ya incorporado
                          // (texto previo + sugerencia) — nunca se selecciona todo, así que no hay
                          // riesgo de borrar nada si el usuario empieza a teclear de inmediato.
                          // requestAnimationFrame espera a que React termine de cerrar el modal y
                          // re-renderizar antes de enfocar (el textarea queda cubierto por el modal
                          // hasta ese momento).
                          requestAnimationFrame(() => {
                            const textarea = descripcionRef.current;
                            if (textarea) {
                              textarea.focus();
                              textarea.setSelectionRange(descripcionFinal.length, descripcionFinal.length);
                            }
                          });
                        }}
                        className="px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold uppercase hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                      >
                        APLICAR AL FORMULARIO
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {modalType === 'asistente_comercial' && (
              <AsistenteComercial
                onIrFormulario={() => {
                  setModalType(null);
                  const el = document.getElementById('cotizacion');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            )}

            {modalType === 'terminos' && (
              <div className="space-y-4 font-body-md text-on-surface-variant text-sm">
                <p>
                  <strong>1. Condiciones Generales:</strong> Todos los servicios prestados por NEXTPROJECT se ejecutan conforme a los planos, especificaciones y muestras entregadas por el cliente.
                </p>
                <p>
                  <strong>2. Tolerancias y Especificaciones:</strong> Los trabajos de mecanizado convencional cumplen con las normas técnicas y tolerancias dimensionales acordadas previamente en la cotización comercial.
                </p>
                <p>
                  <strong>3. Plazos de Entrega:</strong> Los tiempos de fabricación y entrega se determinan según la complejidad del proyecto y disponibilidad de materiales, contados a partir de la confirmación formal del requerimiento.
                </p>
                <p>
                  <strong>4. Garantía de Calidad:</strong> Todo componente es verificado mediante control dimensional riguroso antes de su entrega.
                </p>
              </div>
            )}

            {modalType === 'privacidad' && (
              <div className="space-y-4 font-body-md text-on-surface-variant text-sm">
                <p>
                  <strong>1. Tratamiento de Datos:</strong> Los datos proporcionados en los formularios de cotización y contacto son utilizados exclusivamente para la elaboración de propuestas técnicas y comunicación comercial directa.
                </p>
                <p>
                  <strong>2. Confidencialidad Técnica:</strong> Los planos, especificaciones de diseño, modelos y fotografías suministradas por nuestros clientes son tratados con estricta confidencialidad industrial.
                </p>
                <p>
                  <strong>3. Protección:</strong> No compartimos ni comercializamos información con terceros bajo ninguna circunstancia.
                </p>
              </div>
            )}

            {modalType === 'galeria' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src={tornoGalleryImg}
                      alt="Torno convencional de precisión"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface mt-2 uppercase">Mecanizado en Torno - Ejes y Bujes</p>
                  </div>
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuBGbni7SxU6HfhLwtUbc9PiI9SwSC5HnczCuf96vGHrsaNsvL8-ll_JZCS-jBVrau46yHhSCTFOeQY26blZzoSlih7eMKzcoJjVpol4eexW0Ks4CqrxITmxPGdaUGQKxstx6KkcA9XfXvSbfkIZNvAwihvCPSynh0TuI-3gGZtu7Ylt0qVGXDckO5msKreqr9wCZrzdaLsxAtE9gD3pPaJb8wPPRihJNS4ULPBtFPMtfjUr24VEXY5n"
                      alt="Fresado industrial de piezas"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface mt-2 uppercase">Fresado de Planos y Ranurados</p>
                  </div>
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src={fabricacionGalleryImg}
                      alt="Fabricación de componentes a medida"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface mt-2 uppercase">Fabricación Bajo Plano Técnico</p>
                  </div>
                  <div className="sharp-border p-2 bg-background">
                    <img
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRCedTnyrRhfyXwCd0psVMyBFX20Ka8yTV4DaHIY6Jn_a7LF4C7GkI2GUyQwL_V9FT3Ib51efRwZcOk-Gf11HWzjV3ac6jXvGCdCshatdKtMEv6Jx1wTv__-nW4L0PK6z0PwgWPJKivX-JHbdShSVnFeP_J-5-NF6vlQohmNjkipiXehYt9MUC1wQpwBFQOujw0a5dRrJ6C4tHbvh300WDSgVffaAoDxozsHmEZUEwElVIC7jwlDk0"
                      alt="Recuperación y rectificación de piezas"
                      className="w-full h-44 object-cover"
                    />
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface mt-2 uppercase">Recuperación y Ajuste Dimensional</p>
                  </div>
                </div>
              </div>
            )}

            <div className="hidden lg:flex mt-6 pt-4 border-t border-outline justify-end">
              <button
                onClick={() => setModalType(null)}
                className="px-6 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors cursor-pointer"
              >
                CERRAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
