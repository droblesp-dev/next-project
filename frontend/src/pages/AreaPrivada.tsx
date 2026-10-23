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
import GestionCuentasBancarias from './GestionCuentasBancarias';

interface AreaPrivadaProps {
  usuario: Usuario;
  token: string;
  onLogout: () => void;
  onSesionInvalida: () => void;
}

const ROLES_CON_BANDEJA = ['ADMIN', 'COMERCIAL'];
const ROLES_CON_ORDENES = ['ADMIN', 'OPERATIVO'];
const ROLES_CON_LECTURA_ORDENES = ['ADMIN', 'OPERATIVO', 'COMERCIAL'];
// ALERTAS-02 (decisiones 1A/2B/3A): COMERCIAL deja de recibir 403 en Alertas — el backend ya
// filtra qué ve cada rol (todas / solo responsable / solo tipo ENTREGA); aquí solo se decide quién
// ve la sección. Antes reutilizaba ROLES_CON_ORDENES (ADMIN/OPERATIVO); se separa en su propia
// constante para no afectar el menú de ÓRDENES, que sigue gobernado por ROLES_CON_ORDENES.
const ROLES_CON_ALERTAS = ['ADMIN', 'OPERATIVO', 'COMERCIAL'];
// Bloque MVP (chat Comercial<->Operativo): visibilidad de solo lectura de
// SOLICITUDES para OPERATIVO (antes sin ningún acceso a este módulo).
// Distinta de ROLES_CON_BANDEJA: esta última sigue controlando además
// COTIZACIONES y LEADS, que OPERATIVO no debe ver.
const ROLES_CON_LECTURA_SOLICITUDES = ['ADMIN', 'COMERCIAL', 'OPERATIVO'];

type Seccion = 'solicitudes' | 'cotizaciones' | 'ordenes' | 'leads' | 'alertas' | 'usuarios' | 'dashboard' | 'cuentas-bancarias';

export default function AreaPrivada({ usuario, token, onLogout, onSesionInvalida }: AreaPrivadaProps) {
  const tieneBandeja = ROLES_CON_BANDEJA.includes(usuario.rol);
  const tieneOrdenes = ROLES_CON_ORDENES.includes(usuario.rol);
  const puedeVerOrdenes = ROLES_CON_LECTURA_ORDENES.includes(usuario.rol);
  const tieneAlertas = ROLES_CON_ALERTAS.includes(usuario.rol);
  // ALERTAS-02 (decisión 5A): solo el OPERATIVO responsable puede atender (el backend lo vuelve a
  // verificar en cada PATCH); ADMIN nunca ve el botón (vista de solo supervisión, sin cambios) y
  // COMERCIAL tampoco (2B es de consulta, no de atención).
  const puedeAtenderAlertas = usuario.rol === 'OPERATIVO';
  const esAdmin = usuario.rol === 'ADMIN';
  // F-08: gestionar (cambiar estado) sigue siendo exclusivo de ADMIN/OPERATIVO
  // — COMERCIAL solo puede ver el listado/detalle, nunca actuar sobre ellas.
  const puedeGestionarOrdenes = usuario.rol === 'ADMIN' || usuario.rol === 'OPERATIVO';
  const puedeVerSolicitudes = ROLES_CON_LECTURA_SOLICITUDES.includes(usuario.rol);
  // Chat: exclusivo COMERCIAL/OPERATIVO — ADMIN no participa (decisión
  // aprobada explícitamente para este bloque).
  const puedeChatear = usuario.rol === 'COMERCIAL' || usuario.rol === 'OPERATIVO';
  // Corrección de responsabilidades por rol en DetalleSolicitud
  // (autorización explícita — "AUTORIZACIÓN DE IMPLEMENTACIÓN — DETALLE DE
  // SOLICITUDES POR ROL"): ADMIN pasa a ser exclusivamente de
  // consulta/supervisión — ya no cambia el estado de la solicitud ni
  // genera/revisa análisis IA, eso queda exclusivo de COMERCIAL. La
  // consulta del historial de análisis IA (solo lectura) sigue siendo
  // ADMIN+COMERCIAL — se reutiliza `tieneBandeja` tal cual ya se usaba
  // antes para ese bloque completo, sin ninguna lógica de autenticación
  // nueva. IMPORTANTE: esto es una corrección de interfaz, no de
  // seguridad — el backend (solicitudes.routes.ts, analisisIa.routes.ts)
  // sigue aceptando estas acciones desde un JWT de ADMIN; queda
  // [PENDIENTE] una corrección posterior de permisos backend.
  const puedeGestionarSolicitud = usuario.rol === 'COMERCIAL';
  const puedeGenerarAnalisis = usuario.rol === 'COMERCIAL';
  const puedeRevisarAnalisis = usuario.rol === 'COMERCIAL';
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
  // Bloque 2B.1: al llegar a la comunicación técnica desde el detalle de una orden se enfoca el chat;
  // el modo (editable / solo lectura / sin acceso) lo decide el backend al cargar los mensajes.
  const [enfocarChat, setEnfocarChat] = useState(false);
  function handleAbrirSolicitud(id: string | null) {
    setEnfocarChat(false);
    setSolicitudSeleccionada(id);
  }
  function handleVerComunicacionDesdeOrden(solicitudId: string) {
    setEnfocarChat(true);
    setSolicitudSeleccionada(solicitudId);
    setSeccion('solicitudes');
  }
  // Cableado de navegación Alertas -> Órdenes (autorización explícita —
  // "IMPLEMENTACIÓN AUTORIZADA — ALERTAS ADMIN"). Sin react-router: se
  // reutiliza el mismo patrón de estado-en-memoria ya usado en todo el
  // proyecto. `ordenIdDesdeAlerta` se consume una sola vez en
  // GestionOrdenes.tsx (que ya lo limpia mediante
  // onOrdenInicialConsumida) para preseleccionar la orden correspondiente
  // al abrir esa sección.
  const [ordenIdDesdeAlerta, setOrdenIdDesdeAlerta] = useState<string | null>(null);
  // Leads -> Cotizaciones: mismo mecanismo (se consume una sola vez).
  const [cotizacionIdDesdeLead, setCotizacionIdDesdeLead] = useState<string | null>(null);

  function handleVerCotizacionDesdeLead(cotizacionId: string) {
    setCotizacionIdDesdeLead(cotizacionId);
    setSeccion('cotizaciones');
  }

  function handleVerOrdenDesdeAlerta(ordenId: string) {
    setOrdenIdDesdeAlerta(ordenId);
    setSeccion('ordenes');
  }
  const [seccion, setSeccion] = useState<Seccion>(tieneBandeja ? 'solicitudes' : 'ordenes');

  return (
    <div className="bg-background text-on-surface font-body-md antialiased min-h-screen">
      <header className="bg-background border-b border-surface-container-highest sticky top-0 z-50">
        <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
          <a className="font-['Montserrat'] text-[24px] lg:text-[32px] font-black text-on-surface uppercase tracking-tighter flex items-center">
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
            {/* Notificaciones — entrada visual global preparada para uso
                futuro (autorización explícita: solo placeholder de
                navegación). Sin sección, sin contador, sin datos
                simulados — no se agrega ningún endpoint/tabla/lógica.
                Ubicada en la barra superior, junto al nombre y rol del
                usuario, en los roles que tienen bandeja u órdenes. */}
            {(tieneBandeja || tieneOrdenes) && (
              <button
                type="button"
                disabled
                title="Notificaciones — próximamente"
                aria-label="Notificaciones (próximamente)"
                className="inline-flex items-center justify-center w-10 h-10 border border-outline text-on-surface-variant opacity-50 cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              aria-label="Cerrar sesión"
              className="inline-flex items-center justify-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined sm:mr-2 text-[18px]">logout</span>
              <span className="hidden sm:inline">CERRAR SESIÓN</span>
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
              <h2 className="font-headline-lg-responsive font-bold text-on-surface uppercase">
                {seccion === 'dashboard'
                  ? 'DASHBOARD'
                  : seccion === 'usuarios'
                  ? 'GESTIÓN DE USUARIOS'
                  : seccion === 'cuentas-bancarias'
                  ? 'CUENTAS BANCARIAS'
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
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
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
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
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
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
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
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
                    seccion === 'ordenes'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  ÓRDENES
                </button>
              )}
              {tieneAlertas && (
                <button
                  type="button"
                  onClick={() => setSeccion('alertas')}
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
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
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
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
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
                    seccion === 'usuarios'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  USUARIOS
                </button>
              )}
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => setSeccion('cuentas-bancarias')}
                  className={`inline-flex items-center px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
                    seccion === 'cuentas-bancarias'
                      ? 'bg-primary-container text-on-primary-container'
                      : 'border border-outline text-on-surface hover:bg-surface-container-high'
                  }`}
                >
                  CUENTAS BANCARIAS
                </button>
              )}
            </div>

            {seccion === 'dashboard' && esAdmin ? (
              <GestionDashboard token={token} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'usuarios' && esAdmin ? (
              <GestionUsuarios token={token} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'cuentas-bancarias' && esAdmin ? (
              <GestionCuentasBancarias token={token} onSesionInvalida={onSesionInvalida} />
            ) : seccion === 'ordenes' && puedeVerOrdenes ? (
              <GestionOrdenes
                token={token}
                esAdmin={esAdmin}
                puedeGestionar={puedeGestionarOrdenes}
                usuarioId={usuario.id}
                puedeCrearOrden={puedeCrearOrden}
                puedeGestionarPago={puedeGestionarPago}
                ordenIdSeleccionadaInicial={ordenIdDesdeAlerta}
                onOrdenInicialConsumida={() => setOrdenIdDesdeAlerta(null)}
                onVerComunicacion={handleVerComunicacionDesdeOrden}
                onSesionInvalida={onSesionInvalida}
              />
            ) : seccion === 'leads' && tieneBandeja ? (
              <GestionLeads
                token={token}
                esAdmin={esAdmin}
                onSesionInvalida={onSesionInvalida}
                onVerCotizacion={handleVerCotizacionDesdeLead}
              />
            ) : seccion === 'alertas' && tieneAlertas ? (
              <GestionAlertas
                token={token}
                esAdmin={esAdmin}
                puedeAtender={puedeAtenderAlertas}
                onVerOrden={handleVerOrdenDesdeAlerta}
                onSesionInvalida={onSesionInvalida}
              />
            ) : seccion === 'cotizaciones' && tieneBandeja ? (
              <GestionCotizaciones
                token={token}
                esAdmin={esAdmin}
                onSesionInvalida={onSesionInvalida}
                cotizacionIdInicial={cotizacionIdDesdeLead}
                onCotizacionInicialConsumida={() => setCotizacionIdDesdeLead(null)}
              />
            ) : puedeVerSolicitudes && solicitudSeleccionada ? (
              <DetalleSolicitud
                token={token}
                id={solicitudSeleccionada}
                puedeGestionarSolicitud={puedeGestionarSolicitud}
                puedeConsultarAnalisis={tieneBandeja}
                puedeGenerarAnalisis={puedeGenerarAnalisis}
                puedeRevisarAnalisis={puedeRevisarAnalisis}
                rolUsuario={usuario.rol}
                enfocarChat={enfocarChat}
                onVolver={() => handleAbrirSolicitud(null)}
                onSesionInvalida={onSesionInvalida}
              />
            ) : puedeVerSolicitudes ? (
              <BandejaSolicitudes
                token={token}
                puedeChatear={puedeChatear}
                onSeleccionar={handleAbrirSolicitud}
                onSesionInvalida={onSesionInvalida}
              />
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
