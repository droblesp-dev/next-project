import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError, type Usuario } from '../lib/authClient';

interface GestionUsuariosProps {
  token: string;
  onSesionInvalida: () => void;
}

const ROLES: Usuario['rol'][] = ['ADMIN', 'COMERCIAL', 'OPERATIVO'];

// Autorización explícita — "IMPLEMENTACIÓN AUTORIZADA — USUARIOS ADMIN
// 2.0": esta pantalla ya es exclusiva de ADMIN (gateada en
// AreaPrivada.tsx), por eso no recibe ningún prop de rol — todo lo de
// abajo aplica a la única vista que existe, sin ramas por rol.

const ROLES_FILTRO = ['TODOS', 'ADMIN', 'COMERCIAL', 'OPERATIVO'] as const;
type RolFiltro = (typeof ROLES_FILTRO)[number];

const ESTADOS_FILTRO_USUARIO = ['TODOS', 'ACTIVO', 'INACTIVO'] as const;
type EstadoFiltroUsuario = (typeof ESTADOS_FILTRO_USUARIO)[number];

// GET /api/usuarios no devuelve `creado_en` (verificado — no se modifica
// backend solo para esto). "Más recientes/antiguos" usa como proxy
// honesto la POSICIÓN real de cada usuario en la respuesta del backend,
// que ya viene ordenada `ORDER BY creado_en` ascendente
// (usuarios.repository.ts::listAll) — nunca se inventa una fecha.
type OrdenPorUsuario = 'recientes' | 'antiguos' | 'nombre_asc' | 'nombre_desc';

const REGISTROS_POR_PAGINA_OPCIONES_USUARIO = [10, 25, 50] as const;

const BADGE_ROL: Record<string, string> = {
  ADMIN: 'border border-primary-container bg-primary-container text-on-primary-container',
  COMERCIAL: 'border border-primary-container text-primary-container bg-primary-container/10',
  OPERATIVO: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
};

function claseBadgeRol(rol: string): string {
  return BADGE_ROL[rol] ?? 'border border-outline text-on-surface-variant';
}

function claseBadgeEstadoUsuario(activo: boolean): string {
  return activo
    ? 'border border-primary-container text-primary-container bg-primary-container/10'
    : 'border border-outline text-on-surface-variant';
}

function KpiUsuario({
  icono,
  valor,
  etiqueta,
  claseIcono,
  claseBorde,
}: {
  icono: string;
  valor: number;
  etiqueta: string;
  claseIcono: string;
  claseBorde: string;
}) {
  return (
    <div className={`bg-surface sharp-border p-4 border-l-4 ${claseBorde} flex items-center gap-3`}>
      <span className={`inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-full ${claseIcono}`}>
        <span className="material-symbols-outlined text-[20px]">{icono}</span>
      </span>
      <div>
        <p className="font-headline-md text-headline-md font-black text-on-surface leading-none">{valor}</p>
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase mt-1">{etiqueta}</p>
      </div>
    </div>
  );
}

export default function GestionUsuarios({ token, onSesionInvalida }: GestionUsuariosProps) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [mostrarFormularioCrear, setMostrarFormularioCrear] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [emailNuevo, setEmailNuevo] = useState('');
  const [passwordNuevo, setPasswordNuevo] = useState('');
  const [rolNuevo, setRolNuevo] = useState<string>('COMERCIAL');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [accionEnCursoId, setAccionEnCursoId] = useState<string | null>(null);
  const [errorPorFila, setErrorPorFila] = useState<Record<string, string>>({});

  const [busqueda, setBusqueda] = useState('');
  const [rolFiltro, setRolFiltro] = useState<RolFiltro>('TODOS');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltroUsuario>('TODOS');
  const [ordenPor, setOrdenPor] = useState<OrdenPorUsuario>('recientes');
  const [paginaActual, setPaginaActual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState<number>(10);

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
      setMostrarFormularioCrear(false);
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

  // Posición real de cada usuario en la respuesta del backend (ya
  // ordenada por creado_en ascendente) — único proxy honesto de
  // antigüedad disponible sin modificar el endpoint.
  const indicePorId = useMemo(() => {
    const mapa = new Map<string, number>();
    (usuarios ?? []).forEach((u, i) => mapa.set(u.id, i));
    return mapa;
  }, [usuarios]);

  const kpis = useMemo(() => {
    const base = { total: 0, activos: 0, inactivos: 0, ADMIN: 0, COMERCIAL: 0, OPERATIVO: 0 };
    if (!usuarios) return base;
    base.total = usuarios.length;
    for (const u of usuarios) {
      if (u.activo) base.activos += 1;
      else base.inactivos += 1;
      if (u.rol in base) {
        (base as Record<string, number>)[u.rol] += 1;
      }
    }
    return base;
  }, [usuarios]);

  const filtrados = useMemo(() => {
    if (!usuarios) return [];
    const termino = busqueda.trim().toLowerCase();

    return usuarios.filter((u) => {
      if (rolFiltro !== 'TODOS' && u.rol !== rolFiltro) return false;
      if (estadoFiltro === 'ACTIVO' && !u.activo) return false;
      if (estadoFiltro === 'INACTIVO' && u.activo) return false;

      if (termino) {
        const coincide = u.nombre.toLowerCase().includes(termino) || u.email.toLowerCase().includes(termino);
        if (!coincide) return false;
      }

      return true;
    });
  }, [usuarios, busqueda, rolFiltro, estadoFiltro]);

  const ordenados = useMemo(() => {
    const copia = [...filtrados];
    copia.sort((a, b) => {
      if (ordenPor === 'nombre_asc') return a.nombre.localeCompare(b.nombre);
      if (ordenPor === 'nombre_desc') return b.nombre.localeCompare(a.nombre);
      const diferencia = (indicePorId.get(a.id) ?? 0) - (indicePorId.get(b.id) ?? 0);
      return ordenPor === 'recientes' ? -diferencia : diferencia;
    });
    return copia;
  }, [filtrados, ordenPor, indicePorId]);

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / registrosPorPagina));
  const paginaEfectiva = Math.min(paginaActual, totalPaginas);
  const datosPagina = useMemo(() => {
    const inicio = (paginaEfectiva - 1) * registrosPorPagina;
    return ordenados.slice(inicio, inicio + registrosPorPagina);
  }, [ordenados, paginaEfectiva, registrosPorPagina]);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, rolFiltro, estadoFiltro, ordenPor, registrosPorPagina]);

  function limpiarFiltros() {
    setBusqueda('');
    setRolFiltro('TODOS');
    setEstadoFiltro('TODOS');
    setOrdenPor('recientes');
  }

  const hayFiltrosActivos =
    busqueda.trim() !== '' || rolFiltro !== 'TODOS' || estadoFiltro !== 'TODOS' || ordenPor !== 'recientes';

  const paginasVisibles = useMemo(() => {
    const paginas: (number | 'ellipsis')[] = [];
    const ventana = 1;
    for (let p = 1; p <= totalPaginas; p++) {
      if (p === 1 || p === totalPaginas || (p >= paginaEfectiva - ventana && p <= paginaEfectiva + ventana)) {
        paginas.push(p);
      } else if (paginas[paginas.length - 1] !== 'ellipsis') {
        paginas.push('ellipsis');
      }
    }
    return paginas;
  }, [totalPaginas, paginaEfectiva]);

  return (
    <div className="space-y-8">
      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase max-w-2xl">
        Administración y control de las cuentas de acceso de NextProject.
      </p>

      {loadingLista && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO USUARIOS...</p>
      )}
      {!loadingLista && errorLista && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>}

      {!loadingLista && !errorLista && usuarios && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <KpiUsuario
              icono="groups"
              valor={kpis.total}
              etiqueta="Total"
              claseIcono="bg-surface-container-high text-on-surface"
              claseBorde="border-l-outline"
            />
            <KpiUsuario
              icono="check_circle"
              valor={kpis.activos}
              etiqueta="Activos"
              claseIcono="bg-primary-container text-on-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiUsuario
              icono="block"
              valor={kpis.inactivos}
              etiqueta="Inactivos"
              claseIcono="bg-surface-container-high text-on-surface-variant"
              claseBorde="border-l-outline"
            />
            <KpiUsuario
              icono="admin_panel_settings"
              valor={kpis.ADMIN}
              etiqueta="Admin"
              claseIcono="bg-primary-container/20 text-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiUsuario
              icono="storefront"
              valor={kpis.COMERCIAL}
              etiqueta="Comercial"
              claseIcono="bg-primary-container/20 text-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiUsuario
              icono="engineering"
              valor={kpis.OPERATIVO}
              etiqueta="Operativo"
              claseIcono="bg-outline-variant/30 text-on-surface-variant"
              claseBorde="border-l-outline-variant"
            />
          </div>

          {/* CREACIÓN — compacta, expandible */}
          <div className="bg-surface sharp-border p-6">
            <button
              type="button"
              onClick={() => setMostrarFormularioCrear((v) => !v)}
              className="w-full flex items-center justify-between font-['Inter'] text-[14px] font-semibold text-primary-container tracking-widest uppercase cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {mostrarFormularioCrear ? 'remove' : 'add'}
                </span>
                NUEVO USUARIO
              </span>
            </button>

            {mostrarFormularioCrear && (
              <form className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mt-4 pt-4 border-t border-outline" onSubmit={handleCrear}>
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
                    className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {creando ? 'CREANDO...' : 'CREAR USUARIO'}
                  </button>
                  {mensajeCrear && (
                    <span className="ml-4 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</span>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* FILTROS */}
          <div className="bg-surface sharp-border p-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_160px_170px] gap-4">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                  search
                </span>
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre o email…"
                  className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                />
              </div>
              <div className="relative">
                <select
                  value={rolFiltro}
                  onChange={(e) => setRolFiltro(e.target.value as RolFiltro)}
                  className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                >
                  {ROLES_FILTRO.map((r) => (
                    <option key={r} value={r}>
                      {r === 'TODOS' ? 'Rol: Todos' : r}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                  expand_more
                </span>
              </div>
              <div className="relative">
                <select
                  value={estadoFiltro}
                  onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltroUsuario)}
                  className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                >
                  {ESTADOS_FILTRO_USUARIO.map((e) => (
                    <option key={e} value={e}>
                      {e === 'TODOS' ? 'Estado: Todos' : e}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                  expand_more
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end">
              <div>
                <label className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">
                  Ordenar por
                </label>
                <div className="relative w-full sm:w-64">
                  <select
                    value={ordenPor}
                    onChange={(e) => setOrdenPor(e.target.value as OrdenPorUsuario)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    <option value="recientes">Más recientes</option>
                    <option value="antiguos">Más antiguos</option>
                    <option value="nombre_asc">Nombre A-Z</option>
                    <option value="nombre_desc">Nombre Z-A</option>
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={limpiarFiltros}
                disabled={!hayFiltrosActivos}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                LIMPIAR FILTROS
              </button>
            </div>
          </div>

          {/* TABLA — desktop */}
          <div className="hidden md:block overflow-x-auto bg-surface sharp-border">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline">
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Usuario</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Email</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Rol</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody>
                {datosPagina.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                      Ningún resultado coincide con estos filtros.
                    </td>
                  </tr>
                )}
                {datosPagina.map((u) => (
                  <tr key={u.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                    <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{u.nombre}</td>
                    <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{u.email}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex px-2 py-0.5 font-code-sm text-[10px] uppercase ${claseBadgeRol(u.rol)}`}>
                          {u.rol}
                        </span>
                        <select
                          value={u.rol}
                          disabled={accionEnCursoId === u.id}
                          onChange={(e) => handleCambiarRol(u, e.target.value)}
                          className="bg-background border border-outline text-on-surface px-2 py-1 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-[10px] outline-none cursor-pointer disabled:opacity-50"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2.5 py-1 font-code-sm text-[10px] uppercase ${claseBadgeEstadoUsuario(u.activo)}`}>
                        {u.activo ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        disabled={accionEnCursoId === u.id}
                        onClick={() => handleCambiarActivo(u)}
                        className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        {u.activo ? 'DESACTIVAR' : 'ACTIVAR'}
                      </button>
                      {errorPorFila[u.id] && (
                        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase mt-1">{errorPorFila[u.id]}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* TABLA — mobile (tarjetas) */}
          <div className="md:hidden space-y-3">
            {datosPagina.length === 0 && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-6">
                Ningún resultado coincide con estos filtros.
              </p>
            )}
            {datosPagina.map((u) => (
              <div key={u.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-body-md text-body-md text-on-surface font-medium">{u.nombre}</p>
                    <p className="font-code-sm text-[11px] text-on-surface-variant mt-0.5 break-all">{u.email}</p>
                  </div>
                  <span className={`inline-flex shrink-0 px-2.5 py-1 font-code-sm text-[10px] uppercase ${claseBadgeEstadoUsuario(u.activo)}`}>
                    {u.activo ? 'ACTIVO' : 'INACTIVO'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`inline-flex px-2 py-0.5 font-code-sm text-[10px] uppercase ${claseBadgeRol(u.rol)}`}>
                    {u.rol}
                  </span>
                  <select
                    value={u.rol}
                    disabled={accionEnCursoId === u.id}
                    onChange={(e) => handleCambiarRol(u, e.target.value)}
                    className="flex-1 bg-background border border-outline text-on-surface px-2 py-1.5 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-[11px] outline-none cursor-pointer disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end pt-1 border-t border-outline">
                  <button
                    type="button"
                    disabled={accionEnCursoId === u.id}
                    onClick={() => handleCambiarActivo(u)}
                    className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {u.activo ? 'DESACTIVAR' : 'ACTIVAR'}
                  </button>
                </div>
                {errorPorFila[u.id] && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorPorFila[u.id]}</p>
                )}
              </div>
            ))}
          </div>

          {/* PAGINACIÓN */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-surface sharp-border p-4">
            <div className="flex items-center gap-3">
              <span className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                Mostrando {ordenados.length === 0 ? 0 : (paginaEfectiva - 1) * registrosPorPagina + 1}–
                {Math.min(paginaEfectiva * registrosPorPagina, ordenados.length)} de {ordenados.length} usuarios
              </span>
              <div className="relative">
                <select
                  value={registrosPorPagina}
                  onChange={(e) => setRegistrosPorPagina(Number(e.target.value))}
                  className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
                >
                  {REGISTROS_POR_PAGINA_OPCIONES_USUARIO.map((n) => (
                    <option key={n} value={n}>
                      {n} por página
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant">
                  expand_more
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={paginaEfectiva <= 1}
                onClick={() => setPaginaActual(paginaEfectiva - 1)}
                className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>

              {paginasVisibles.map((p, idx) =>
                p === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="px-1 font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPaginaActual(p)}
                    className={`inline-flex items-center justify-center w-8 h-8 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
                      p === paginaEfectiva
                        ? 'bg-primary-container text-on-primary-container'
                        : 'border border-outline text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

              <button
                type="button"
                disabled={paginaEfectiva >= totalPaginas}
                onClick={() => setPaginaActual(paginaEfectiva + 1)}
                className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
