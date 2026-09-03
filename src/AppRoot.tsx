import { useEffect, useState } from 'react';
import App from './App';
import Login from './pages/Login';
import AreaPrivada from './pages/AreaPrivada';
import {
  guardarSesion,
  leerSesionGuardada,
  limpiarSesion,
  obtenerMe,
  SesionInvalidaError,
  type Sesion,
} from './lib/authClient';

type Vista = 'validando' | 'publico' | 'login' | 'privado';

export default function AppRoot() {
  const [vista, setVista] = useState<Vista>('validando');
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [mensajeLogin, setMensajeLogin] = useState<string | null>(null);

  // Al cargar la aplicación, intenta recuperar una sesión previa guardada
  // en sessionStorage y la valida contra GET /api/auth/me. Si ya no es
  // válida, se limpia en silencio (el usuario no inició esta acción, así
  // que no se le muestra ningún mensaje de error) y queda en la landing.
  useEffect(() => {
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

  if (vista === 'validando') {
    return (
      <div className="bg-background min-h-screen flex items-center justify-center">
        <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO...</p>
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
