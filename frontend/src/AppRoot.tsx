import { useEffect, useState } from 'react';
import App from './App';
import Login from './pages/Login';
import AreaPrivada from './pages/AreaPrivada';
import VistaCotizacionPublica from './pages/VistaCotizacionPublica';
import SolicitudPorEnlace from './pages/SolicitudPorEnlace';
import {
  guardarSesion,
  leerSesionGuardada,
  limpiarSesion,
  obtenerMe,
  SesionInvalidaError,
  type Sesion,
} from './lib/authClient';

type Vista = 'validando' | 'publico' | 'login' | 'privado' | 'cotizacion-publica' | 'solicitud-enlace';

// Sin router: se detecta la ruta de la vista pública de cotización
// directamente sobre window.location, igual de válido para esta única
// pantalla standalone (Fase C, decisión explícita de no instalar
// react-router solo para esto). Cualquier otra ruta sigue el flujo normal
// (landing/login/área privada), sin cambios.
function extraerTokenCotizacionPublica(): string | null {
  const match = window.location.pathname.match(/^\/cotizacion\/publica\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Misma técnica para el enlace de solicitud que un comercial envía a un lead
// TIBIO (/solicitud/enlace/<token>): página pública sin sesión.
function extraerTokenSolicitudEnlace(): string | null {
  const match = window.location.pathname.match(/^\/solicitud\/enlace\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function AppRoot() {
  const [tokenCotizacionPublica] = useState<string | null>(extraerTokenCotizacionPublica);
  const [tokenSolicitudEnlace] = useState<string | null>(extraerTokenSolicitudEnlace);
  const [vista, setVista] = useState<Vista>(
    tokenCotizacionPublica ? 'cotizacion-publica' : tokenSolicitudEnlace ? 'solicitud-enlace' : 'validando'
  );
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [mensajeLogin, setMensajeLogin] = useState<string | null>(null);

  // Al cargar la aplicación, intenta recuperar una sesión previa guardada
  // en sessionStorage y la valida contra GET /api/auth/me. Si ya no es
  // válida, se limpia en silencio (el usuario no inició esta acción, así
  // que no se le muestra ningún mensaje de error) y queda en la landing.
  // La vista pública de cotización no requiere (ni intenta) ninguna
  // sesión de usuario — se omite por completo este chequeo en ese caso.
  useEffect(() => {
    if (tokenCotizacionPublica || tokenSolicitudEnlace) {
      return;
    }

    const guardada = leerSesionGuardada();

    if (!guardada) {
      setVista('publico');
      return;
    }

    obtenerMe(guardada.token)
      .then((usuario) => {
        const sesionActualizada = { token: guardada.token, usuario };
        guardarSesion(sesionActualizada);
        setSesion(sesionActualizada);
        setVista('privado');
      })
      .catch(() => {
        limpiarSesion();
        setVista('publico');
      });
  }, []);

  function handleLoginSuccess(nuevaSesion: Sesion) {
    guardarSesion(nuevaSesion);
    setSesion(nuevaSesion);
    setMensajeLogin(null);
    setVista('privado');
  }

  function handleLogout() {
    limpiarSesion();
    setSesion(null);
    setVista('publico');
  }

  // Se invoca desde el área privada cuando una llamada autenticada
  // devuelve 401 en pleno uso (token vencido o inválido durante la
  // sesión activa): se limpia y se regresa a login con aviso.
  function handleSesionInvalida() {
    limpiarSesion();
    setSesion(null);
    setMensajeLogin('Sesión expirada o inválida. Inicie sesión nuevamente.');
    setVista('login');
  }

  if (vista === 'cotizacion-publica' && tokenCotizacionPublica) {
    return <VistaCotizacionPublica token={tokenCotizacionPublica} />;
  }

  if (vista === 'solicitud-enlace' && tokenSolicitudEnlace) {
    return <SolicitudPorEnlace token={tokenSolicitudEnlace} />;
  }

  if (vista === 'validando') {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO...</p>
      </div>
    );
  }

  if (vista === 'login') {
    return (
      <Login
        mensajeInicial={mensajeLogin}
        onLoginSuccess={handleLoginSuccess}
        onVolver={() => setVista('publico')}
      />
    );
  }

  if (vista === 'privado' && sesion) {
    return (
      <AreaPrivada
        usuario={sesion.usuario}
        token={sesion.token}
        onLogout={handleLogout}
        onSesionInvalida={handleSesionInvalida}
      />
    );
  }

  return <App onAcceso={() => setVista('login')} />;
}
