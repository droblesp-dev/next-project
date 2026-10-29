import {
  construirEnlaceWhatsApp,
  NEXT_PROJECT_NAME,
  NEXT_PROJECT_REDES,
  type RedSocial,
} from '../lib/config';
import { IconoFacebook, IconoInstagram, IconoTikTok, IconoYouTube } from './IconosRedesSociales';

interface PieCotizacionPublicaProps {
  // Código de la cotización (COT-XXXXXX) para identificarla en el mensaje de WhatsApp, si se conoce.
  codigoCotizacion?: string | null;
  // URL de cada red social (null = sin configurar). Por defecto, la configuración del proyecto.
  redes?: Record<RedSocial, string | null>;
}

const REDES: { clave: RedSocial; nombre: string; Icono: typeof IconoFacebook }[] = [
  { clave: 'facebook', nombre: 'Facebook', Icono: IconoFacebook },
  { clave: 'instagram', nombre: 'Instagram', Icono: IconoInstagram },
  { clave: 'tiktok', nombre: 'TikTok', Icono: IconoTikTok },
  { clave: 'youtube', nombre: 'YouTube', Icono: IconoYouTube },
];

const CLASE_ICONO_RED =
  'inline-flex h-11 w-11 items-center justify-center border border-outline text-on-surface-variant';

// Pie de la cotización pública: contacto con un asesor por el número oficial de WhatsApp (el mismo de
// la web principal, configurado en lib/config.ts; el número ya no se muestra como texto, solo el botón) y regreso al sitio. Las redes sociales (Facebook, Instagram,
// TikTok y YouTube) se enlazan solo si su URL está configurada; si no, se muestra el ícono sin navegación.
export default function PieCotizacionPublica({ codigoCotizacion, redes = NEXT_PROJECT_REDES }: PieCotizacionPublicaProps) {
  const mensaje = codigoCotizacion
    ? `Hola ${NEXT_PROJECT_NAME}, necesito hablar con un asesor sobre mi cotización ${codigoCotizacion}.`
    : `Hola ${NEXT_PROJECT_NAME}, necesito hablar con un asesor sobre mi cotización.`;

  return (
    <footer className="mt-6 border-t border-outline pt-6 space-y-4 text-center" aria-label="Contacto">
      <p className="font-['Inter'] text-[13px] text-on-surface-variant">¿Tienes dudas sobre tu cotización?</p>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a
          href={construirEnlaceWhatsApp(mensaje)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[13px] font-semibold hover:bg-primary-fixed-dim transition-colors focus:outline-none focus:ring-2 focus:ring-primary-container"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            chat
          </span>
          HABLAR CON UN ASESOR
        </a>
        <a
          href="/"
          className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[13px] font-semibold focus:outline-none focus:ring-2 focus:ring-primary-container"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            arrow_back
          </span>
          VOLVER A LA PÁGINA PRINCIPAL
        </a>
      </div>

      <ul className="flex flex-wrap justify-center gap-3" aria-label="Redes sociales">
        {REDES.map(({ clave, nombre, Icono }) => {
          const url = redes[clave];
          return (
            <li key={clave}>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${nombre} (se abre en una pestaña nueva)`}
                  className={`${CLASE_ICONO_RED} hover:text-primary-container hover:border-primary-container transition-colors focus:outline-none focus:ring-2 focus:ring-primary-container`}
                >
                  <Icono className="h-5 w-5" />
                </a>
              ) : (
                <span
                  role="img"
                  aria-label={`${nombre} (enlace no configurado)`}
                  title={`${nombre}: próximamente`}
                  data-sin-enlace="true"
                  className={`${CLASE_ICONO_RED} opacity-40 cursor-default`}
                >
                  <Icono className="h-5 w-5" />
                </span>
              )}
            </li>
          );
        })}
      </ul>

    </footer>
  );
}
