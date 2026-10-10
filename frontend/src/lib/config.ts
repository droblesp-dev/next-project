// SOLICITUD-RECUPERACION-01A (autorización explícita — Bloque K): número de
// WhatsApp oficial de NextProject, centralizado — antes repetido como
// literal 4 veces en App.tsx (verificado en la auditoría previa,
// SOLICITUD-RECUPERACION-01). Mismo mecanismo ya usado y aprobado por
// `API_BASE` (authClient.ts): variable de entorno VITE_* opcional, con el
// número ya verificado y en uso como valor por defecto — nunca se inventa
// uno nuevo ni se cambia el existente.
export const NEXT_PROJECT_WHATSAPP = import.meta.env.VITE_NEXT_PROJECT_WHATSAPP ?? '593939067666';

// Marca comercial visible al cliente en esta funcionalidad (mensaje de
// WhatsApp precargado) — nunca "Mecaniza Flores" (decisión explícita del
// bloque, sección 5 del pedido original / Bloque K de la implementación).
export const NEXT_PROJECT_NAME = import.meta.env.VITE_NEXT_PROJECT_NAME ?? 'NextProject';

// Arma un enlace wa.me con el mensaje ya codificado — mismo patrón que ya
// usaba App.tsx en sus 4 puntos (ahora centralizado en un solo lugar, en
// vez de repetir `https://wa.me/${numero}?text=${encodeURIComponent(...)}`
// cada vez). Sin mensaje, devuelve el enlace simple (igual que el botón del
// pie de página, que hoy no precarga texto).
export function construirEnlaceWhatsApp(mensaje?: string): string {
  const base = `https://wa.me/${NEXT_PROJECT_WHATSAPP}`;
  return mensaje ? `${base}?text=${encodeURIComponent(mensaje)}` : base;
}
