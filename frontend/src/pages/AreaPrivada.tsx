import { useState } from 'react';
import type { Usuario } from '../lib/authClient';
import BandejaSolicitudes from './BandejaSolicitudes';
import DetalleSolicitud from './DetalleSolicitud';
import GestionUsuarios from './GestionUsuarios';
import GestionCotizaciones from './GestionCotizaciones';
import GestionOrdenes from './GestionOrdenes';
import GestionLeads from './GestionLeads';
import GestionAlertas from './GestionAlertas';
import GestionDashboard from './GestionDashboard';

interface AreaPrivadaProps {
  usuario: Usuario;
  token: string;
  onLogout: () => void;
  onSesionInvalida: () => void;
}

const ROLES_CON_BANDEJA = ['ADMIN', 'COMERCIAL'];
// ROLES_CON_ORDENES sigue controlando ALERTAS (sin cambios, backend
// intacto: alertas.routes.ts sigue exigiendo ADMIN/OPERATIVO). F-08 agrega
// una visibilidad de solo lectura de ÓRDENES para COMERCIAL, controlada
// por una lista separada para no otorgarle también acceso a alertas.
const ROLES_CON_ORDENES = ['ADMIN', 'OPERATIVO'];
const ROLES_CON_LECTURA_ORDENES = ['ADMIN', 'OPERATIVO', 'COMERCIAL'];
// Bloque MVP (chat Comercial<->Operativo): visibilidad de solo lectura de
// SOLICITUDES para OPERATIVO (antes sin ningún acceso a este módulo).
// Distinta de ROLES_CON_BANDEJA: esta última sigue controlando además
// COTIZACIONES y LEADS, que OPERATIVO no debe ver.
const ROLES_CON_LECTURA_SOLICITUDES = ['ADMIN', 'COMERCIAL', 'OPERATIVO'];

type Seccion = 'solicitudes' | 'cotizaciones' | 'ordenes' | 'leads' | 'alertas' | 'usuarios' | 'dashboard';

export default function AreaPrivada({ usuario, token, onLogout, onSesionInvalida }: AreaPrivadaProps) {
  const tieneBandeja = ROLES_CON_BANDEJA.includes(usuario.rol);
  const tieneOrdenes = ROLES_CON_ORDENES.includes(usuario.rol);
  const puedeVerOrdenes = ROLES_CON_LECTURA_ORDENES.includes(usuario.rol);
  const esAdmin = usuario.rol === 'ADMIN';
  // F-08: gestionar (cambiar estado) sigue siendo exclusivo de ADMIN/OPERATIVO
  // — COMERCIAL solo puede ver el listado/detalle, nunca actuar sobre ellas.
  const puedeGestionarOrdenes = usuario.rol === 'ADMIN' || usuario.rol === 'OPERATIVO';
  const puedeVerSolicitudes = ROLES_CON_LECTURA_SOLICITUDES.includes(usuario.rol);
  // Chat: exclusivo COMERCIAL/OPERATIVO — ADMIN no participa (decisión
  // aprobada explícitamente para este bloque).
  const puedeChatear = usuario.rol === 'COMERCIAL' || usuario.rol === 'OPERATIVO';
  // Bloque MVP (ficha técnica), decisiones 1-3: ADMIN y COMERCIAL pueden
  // crear la orden; OPERATIVO no. Independiente de `esAdmin` (que sigue
  // controlando exclusivamente "Asignar responsable").
  const puedeCrearOrden = usuario.rol === 'ADMIN' || usuario.rol === 'COMERCIAL';
  // Bloque saldo/entrega/cierre: exclusivo ADMIN/COMERCIAL — OPERATIVO no
  // maneja información económica ni gestiona entrega/cierre (decisión
  // explícita). Independiente de `puedeGestionarOrdenes` (avance/estado/
  // evidencia, que sigue siendo ADMIN/OPERATIVO).
  const puedeGestionarPago = usuario.rol === 'ADMIN' || usuario.rol === 'COMERCIAL';

  const [solicitudSeleccionada, setSolicitudSeleccionada] = useState<string | null>(null);
  const [seccion, setSeccion] = useState<Seccion>(tieneBandeja ? 'solicitudes' : 'ordenes');

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
        {!tieneBandeja && !tieneOrdenes && (
          <div className="bg-surface sharp-border p-8 border-l-4 border-l-primary-container">
            <p className="font-body-md text-body-md text-on-surface">
              Acceso concedido. Tu cuenta está autenticada, pero no dispone de funcionalidades privadas
              disponibles en esta fase.
            </p>
          </div>
        )}

        {(tieneBandeja || tieneOrdenes) && (
          <div>
            <div className="border-l-4 border-primary-container pl-4 mb-8">
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-1">
                GESTIÓN
              </h3>
              <h2 className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-bold text-on-surface uppercase">
                {seccion === 'dashboard'
                  ? 'DASHBOARD'
                  : seccion === 'usuarios'
                  ? 'GESTIÓN DE USUARIOS'
                  : seccion === 'cotizaciones'
                    ? 'GESTIÓN DE COTIZACIONES'
                    : seccion === 'ordenes'
                      ? 'GESTIÓN DE ÓRDENES'
                      : seccion === 'leads'
                        ? 'GESTIÓN DE LEADS'
                        : seccion === 'alertas'
                          ? 'ALERTAS'
                          : solicitudSeleccionada
                        ? 'DETALLE DE SOLICITUD'
                        : 'BANDEJA DE SOLICITUDES'}
              </h2>
            </div>

            <div className="flex gap-3 mb-8 flex-wrap">
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => setSeccion('dashboard')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'dashboard'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  DASHBOARD
                </button>
              )}
              {puedeVerSolicitudes && (
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
              )}
              {tieneBandeja && (
                <button
                  type="button"
                  onClick={() => setSeccion('cotizaciones')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'cotizaciones'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  COTIZACIONES
                </button>
              )}
              {puedeVerOrdenes && (
                <button
                  type="button"
                  onClick={() => setSeccion('ordenes')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'ordenes'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  ÓRDENES
                </button>
              )}
              {tieneOrdenes && (
                <button
                  type="button"
                  onClick={() => setSeccion('alertas')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'alertas'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  ALERTAS
                </button>
              )}
              {tieneBandeja && (
                <button
                  type="button"
                  onClick={() => setSeccion('leads')}
                  className={`inline-flex items-center px-4 py-2 font-label-caps text-label-caps transition-colors cursor-pointer ${
                    seccion === 'leads'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  LEADS
                </button>
              )}
              {esAdmin && (
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
              )}
            </div>

            {seccion === 'dashboard' && esAdmin ? (
              <GestionDashboard token={token} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'usuarios' && esAdmin ? (
              <GestionUsuarios token={token} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'ordenes' && puedeVerOrdenes ? (
              <GestionOrdenes
                token={token}
                esAdmin={esAdmin}
                puedeGestionar={puedeGestionarOrdenes}
                puedeCrearOrden={puedeCrearOrden}
                puedeGestionarPago={puedeGestionarPago}
                onSesionInvalida={onSesionInvalida}
              />
            ) : seccion === 'leads' && tieneBandeja ? (
              <GestionLeads token={token} esAdmin={esAdmin} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'alertas' && tieneOrdenes ? (
              <GestionAlertas token={token} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'cotizaciones' && tieneBandeja ? (
              <GestionCotizaciones token={token} onSesionInvalida={onSesionInvalida} />
            ) : puedeVerSolicitudes && solicitudSeleccionada ? (
              <DetalleSolicitud
                token={token}
                id={solicitudSeleccionada}
                puedeGestionar={tieneBandeja}
                puedeChatear={puedeChatear}
                onVolver={() => setSolicitudSeleccionada(null)}
                onSesionInvalida={onSesionInvalida}
              />
            ) : puedeVerSolicitudes ? (
              <BandejaSolicitudes
                token={token}
                puedeChatear={puedeChatear}
                onSeleccionar={setSolicitudSeleccionada}
                onSesionInvalida={onSesionInvalida}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
