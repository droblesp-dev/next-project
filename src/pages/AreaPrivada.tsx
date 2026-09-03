import { useState } from 'react';
import type { Usuario } from '../lib/authClient';
import BandejaSolicitudes from './BandejaSolicitudes';
import DetalleSolicitud from './DetalleSolicitud';
import GestionUsuarios from './GestionUsuarios';

interface AreaPrivadaProps {
  usuario: Usuario;
  token: string;
  onLogout: () => void;
  onSesionInvalida: () => void;
}

const ROLES_CON_BANDEJA = ['ADMIN', 'COMERCIAL'];

type Seccion = 'solicitudes' | 'usuarios';

export default function AreaPrivada({ usuario, token, onLogout, onSesionInvalida }: AreaPrivadaProps) {
  const [solicitudSeleccionada, setSolicitudSeleccionada] = useState<string | null>(null);
  const [seccion, setSeccion] = useState<Seccion>('solicitudes');
  const tieneBandeja = ROLES_CON_BANDEJA.includes(usuario.rol);
  const esAdmin = usuario.rol === 'ADMIN';

  return (
    <div className="bg-background text-on-surface font-body-md antialiased min-h-screen">
      <header className="bg-background border-b border-surface-container-highest sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
          <a className="font-headline-lg text-headline-lg-mobile font-black text-on-surface uppercase tracking-tighter flex items-center">
            <span>NEXT</span>
            <span className="text-primary-container">PROJECT</span>
            <span className="ml-3 font-label-caps text-label-caps text-on-surface-variant tracking-widest hidden sm:inline">
              ÁREA PRIVADA
            </span>
          </a>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="font-body-md text-body-md text-on-surface leading-tight">{usuario.nombre}</p>
              <p className="font-code-sm text-code-sm text-primary-container uppercase leading-tight">{usuario.rol}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps cursor-pointer"
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">logout</span>
              CERRAR SESIÓN
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12">
        {!tieneBandeja && (
          <div className="bg-surface sharp-border p-8 border-l-4 border-l-primary-container">
            <p className="font-body-md text-body-md text-on-surface">
              Acceso concedido. Tu cuenta está autenticada, pero no dispone de funcionalidades privadas
              disponibles en esta fase.
            </p>
          </div>
        )}

        {tieneBandeja && (
          <div>
            <div className="border-l-4 border-primary-container pl-4 mb-8">
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-1">
                GESTIÓN
              </h3>
              <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
                {seccion === 'usuarios'
                  ? 'GESTIÓN DE USUARIOS'
                  : solicitudSeleccionada
                    ? 'DETALLE DE SOLICITUD'
                    : 'BANDEJA DE SOLICITUDES'}
              </h2>
            </div>

            {esAdmin && (
              <div className="flex gap-3 mb-8">
                <button
                  type="button"
                  onClick={() => setSeccion('solicitudes')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'solicitudes'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  SOLICITUDES
                </button>
                <button
                  type="button"
                  onClick={() => setSeccion('usuarios')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'usuarios'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  USUARIOS
                </button>
              </div>
            )}

            {seccion === 'usuarios' && esAdmin ? (
              <GestionUsuarios token={token} onSesionInvalida={onSesionInvalida} />
            ) : solicitudSeleccionada ? (
              <DetalleSolicitud
                token={token}
                id={solicitudSeleccionada}
                onVolver={() => setSolicitudSeleccionada(null)}
                onSesionInvalida={onSesionInvalida}
              />
            ) : (
              <BandejaSolicitudes
                token={token}
                onSeleccionar={setSolicitudSeleccionada}
                onSesionInvalida={onSesionInvalida}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
