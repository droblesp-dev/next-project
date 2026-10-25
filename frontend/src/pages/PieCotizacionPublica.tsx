import { construirEnlaceWhatsApp, NEXT_PROJECT_NAME, NEXT_PROJECT_WHATSAPP } from '../lib/config';

interface PieCotizacionPublicaProps {
  // Código de la cotización (COT-XXXXXX) para identificarla en el mensaje de WhatsApp, si se conoce.
  codigoCotizacion?: string | null;
}

// Pie de la cotización pública: contacto con un asesor por el número oficial de WhatsApp (el mismo de
// la web principal, configurado en lib/config.ts) y regreso al sitio. No se agregan redes sociales
// porque todavía no hay URLs oficiales verificadas.
export default function PieCotizacionPublica({ codigoCotizacion }: PieCotizacionPublicaProps) {
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

      <p className="font-['Inter'] text-[12px] text-on-surface-variant">
        WhatsApp:{' '}
        <a href={`tel:+${NEXT_PROJECT_WHATSAPP}`} className="underline hover:text-on-surface">
          +{NEXT_PROJECT_WHATSAPP}
        </a>
      </p>
    </footer>
  );
}
