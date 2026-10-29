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

// Redes sociales oficiales de NextProject para el pie de la cotización pública. Cada URL se configura con su
// variable VITE_* (ver .env.example); mientras no esté definida (o no sea una URL https válida) la red queda en
// null y el pie muestra su ícono SIN enlace: nunca se inventa una cuenta ni se apunta a un destino ficticio.
export type RedSocial = 'facebook' | 'instagram' | 'tiktok' | 'youtube';

export function urlRedSocial(valor: string | undefined | null): string | null {
  const texto = (valor ?? '').trim();
  if (!texto) return null;
  try {
    const url = new URL(texto);
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

export const NEXT_PROJECT_REDES: Record<RedSocial, string | null> = {
  facebook: urlRedSocial(import.meta.env.VITE_NEXT_PROJECT_FACEBOOK_URL),
  instagram: urlRedSocial(import.meta.env.VITE_NEXT_PROJECT_INSTAGRAM_URL),
  tiktok: urlRedSocial(import.meta.env.VITE_NEXT_PROJECT_TIKTOK_URL),
  youtube: urlRedSocial(import.meta.env.VITE_NEXT_PROJECT_YOUTUBE_URL),
};

// Ubicación que se muestra en la sección de contacto y en el mapa incrustado. Hoy solo se conoce la
// ciudad (no hay una dirección exacta publicada), así que el mapa apunta al centro de Shushufindi.
// Para un marcador preciso basta definir VITE_NEXT_PROJECT_UBICACION_CONSULTA con la dirección
// completa o con el nombre del negocio tal como aparece en Google Maps; nunca se inventan coordenadas.
export const NEXT_PROJECT_UBICACION_TEXTO =
  import.meta.env.VITE_NEXT_PROJECT_UBICACION_TEXTO ?? 'Shushufindi, Sucumbíos, Ecuador';
export const NEXT_PROJECT_UBICACION_CONSULTA =
  import.meta.env.VITE_NEXT_PROJECT_UBICACION_CONSULTA ?? 'Shushufindi, Sucumbios, Ecuador';

// Dirección del mapa incrustado (sin clave de API) y del enlace «Ver en Google Maps».
export function construirMapaUbicacion(consulta: string = NEXT_PROJECT_UBICACION_CONSULTA): {
  embed: string;
  enlace: string;
} {
  const q = encodeURIComponent(consulta);
  return {
    embed: `https://www.google.com/maps?q=${q}&output=embed`,
    enlace: `https://www.google.com/maps/search/?api=1&query=${q}`,
  };
}
