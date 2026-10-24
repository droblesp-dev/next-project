import type { NivelPassword } from '../lib/politicaPassword';

// Indicador visual de fortaleza de la nueva contraseña. Texto, color de la barra, color del texto
// y ancho salen TODOS del mismo nivel calculado por evaluarPassword(): no hay valores sueltos que
// puedan quedar desincronizados. Solo presentación: la política (qué se acepta) vive en
// politicaPassword.ts y el servidor la vuelve a evaluar.
export const PRESENTACION_NIVEL_PASSWORD: Record<
  NivelPassword,
  { texto: string; barra: string; colorTexto: string; ancho: string }
> = {
  DEBIL: { texto: 'CONTRASEÑA DÉBIL', barra: 'bg-error', colorTexto: 'text-error', ancho: 'w-1/3' },
  MEDIA: {
    texto: 'CONTRASEÑA MEDIA — NECESITA MEJORAR',
    barra: 'bg-primary-container',
    colorTexto: 'text-primary-container',
    ancho: 'w-2/3',
  },
  FUERTE: { texto: 'CONTRASEÑA FUERTE', barra: 'bg-[#22c55e]', colorTexto: 'text-[#22c55e]', ancho: 'w-full' },
};

export const TEXTO_SIN_PASSWORD = 'ESCRIBE UNA CONTRASEÑA';

// `nivel` es null mientras el campo está vacío.
export default function IndicadorFortalezaPassword({ nivel }: { nivel: NivelPassword | null }) {
  const p = nivel ? PRESENTACION_NIVEL_PASSWORD[nivel] : null;
  return (
    <div aria-live="polite" data-nivel={nivel ?? 'VACIO'}>
      <div className="h-1.5 w-full bg-outline-variant/30">
        {p && <div className={`h-full transition-all ${p.barra} ${p.ancho}`} />}
      </div>
      <p className={`font-code-sm text-[11px] uppercase mt-1 ${p ? p.colorTexto : 'text-on-surface-variant'}`}>
        {p ? p.texto : TEXTO_SIN_PASSWORD}
      </p>
    </div>
  );
}
