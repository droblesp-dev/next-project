import { useEffect, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError, type Usuario } from '../lib/authClient';

interface GestionUsuariosProps {
  token: string;
  onSesionInvalida: () => void;
}

const ROLES: Usuario['rol'][] = ['ADMIN', 'COMERCIAL', 'OPERATIVO'];

export default function GestionUsuarios({ token, onSesionInvalida }: GestionUsuariosProps) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [nombreNuevo, setNombreNuevo] = useState('');
  const [emailNuevo, setEmailNuevo] = useState('');
  const [passwordNuevo, setPasswordNuevo] = useState('');
  const [rolNuevo, setRolNuevo] = useState<string>('COMERCIAL');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [accionEnCursoId, setAccionEnCursoId] = useState<string | null>(null);
  const [errorPorFila, setErrorPorFila] = useState<Record<string, string>>({});

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/usuarios', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar usuarios.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de usuarios.');
        return;
      }

      const data = (await response.json()) as { usuarios: Usuario[] };
      setUsuarios(data.usuarios);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de usuarios.');
    } finally {
      setLoadingLista(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCrear(e: FormEvent) {
    e.preventDefault();
    setMensajeCrear(null);
    setCreando(true);

    try {
      const response = await fetchAutenticado('/api/usuarios', token, {
        method: 'POST',
        body: JSON.stringify({ nombre: nombreNuevo, email: emailNuevo, password: passwordNuevo, rol: rolNuevo }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCrear(data?.message || 'No se pudo crear el usuario.');
        return;
      }

      setMensajeCrear('Usuario creado correctamente.');
      setNombreNuevo('');
      setEmailNuevo('');
      setPasswordNuevo('');
      setRolNuevo('COMERCIAL');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCrear('No se pudo crear el usuario.');
    } finally {
      setCreando(false);
    }
  }

  async function handleCambiarActivo(usuario: Usuario) {
    setAccionEnCursoId(usuario.id);
    setErrorPorFila((prev) => ({ ...prev, [usuario.id]: '' }));

    try {
      const response = await fetchAutenticado(`/api/usuarios/${usuario.id}/activo`, token, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !usuario.activo }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorPorFila((prev) => ({ ...prev, [usuario.id]: data?.message || 'No se pudo actualizar.' }));
        return;
      }

      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorPorFila((prev) => ({ ...prev, [usuario.id]: 'No se pudo actualizar.' }));
    } finally {
      setAccionEnCursoId(null);
    }
  }

  async function handleCambiarRol(usuario: Usuario, nuevoRol: string) {
    if (nuevoRol === usuario.rol) return;

    setAccionEnCursoId(usuario.id);
    setErrorPorFila((prev) => ({ ...prev, [usuario.id]: '' }));

    try {
      const response = await fetchAutenticado(`/api/usuarios/${usuario.id}/rol`, token, {
        method: 'PATCH',
        body: JSON.stringify({ rol: nuevoRol }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorPorFila((prev) => ({ ...prev, [usuario.id]: data?.message || 'No se pudo actualizar.' }));
        return;
      }

      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorPorFila((prev) => ({ ...prev, [usuario.id]: 'No se pudo actualizar.' }));
    } finally {
      setAccionEnCursoId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="bg-surface sharp-border p-6">
        <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-4">
          NUEVO USUARIO
        </h3>
        <form className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end" onSubmit={handleCrear}>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Nombre</label>
            <input
              value={nombreNuevo}
              onChange={(e) => setNombreNuevo(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="text"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Email</label>
            <input
              value={emailNuevo}
              onChange={(e) => setEmailNuevo(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="email"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Contraseña</label>
            <input
              value={passwordNuevo}
              onChange={(e) => setPasswordNuevo(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="password"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Rol</label>
            <select
              value={rolNuevo}
              onChange={(e) => setRolNuevo(e.target.value)}
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none cursor-pointer"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-4">
            <button
              disabled={creando}
              type="submit"
              className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
            >
              {creando ? 'CREANDO...' : 'CREAR USUARIO'}
            </button>
            {mensajeCrear && (
              <span className="ml-4 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</span>
            )}
          </div>
        </form>
      </div>

      <div>
        {loadingLista && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO USUARIOS...</p>
        )}
        {!loadingLista && errorLista && (
          <p className="font-code-sm text-xs text-error uppercase">{errorLista}</p>
        )}
        {!loadingLista && !errorLista && usuarios && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline">
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Nombre</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Email</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Rol</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Estado</th>
                  <th className="py-3 font-code-sm text-code-sm text-on-surface-variant uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                    <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{u.nombre}</td>
                    <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{u.email}</td>
                    <td className="py-3 pr-4">
                      <select
                        value={u.rol}
                        disabled={accionEnCursoId === u.id}
                        onChange={(e) => handleCambiarRol(u, e.target.value)}
                        className="bg-background border border-outline text-on-surface px-2 py-1 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm uppercase">
                      <span className={u.activo ? 'text-primary-container' : 'text-on-surface-variant'}>
                        {u.activo ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        disabled={accionEnCursoId === u.id}
                        onClick={() => handleCambiarActivo(u)}
                        className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-label-caps text-label-caps text-[10px] disabled:opacity-50 cursor-pointer"
                      >
                        {u.activo ? 'DESACTIVAR' : 'ACTIVAR'}
                      </button>
                      {errorPorFila[u.id] && (
                        <p className="font-code-sm text-[10px] text-error uppercase mt-1">{errorPorFila[u.id]}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
