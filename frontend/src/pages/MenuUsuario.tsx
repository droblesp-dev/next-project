import { useEffect, useRef, useState } from 'react';
import type { Sesion, Usuario } from '../lib/authClient';
import CambiarPasswordModal from './CambiarPasswordModal';
import { etiquetaRol, obtenerIniciales, ocultarCorreo } from '../lib/perfilUsuario';

interface MenuUsuarioProps {
  usuario: Usuario;
  token: string;
  onLogout: () => void;
  onSesionInvalida: () => void;
  onSesionRenovada: (sesion: Sesion) => void;
}

// Menú de usuario del encabezado del área privada: avatar con iniciales + menú desplegable
// (identificación, «Mi perfil», «Cambiar contraseña» y «Cerrar sesión») y la ventana de solo
// lectura «Mi perfil». Solo presentación: usa los datos que ya trae la sesión y reutiliza el
// cierre de sesión existente (`onLogout`). «Cambiar contraseña» abre CambiarPasswordModal.
export default function MenuUsuario({ usuario, token, onLogout, onSesionInvalida, onSesionRenovada }: MenuUsuarioProps) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  const [passwordAbierto, setPasswordAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonAvatarRef = useRef<HTMLButtonElement>(null);
  const botonCerrarPerfilRef = useRef<HTMLButtonElement>(null);

  const iniciales = obtenerIniciales(usuario.nombre);
  const rol = etiquetaRol(usuario.rol);

  // Clic fuera del menú y Escape lo cierran; Escape devuelve el foco al avatar.
  useEffect(() => {
    if (!menuAbierto) return;
    function alPulsarFuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setMenuAbierto(false);
      }
    }
    function alPulsarTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuAbierto(false);
        botonAvatarRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', alPulsarFuera);
    document.addEventListener('keydown', alPulsarTecla);
    return () => {
      document.removeEventListener('mousedown', alPulsarFuera);
      document.removeEventListener('keydown', alPulsarTecla);
    };
  }, [menuAbierto]);

  // «Mi perfil»: Escape lo cierra, el foco entra al botón de cierre y vuelve al avatar al salir.
  useEffect(() => {
    if (!perfilAbierto) return;
    botonCerrarPerfilRef.current?.focus();
    function alPulsarTecla(e: KeyboardEvent) {
      if (e.key === 'Escape') cerrarPerfil();
    }
    document.addEventListener('keydown', alPulsarTecla);
    return () => document.removeEventListener('keydown', alPulsarTecla);
  }, [perfilAbierto]);

  function cerrarPerfil() {
    setPerfilAbierto(false);
    botonAvatarRef.current?.focus();
  }

  function abrirPerfil() {
    setMenuAbierto(false);
    setPerfilAbierto(true);
  }

  function abrirCambioPassword() {
    setMenuAbierto(false);
    setPasswordAbierto(true);
  }

  function cerrarCambioPassword() {
    setPasswordAbierto(false);
    botonAvatarRef.current?.focus();
  }

  function cerrarSesion() {
    setMenuAbierto(false);
    onLogout();
  }

  return (
    <>
      <div className="relative" ref={contenedorRef}>
        <button
          ref={botonAvatarRef}
          type="button"
          onClick={() => setMenuAbierto((abierto) => !abierto)}
          aria-haspopup="menu"
          aria-expanded={menuAbierto}
          aria-label={`Menú de usuario de ${usuario.nombre}`}
          className="inline-flex items-center gap-1 cursor-pointer group"
        >
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-background border-2 border-primary-container text-on-surface font-['Inter'] text-[14px] font-bold tracking-wide group-hover:bg-surface-container-high transition-colors">
            {iniciales}
          </span>
          <span
            className={`material-symbols-outlined text-[20px] text-on-surface-variant transition-transform ${
              menuAbierto ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </button>

        {menuAbierto && (
          <div
            role="menu"
            aria-label="Menú de usuario"
            className="absolute right-0 mt-3 w-80 max-w-[calc(100vw-2rem)] bg-surface sharp-border shadow-2xl z-50"
          >
            <div className="flex items-center gap-3 p-4 border-b border-outline">
              <span className="inline-flex items-center justify-center w-12 h-12 shrink-0 rounded-full bg-background border-2 border-primary-container text-on-surface font-['Inter'] text-[16px] font-bold">
                {iniciales}
              </span>
              <div className="min-w-0">
                <p className="font-['Inter'] text-[15px] font-semibold text-on-surface leading-tight break-words">
                  {usuario.nombre}
                </p>
                <p className="font-code-sm text-code-sm text-primary-container uppercase leading-tight mt-1">{rol}</p>
                <p className="font-code-sm text-[11px] text-on-surface-variant leading-tight mt-1 break-all">
                  {ocultarCorreo(usuario.email)}
                </p>
              </div>
            </div>

            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={abrirPerfil}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px] text-primary-container">person</span>
                Mi perfil
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={abrirCambioPassword}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px] text-primary-container">key</span>
                Cambiar contraseña
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={cerrarSesion}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-error hover:bg-error-container/20 transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer border-t border-outline mt-1"
              >
                <span className="material-symbols-outlined text-[20px]">logout</span>
                Cerrar sesión
              </button>
            </div>
          </div>
        )}
      </div>

      {passwordAbierto && (
        <CambiarPasswordModal
          usuario={usuario}
          token={token}
          onCerrar={cerrarCambioPassword}
          onSesionInvalida={onSesionInvalida}
          onSesionRenovada={onSesionRenovada}
        />
      )}

      {perfilAbierto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cerrarPerfil();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-mi-perfil"
            className="w-full max-w-md bg-surface sharp-border my-auto"
          >
            <div className="flex items-start justify-between gap-4 p-5 border-b border-outline">
              <div>
                <h2
                  id="titulo-mi-perfil"
                  className="font-['Montserrat'] text-[20px] font-black text-on-surface uppercase tracking-tight"
                >
                  Mi perfil
                </h2>
                <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-1">
                  Datos de tu cuenta — solo lectura
                </p>
              </div>
              <button
                ref={botonCerrarPerfilRef}
                type="button"
                onClick={cerrarPerfil}
                aria-label="Cerrar"
                className="inline-flex items-center justify-center w-9 h-9 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[22px]">close</span>
              </button>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-4 mb-5">
                <span className="inline-flex items-center justify-center w-16 h-16 shrink-0 rounded-full bg-background border-2 border-primary-container text-on-surface font-['Inter'] text-[22px] font-bold">
                  {iniciales}
                </span>
                <p className="font-['Inter'] text-[18px] font-semibold text-on-surface break-words min-w-0">
                  {usuario.nombre}
                </p>
              </div>

              <dl className="space-y-4">
                <div>
                  <dt className="font-code-sm text-[11px] text-on-surface-variant uppercase">Correo registrado</dt>
                  <dd className="font-['Inter'] text-[14px] text-on-surface break-all mt-1">{usuario.email}</dd>
                </div>
                <div>
                  <dt className="font-code-sm text-[11px] text-on-surface-variant uppercase">Rol</dt>
                  <dd className="font-['Inter'] text-[14px] text-primary-container font-semibold mt-1">{rol}</dd>
                </div>
                <div>
                  <dt className="font-code-sm text-[11px] text-on-surface-variant uppercase">Estado de la cuenta</dt>
                  <dd className="font-['Inter'] text-[14px] text-on-surface mt-1">
                    {usuario.activo ? 'Activa' : 'Inactiva'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex justify-end p-5 border-t border-outline">
              <button
                type="button"
                onClick={cerrarPerfil}
                className="px-5 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
              >
                CERRAR
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
