import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { API_BASE, fetchAutenticado, SesionInvalidaError } from '../lib/authClient';
import {
  hayCambiosSinGuardar,
  LIMITES_CUENTA_BANCARIA,
  puedeElegirLogo,
  resolverLogoVisible,
  type FormularioCuentaState,
} from '../lib/cuentasBancariasForm';

// PC-2026-01 ("Implementación completa de Gestión de Cuentas Bancarias"):
// reemplaza la pantalla de la Etapa 3 (formulario siempre abierto, sin
// catálogo de bancos ni logos) por un modal + selector de bancos con
// logos + catálogo persistente (V15) + visibilidad del titular por
// cuenta. Sigue siendo exclusiva de ADMIN (gateada en AreaPrivada.tsx,
// sin cambios ahí). Usa únicamente los endpoints reales de
// `backend/src/routes/cuentasBancarias.routes.ts` — ninguna regla de
// negocio nueva se agrega en el frontend; aquí solo se repite la
// validación mínima para dar feedback inmediato, nunca como única
// barrera.

interface CuentaBancariaProps {
  token: string;
  onSesionInvalida: () => void;
}

interface CuentaBancaria {
  id: string;
  banco: string;
  titular: string;
  tipo_cuenta: string;
  numero_cuenta: string;
  activo: boolean;
  creado_en: string;
  banco_catalogo_id: string | null;
  titular_visible_cliente: boolean;
  // logo_url es el logo EFECTIVO (propio de la cuenta o, si no tiene, el
  // heredado de su entidad); logo_propio indica cuál de los dos es (V17).
  logo_url: string | null;
  logo_propio: boolean;
}

interface BancoCatalogo {
  id: string;
  nombre: string;
  tipo: string;
  logo_url: string | null;
}

const TIPOS_CUENTA = ['AHORROS', 'CORRIENTE'] as const;
const OTRO_BANCO_VALOR = '__OTRO__';

// PC-2026-01, Fase 1: catálogo único para bancos y cooperativas de ahorro
// y crédito — el tipo solo se elige al crear una entidad NUEVA
// («Otro banco (personalizado)»); una entidad ya existente del catálogo
// conserva el tipo con el que se creó, nunca se cambia desde el
// formulario de cuenta.
const TIPOS_ENTIDAD = ['BANCO', 'COOPERATIVA'] as const;
const ETIQUETA_TIPO_ENTIDAD: Record<string, string> = { BANCO: 'Banco', COOPERATIVA: 'Cooperativa' };

const ESTADOS_FILTRO = ['TODOS', 'ACTIVO', 'INACTIVO'] as const;
type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

function claseBadgeEstado(activo: boolean): string {
  return activo
    ? 'border border-primary-container text-primary-container bg-primary-container/10'
    : 'border border-outline text-on-surface-variant';
}

function urlCompleta(logoUrl: string | null): string | null {
  return logoUrl ? `${API_BASE}${logoUrl}` : null;
}

const claseInput =
  'w-full bg-background border border-outline text-on-surface px-3 py-2.5 focus:ring-0 focus:border-primary-container transition-colors font-body-md text-sm outline-none';

// Icono genérico (Fase D: "mostrar un icono genérico cuando una entidad
// no tenga logo") — mismo set de iconos (material-symbols) ya usado en
// todo el proyecto, sin ningún asset nuevo.
//
// Corrección de legibilidad: los logos reales son apaisados (wordmarks
// horizontales, ej. Banco Pichincha) — una caja cuadrada con
// `object-contain` los reducía al ancho de la caja, dejando una franja
// delgada y poco legible. La caja ahora es el doble de ancha que de alta
// (proporción razonable para un logo bancario horizontal), consistente en
// los 3 tamaños donde se usa este componente (selector, tabla, vista
// previa del formulario) — un solo cambio aquí corrige los tres a la vez.
// `object-contain` sigue garantizando que ningún logo se deforme, recorte
// ni desborde, y conserva su proporción original. El archivo real de
// Banco Pichincha (verificado con un lector de píxeles: alpha=0 en el
// centro) tiene fondo TRANSPARENTE y texto negro — sobre el fondo oscuro
// de la app (`--color-background: #0a0a0a`) ese texto se vuelve
// prácticamente invisible. El recuadro usa un fondo claro fijo (blanco)
// solo para alojar el logo — nunca se edita ni se sustituye el archivo
// original, que sigue siendo el mismo PNG local servido por NextProject.
function LogoBancoOIcono({ logoUrl, nombre, tamano = 36 }: { logoUrl: string | null; nombre: string; tamano?: number }) {
  const ancho = tamano * 2;
  if (logoUrl) {
    return (
      <span
        style={{ width: ancho, height: tamano }}
        className="inline-flex items-center justify-center bg-white border border-outline shrink-0 p-1"
      >
        <img src={logoUrl} alt={`Logo de ${nombre}`} className="max-w-full max-h-full object-contain" />
      </span>
    );
  }
  return (
    <span
      style={{ width: ancho, height: tamano }}
      className="inline-flex items-center justify-center bg-surface-container-high border border-outline text-on-surface-variant shrink-0"
    >
      <span className="material-symbols-outlined" style={{ fontSize: tamano * 0.55 }}>
        account_balance
      </span>
    </span>
  );
}

function estadoFormularioVacio(): FormularioCuentaState {
  return {
    bancoSeleccionado: '',
    bancoPersonalizadoNombre: '',
    tipoEntidad: 'BANCO',
    titular: '',
    tipoCuenta: 'AHORROS',
    numeroCuenta: '',
    activo: true,
    titularVisibleCliente: true,
  };
}

export default function GestionCuentasBancarias({ token, onSesionInvalida }: CuentaBancariaProps) {
  const [cuentas, setCuentas] = useState<CuentaBancaria[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [bancosCatalogo, setBancosCatalogo] = useState<BancoCatalogo[] | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('TODOS');

  const [confirmandoDesactivarId, setConfirmandoDesactivarId] = useState<string | null>(null);
  const [accionEnCursoId, setAccionEnCursoId] = useState<string | null>(null);
  const [errorPorFila, setErrorPorFila] = useState<Record<string, string>>({});

  // Modal crear/editar — un solo formulario reutilizado para ambos casos
  // (no existe ningún otro modal en el proyecto que replicar; este es el
  // primero, construido con los mismos tokens visuales del resto del área
  // privada).
  const [modalAbierto, setModalAbierto] = useState<'crear' | 'editar' | null>(null);
  const [cuentaEditandoId, setCuentaEditandoId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState<FormularioCuentaState>(estadoFormularioVacio());
  const [logoArchivo, setLogoArchivo] = useState<File | null>(null);
  // Vista previa del archivo recién elegido (blob local).
  const [logoArchivoPreviewUrl, setLogoArchivoPreviewUrl] = useState<string | null>(null);
  // URL del logo PROPIO que ya tiene la cuenta que se edita (null si no tiene
  // uno propio, o al crear).
  const [logoPropioUrl, setLogoPropioUrl] = useState<string | null>(null);
  const [logoQuitado, setLogoQuitado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensajeModal, setMensajeModal] = useState<string | null>(null);
  const inputLogoRef = useRef<HTMLInputElement | null>(null);
  // Estado con el que se abrió el modal — referencia para detectar cambios sin guardar.
  const formularioInicialRef = useRef<FormularioCuentaState>(estadoFormularioVacio());

  const [mostrandoSelectorBanco, setMostrandoSelectorBanco] = useState(false);
  const [busquedaBanco, setBusquedaBanco] = useState('');

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/cuentas-bancarias', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar cuentas bancarias.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de cuentas bancarias.');
        return;
      }

      const data = (await response.json()) as { cuentas: CuentaBancaria[] };
      setCuentas(data.cuentas);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de cuentas bancarias.');
    } finally {
      setLoadingLista(false);
    }
  }

  async function cargarCatalogo() {
    setErrorCatalogo(null);
    try {
      const response = await fetchAutenticado('/api/cuentas-bancarias/catalogo-bancos', token);
      if (!response.ok) {
        setErrorCatalogo('No se pudo cargar el catálogo de bancos.');
        return;
      }
      const data = (await response.json()) as { bancos: BancoCatalogo[] };
      setBancosCatalogo(data.bancos);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorCatalogo('No se pudo cargar el catálogo de bancos.');
    }
  }

  useEffect(() => {
    cargar();
    cargarCatalogo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const bancoSeleccionadoInfo = useMemo(
    () => (bancosCatalogo ?? []).find((b) => b.id === formulario.bancoSeleccionado) ?? null,
    [bancosCatalogo, formulario.bancoSeleccionado]
  );

  const bancosFiltradosSelector = useMemo(() => {
    const termino = busquedaBanco.trim().toLowerCase();
    const lista = bancosCatalogo ?? [];
    if (!termino) return lista;
    return lista.filter((b) => b.nombre.toLowerCase().includes(termino));
  }, [bancosCatalogo, busquedaBanco]);

  // Etiqueta/placeholder del campo de entidad personalizada: debe quedar
  // claro desde la propia etiqueta (no solo el placeholder) si se está
  // pidiendo el nombre de un banco o de una cooperativa.
  const etiquetaNombrePersonalizado =
    formulario.tipoEntidad === 'COOPERATIVA' ? 'Nombre de la cooperativa' : 'Nombre del banco';

  // Descarta el archivo de logo elegido (si lo hay) y libera su vista previa.
  function reiniciarLogoElegido() {
    setLogoArchivo(null);
    if (logoArchivoPreviewUrl) URL.revokeObjectURL(logoArchivoPreviewUrl);
    setLogoArchivoPreviewUrl(null);
    if (inputLogoRef.current) inputLogoRef.current.value = '';
  }

  function abrirCrear() {
    setModalAbierto('crear');
    setCuentaEditandoId(null);
    formularioInicialRef.current = estadoFormularioVacio();
    setFormulario(estadoFormularioVacio());
    reiniciarLogoElegido();
    setLogoPropioUrl(null);
    setLogoQuitado(false);
    setMensajeModal(null);
    setBusquedaBanco('');
    setMostrandoSelectorBanco(false);
  }

  function abrirEditar(cuenta: CuentaBancaria) {
    setModalAbierto('editar');
    setCuentaEditandoId(cuenta.id);
    const cargado: FormularioCuentaState = {
      bancoSeleccionado: cuenta.banco_catalogo_id ?? '',
      bancoPersonalizadoNombre: '',
      tipoEntidad: 'BANCO',
      titular: cuenta.titular,
      tipoCuenta: cuenta.tipo_cuenta,
      numeroCuenta: cuenta.numero_cuenta,
      activo: cuenta.activo,
      titularVisibleCliente: cuenta.titular_visible_cliente,
    };
    formularioInicialRef.current = cargado;
    setFormulario(cargado);
    reiniciarLogoElegido();
    setLogoPropioUrl(cuenta.logo_propio ? urlCompleta(cuenta.logo_url) : null);
    setLogoQuitado(false);
    setMensajeModal(null);
    setBusquedaBanco('');
    setMostrandoSelectorBanco(false);
  }

  function cerrarModal() {
    setModalAbierto(null);
    setCuentaEditandoId(null);
  }

  // Qué logo se muestra (archivo nuevo > propio vigente > heredado de la
  // entidad) y si «Quitar» está disponible — ver resolverLogoVisible().
  const { previewUrl: logoPreviewUrl, puedeQuitar: puedeQuitarLogo } = resolverLogoVisible({
    editando: modalAbierto === 'editar',
    hayArchivoNuevo: logoArchivo !== null,
    archivoNuevoPreviewUrl: logoArchivoPreviewUrl,
    logoPropioUrl,
    logoQuitado,
    entidadActual: formulario.bancoSeleccionado,
    entidadInicial: formularioInicialRef.current.bancoSeleccionado,
    urlHeredada: urlCompleta(bancoSeleccionadoInfo?.logo_url ?? null),
  });

  const hayCambios =
    modalAbierto !== null &&
    hayCambiosSinGuardar(formulario, formularioInicialRef.current, {
      logoArchivo: logoArchivo !== null,
      logoQuitado,
    });

  // Cierre iniciado por el usuario (Escape, botón de cierre, clic exterior,
  // CANCELAR): si hay cambios sin guardar pide confirmación y, si el usuario
  // cancela, el modal sigue abierto con todo su contenido. Mientras se guarda
  // no se puede cerrar. El cierre tras un guardado correcto usa cerrarModal()
  // directamente (no hay nada que perder).
  function solicitarCierre() {
    if (guardando) return;
    if (hayCambios && !window.confirm('Hay cambios sin guardar. ¿Desea cerrar y descartarlos?')) return;
    cerrarModal();
  }

  // Escape a nivel de documento: funciona sin importar qué elemento tiene el
  // foco. Si el selector de bancos está desplegado, el primer Escape solo lo
  // cierra.
  useEffect(() => {
    if (!modalAbierto) return;
    function manejarTecla(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (mostrandoSelectorBanco) {
        setMostrandoSelectorBanco(false);
        return;
      }
      solicitarCierre();
    }
    document.addEventListener('keydown', manejarTecla);
    return () => document.removeEventListener('keydown', manejarTecla);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalAbierto, mostrandoSelectorBanco, hayCambios, guardando]);

  function seleccionarBanco(id: string) {
    setFormulario((prev) => ({ ...prev, bancoSeleccionado: id }));
    setMostrandoSelectorBanco(false);
    setBusquedaBanco('');
    // El logo mostrado se deriva de la entidad elegida (heredado) o del logo
    // propio de la cuenta (ver más abajo); aquí solo se descarta lo elegido.
    reiniciarLogoElegido();
    setLogoQuitado(false);
  }

  function handleSeleccionarArchivoLogo(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    if (archivo.size > 1024 * 1024) {
      setMensajeModal('El logo excede el tamaño máximo permitido (1 MB).');
      e.target.value = '';
      return;
    }
    if (archivo.type !== 'image/png' && archivo.type !== 'image/jpeg') {
      setMensajeModal('El logo debe ser un archivo PNG o JPG.');
      e.target.value = '';
      return;
    }
    setLogoArchivo(archivo);
    if (logoArchivoPreviewUrl) URL.revokeObjectURL(logoArchivoPreviewUrl);
    setLogoArchivoPreviewUrl(URL.createObjectURL(archivo));
    setLogoQuitado(false);
    setMensajeModal(null);
  }

  // «Quitar» solo actúa sobre el logo PROPIO de esta cuenta: primero descarta
  // el archivo recién elegido (si lo hay) y, si no hay ninguno, desasocia el
  // logo propio ya guardado. Nunca afecta al logo heredado de la entidad.
  function handleQuitarLogo() {
    if (logoArchivo) {
      reiniciarLogoElegido();
      return;
    }
    setLogoQuitado(true);
  }

  async function handleGuardar(e: FormEvent) {
    e.preventDefault();
    setMensajeModal(null);

    if (!formulario.bancoSeleccionado) {
      setMensajeModal('Debe seleccionar un banco.');
      return;
    }
    const esPersonalizado = formulario.bancoSeleccionado === OTRO_BANCO_VALOR;
    if (esPersonalizado && !formulario.bancoPersonalizadoNombre.trim()) {
      setMensajeModal('Escriba el nombre del banco personalizado.');
      return;
    }
    if (!formulario.titular.trim() || !formulario.numeroCuenta.trim()) {
      setMensajeModal('Titular de la cuenta y número de cuenta son obligatorios.');
      return;
    }

    const datosFormulario = new FormData();
    if (esPersonalizado) {
      datosFormulario.set('bancoPersonalizadoNombre', formulario.bancoPersonalizadoNombre.trim());
      datosFormulario.set('tipoEntidad', formulario.tipoEntidad);
    } else {
      datosFormulario.set('bancoCatalogoId', formulario.bancoSeleccionado);
    }
    datosFormulario.set('titular', formulario.titular.trim());
    datosFormulario.set('tipoCuenta', formulario.tipoCuenta);
    datosFormulario.set('numeroCuenta', formulario.numeroCuenta.trim());
    datosFormulario.set('activo', String(formulario.activo));
    datosFormulario.set('titularVisibleCliente', String(formulario.titularVisibleCliente));
    if (logoArchivo) {
      datosFormulario.set('logo', logoArchivo);
    } else if (logoQuitado) {
      datosFormulario.set('quitarLogo', 'true');
    }

    setGuardando(true);
    try {
      const esCreacion = modalAbierto === 'crear';
      const response = await fetchAutenticado(
        esCreacion ? '/api/cuentas-bancarias' : `/api/cuentas-bancarias/${cuentaEditandoId}`,
        token,
        { method: esCreacion ? 'POST' : 'PATCH', body: datosFormulario }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeModal(data?.message || 'No se pudo guardar la cuenta bancaria.');
        return;
      }

      // Estado (ACTIVA/INACTIVA) editado desde el modal: se aplica con el
      // endpoint dedicado ya existente y probado (PATCH /:id/activo),
      // reutilizando exactamente la misma regla de negocio — nunca se
      // duplica en editarCuentaBancaria().
      if (!esCreacion && cuentaEditandoId) {
        const cuentaOriginal = (cuentas ?? []).find((c) => c.id === cuentaEditandoId);
        if (cuentaOriginal && cuentaOriginal.activo !== formulario.activo) {
          await fetchAutenticado(`/api/cuentas-bancarias/${cuentaEditandoId}/activo`, token, {
            method: 'PATCH',
            body: JSON.stringify({ activo: formulario.activo }),
          });
        }
      }

      cerrarModal();
      await Promise.all([cargar(), cargarCatalogo()]);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeModal('No se pudo guardar la cuenta bancaria.');
    } finally {
      setGuardando(false);
    }
  }

  async function handleCambiarActivo(cuenta: CuentaBancaria) {
    setAccionEnCursoId(cuenta.id);
    setErrorPorFila((prev) => ({ ...prev, [cuenta.id]: '' }));

    try {
      const response = await fetchAutenticado(`/api/cuentas-bancarias/${cuenta.id}/activo`, token, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !cuenta.activo }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorPorFila((prev) => ({ ...prev, [cuenta.id]: data?.message || 'No se pudo actualizar.' }));
        return;
      }

      setConfirmandoDesactivarId(null);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorPorFila((prev) => ({ ...prev, [cuenta.id]: 'No se pudo actualizar.' }));
    } finally {
      setAccionEnCursoId(null);
    }
  }

  const filtradas = useMemo(() => {
    if (!cuentas) return [];
    const termino = busqueda.trim().toLowerCase();

    return cuentas.filter((c) => {
      if (estadoFiltro === 'ACTIVO' && !c.activo) return false;
      if (estadoFiltro === 'INACTIVO' && c.activo) return false;
      if (termino) {
        const coincide =
          c.banco.toLowerCase().includes(termino) ||
          c.titular.toLowerCase().includes(termino) ||
          c.numero_cuenta.toLowerCase().includes(termino);
        if (!coincide) return false;
      }
      return true;
    });
  }, [cuentas, busqueda, estadoFiltro]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase max-w-2xl">
          Cuentas bancarias de NextProject. El cliente solo ve las activas, y el titular solo si la cuenta lo permite.
        </p>
        <button
          type="button"
          onClick={abrirCrear}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors cursor-pointer shrink-0"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          NUEVA CUENTA BANCARIA
        </button>
      </div>

      {loadingLista && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
          CARGANDO CUENTAS BANCARIAS...
        </p>
      )}
      {!loadingLista && errorLista && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>
      )}

      {!loadingLista && !errorLista && cuentas && (
        <>
          {/* FILTROS */}
          <div className="bg-surface sharp-border p-5">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                  search
                </span>
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por banco, titular o número de cuenta…"
                  aria-label="Buscar cuentas bancarias"
                  className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                />
              </div>
              <div className="relative">
                <select
                  value={estadoFiltro}
                  onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)}
                  className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                >
                  {ESTADOS_FILTRO.map((e) => (
                    <option key={e} value={e}>
                      {e === 'TODOS' ? 'Estado: Todos' : e === 'ACTIVO' ? 'Activas' : 'Inactivas'}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                  expand_more
                </span>
              </div>
            </div>
          </div>

          {/* TABLA — desktop */}
          <div className="hidden md:block overflow-x-auto bg-surface sharp-border">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline">
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Logo</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Banco</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Titular</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Tipo</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">N.º de cuenta</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                  <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                      {cuentas.length === 0 ? 'Todavía no hay cuentas bancarias registradas.' : 'Ningún resultado coincide con estos filtros.'}
                    </td>
                  </tr>
                )}
                {filtradas.map((c) => (
                  <tr key={c.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                    <td className="py-3 px-4">
                      <LogoBancoOIcono logoUrl={urlCompleta(c.logo_url)} nombre={c.banco} tamano={32} />
                    </td>
                    <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">{c.banco}</td>
                    <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">
                      {c.titular}
                      {!c.titular_visible_cliente && (
                        <span className="block font-code-sm text-[10px] text-on-surface-variant uppercase">Oculto al cliente</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">{c.tipo_cuenta}</td>
                    <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">{c.numero_cuenta}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstado(c.activo)}`}>
                        {c.activo ? 'ACTIVA' : 'INACTIVA'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {confirmandoDesactivarId === c.id ? (
                        <div className="inline-flex flex-col items-end gap-2 text-right">
                          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant max-w-xs">
                            ¿Confirma desactivar esta cuenta? Los pagos ya registrados con esta cuenta conservarán sus datos.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={accionEnCursoId === c.id}
                              onClick={() => handleCambiarActivo(c)}
                              className="inline-flex items-center px-3 py-1 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                            >
                              {accionEnCursoId === c.id ? 'DESACTIVANDO...' : 'SÍ, DESACTIVAR'}
                            </button>
                            <button
                              type="button"
                              disabled={accionEnCursoId === c.id}
                              onClick={() => setConfirmandoDesactivarId(null)}
                              className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                            >
                              CANCELAR
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => abrirEditar(c)}
                            title="Editar"
                            aria-label="Editar cuenta bancaria"
                            className="inline-flex items-center justify-center w-9 h-9 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            type="button"
                            disabled={accionEnCursoId === c.id}
                            onClick={() => (c.activo ? setConfirmandoDesactivarId(c.id) : handleCambiarActivo(c))}
                            title={c.activo ? 'Desactivar' : 'Activar'}
                            aria-label={c.activo ? 'Desactivar cuenta bancaria' : 'Activar cuenta bancaria'}
                            className={`inline-flex items-center justify-center w-9 h-9 border transition-colors disabled:opacity-50 cursor-pointer ${
                              c.activo
                                ? 'border-outline text-on-surface hover:bg-error hover:text-on-error hover:border-error'
                                : 'border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[18px]">{c.activo ? 'toggle_on' : 'toggle_off'}</span>
                          </button>
                        </div>
                      )}
                      {errorPorFila[c.id] && confirmandoDesactivarId !== c.id && (
                        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase mt-1">{errorPorFila[c.id]}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* TARJETAS — mobile */}
          <div className="md:hidden space-y-3">
            {filtradas.length === 0 && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-6">
                {cuentas.length === 0 ? 'Todavía no hay cuentas bancarias registradas.' : 'Ningún resultado coincide con estos filtros.'}
              </p>
            )}
            {filtradas.map((c) => (
              <div key={c.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="flex items-start gap-3 min-w-0 flex-1 basis-40">
                    <LogoBancoOIcono logoUrl={urlCompleta(c.logo_url)} nombre={c.banco} tamano={32} />
                    <div className="min-w-0">
                      <p className="font-body-md text-body-md text-on-surface font-medium wrap-anywhere">{c.banco}</p>
                      <p className="font-code-sm text-[11px] text-on-surface-variant mt-0.5 wrap-anywhere">
                        {c.titular}
                        {!c.titular_visible_cliente && ' · oculto al cliente'}
                      </p>
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstado(c.activo)}`}>
                    {c.activo ? 'ACTIVA' : 'INACTIVA'}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px] wrap-anywhere">
                  <div>
                    <dt className="text-on-surface-variant uppercase">Tipo</dt>
                    <dd className="text-on-surface">{c.tipo_cuenta}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant uppercase">Número</dt>
                    <dd className="text-on-surface">{c.numero_cuenta}</dd>
                  </div>
                </dl>

                {confirmandoDesactivarId === c.id ? (
                  <div className="space-y-2 pt-1 border-t border-outline">
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                      ¿Confirma desactivar esta cuenta? Los pagos ya registrados con esta cuenta conservarán sus datos.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={accionEnCursoId === c.id}
                        onClick={() => handleCambiarActivo(c)}
                        className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        SÍ, DESACTIVAR
                      </button>
                      <button
                        type="button"
                        disabled={accionEnCursoId === c.id}
                        onClick={() => setConfirmandoDesactivarId(null)}
                        className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        CANCELAR
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline">
                    <button
                      type="button"
                      onClick={() => abrirEditar(c)}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                    >
                      EDITAR
                    </button>
                    <button
                      type="button"
                      disabled={accionEnCursoId === c.id}
                      onClick={() => (c.activo ? setConfirmandoDesactivarId(c.id) : handleCambiarActivo(c))}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {c.activo ? 'DESACTIVAR' : 'ACTIVAR'}
                    </button>
                  </div>
                )}
                {errorPorFila[c.id] && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorPorFila[c.id]}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* MODAL — crear/editar cuenta bancaria */}
      {modalAbierto && (
        <div
          className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) solicitarCierre();
          }}
        >
          <div className="bg-surface sharp-border w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-outline px-6 py-4 shrink-0">
              <div>
                <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
                  {modalAbierto === 'crear' ? 'Nueva cuenta bancaria' : 'Editar cuenta bancaria'}
                </h3>
                <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-1">
                  Los campos con * son obligatorios
                </p>
              </div>
              <button
                type="button"
                onClick={solicitarCierre}
                aria-label="Cerrar"
                className="inline-flex items-center justify-center w-9 h-9 text-on-surface-variant hover:text-on-surface cursor-pointer shrink-0"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleGuardar} className="flex flex-col min-h-0 flex-1">
              {/* Formulario en tres secciones apiladas (Entidad bancaria,
                  Datos de la cuenta, Configuración), cada una con su
                  título; cabecera y pie fijos, solo el cuerpo se desplaza. */}
              <div className="overflow-y-auto px-6 py-5 space-y-6 flex-1">
              <section className="space-y-4">
                <h4 className="flex items-center gap-2 font-code-sm text-[12px] font-semibold text-primary-container uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">account_balance</span>
                  Entidad bancaria
                </h4>
                {/* Selector de banco con logos + búsqueda + "Otro banco" */}
                <div className="relative">
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Banco *</label>
                  <button
                    type="button"
                    onClick={() => setMostrandoSelectorBanco((v) => !v)}
                    className={`${claseInput} flex items-center justify-between gap-2 cursor-pointer text-left`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {formulario.bancoSeleccionado === OTRO_BANCO_VALOR ? (
                        <>
                          <LogoBancoOIcono logoUrl={null} nombre="Otro banco" tamano={24} />
                          <span className="truncate">{formulario.bancoPersonalizadoNombre.trim() || 'Otro banco (personalizado)'}</span>
                        </>
                      ) : bancoSeleccionadoInfo ? (
                        <>
                          <LogoBancoOIcono logoUrl={urlCompleta(bancoSeleccionadoInfo.logo_url)} nombre={bancoSeleccionadoInfo.nombre} tamano={24} />
                          <span className="truncate">{bancoSeleccionadoInfo.nombre}</span>
                        </>
                      ) : (
                        <span className="text-on-surface-variant">Seleccione un banco…</span>
                      )}
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">expand_more</span>
                  </button>

                  {mostrandoSelectorBanco && (
                    <div className="absolute z-10 mt-1 w-full bg-surface sharp-border border border-outline shadow-lg">
                      <div className="p-2 border-b border-outline">
                        <input
                          type="text"
                          autoFocus
                          value={busquedaBanco}
                          onChange={(e) => setBusquedaBanco(e.target.value)}
                          placeholder="Buscar banco…"
                          className="w-full bg-background border border-outline px-3 py-2 text-sm text-on-surface outline-none focus:border-primary-container"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {errorCatalogo && <p className="p-3 font-code-sm text-xs text-error uppercase">{errorCatalogo}</p>}
                        {!errorCatalogo && bancosCatalogo === null && (
                          <p className="p-3 font-code-sm text-xs text-on-surface-variant uppercase">Cargando bancos…</p>
                        )}
                        {bancosFiltradosSelector.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => seleccionarBanco(b.id)}
                            className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-container-high transition-colors cursor-pointer ${
                              formulario.bancoSeleccionado === b.id ? 'bg-primary-container/10' : ''
                            }`}
                          >
                            <LogoBancoOIcono logoUrl={urlCompleta(b.logo_url)} nombre={b.nombre} tamano={28} />
                            <span className="text-sm text-on-surface truncate flex-1">{b.nombre}</span>
                            <span className="font-code-sm text-[10px] text-on-surface-variant uppercase shrink-0">
                              {ETIQUETA_TIPO_ENTIDAD[b.tipo] ?? b.tipo}
                            </span>
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => seleccionarBanco(OTRO_BANCO_VALOR)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-outline hover:bg-surface-container-high transition-colors cursor-pointer"
                        >
                          <span className="inline-flex items-center justify-center w-7 h-7 border border-dashed border-outline text-on-surface-variant">
                            <span className="material-symbols-outlined text-[16px]">add</span>
                          </span>
                          <span className="text-sm text-on-surface">Otro banco (personalizado)</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {formulario.bancoSeleccionado === OTRO_BANCO_VALOR && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                      <div>
                        <label
                          htmlFor="input-nombre-entidad-personalizada"
                          className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2"
                        >
                          {etiquetaNombrePersonalizado}
                        </label>
                        <input
                          id="input-nombre-entidad-personalizada"
                          type="text"
                          value={formulario.bancoPersonalizadoNombre}
                          onChange={(e) => setFormulario((prev) => ({ ...prev, bancoPersonalizadoNombre: e.target.value }))}
                          placeholder={etiquetaNombrePersonalizado}
                          required
                          maxLength={LIMITES_CUENTA_BANCARIA.bancoNombre}
                          className={claseInput}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="select-tipo-entidad-personalizada"
                          className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2"
                        >
                          Tipo
                        </label>
                        <select
                          id="select-tipo-entidad-personalizada"
                          value={formulario.tipoEntidad}
                          onChange={(e) => setFormulario((prev) => ({ ...prev, tipoEntidad: e.target.value }))}
                          className={`${claseInput} cursor-pointer`}
                        >
                          {TIPOS_ENTIDAD.map((t) => (
                            <option key={t} value={t}>
                              {ETIQUETA_TIPO_ENTIDAD[t]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Logo de la entidad</label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 border border-dashed border-outline p-3">
                    {logoPreviewUrl ? (
                      <div className="w-44 h-20 flex items-center justify-center bg-white border border-outline p-2 shrink-0">
                        <img
                          src={logoPreviewUrl}
                          alt={`Logo de ${formulario.bancoPersonalizadoNombre || 'banco'}`}
                          className="max-w-full max-h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-44 h-20 flex items-center justify-center bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
                        <span className="material-symbols-outlined text-[36px]">account_balance</span>
                      </div>
                    )}

                    <div className="flex flex-col gap-2 flex-1">
                      <input
                        ref={inputLogoRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={handleSeleccionarArchivoLogo}
                        disabled={!puedeElegirLogo(formulario.bancoSeleccionado)}
                        className="hidden"
                        id="input-logo-banco"
                      />
                      <label
                        htmlFor="input-logo-banco"
                        aria-disabled={!puedeElegirLogo(formulario.bancoSeleccionado)}
                        className={`inline-flex items-center justify-center gap-2 px-4 py-2 border border-outline text-on-surface transition-colors font-['Inter'] text-[13px] font-semibold ${
                          puedeElegirLogo(formulario.bancoSeleccionado)
                            ? 'hover:bg-surface-container-high cursor-pointer'
                            : 'opacity-40 cursor-not-allowed pointer-events-none'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px]">upload</span>
                        Cambiar logo
                      </label>
                      {!puedeElegirLogo(formulario.bancoSeleccionado) && (
                        <p className="font-code-sm text-[11px] text-on-surface-variant uppercase">
                          Seleccione primero un banco
                        </p>
                      )}
                      {puedeQuitarLogo && (
                        <button
                          type="button"
                          onClick={handleQuitarLogo}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[13px] font-semibold cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-2">Formatos: PNG, JPG (máx. 1 MB)</p>
                </div>
              </section>

              <section className="space-y-4 border-t border-outline pt-6">
                <h4 className="flex items-center gap-2 font-code-sm text-[12px] font-semibold text-primary-container uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">badge</span>
                  Datos de la cuenta
                </h4>
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Titular de la cuenta *</label>
                  <input
                    type="text"
                    required
                    value={formulario.titular}
                    maxLength={LIMITES_CUENTA_BANCARIA.titular}
                    onChange={(e) => setFormulario((prev) => ({ ...prev, titular: e.target.value }))}
                    className={claseInput}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4">
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Tipo de cuenta *</label>
                    <select
                      value={formulario.tipoCuenta}
                      onChange={(e) => setFormulario((prev) => ({ ...prev, tipoCuenta: e.target.value }))}
                      className={`${claseInput} cursor-pointer`}
                    >
                      {TIPOS_CUENTA.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Número de cuenta *</label>
                    <input
                      type="text"
                      required
                      value={formulario.numeroCuenta}
                      maxLength={LIMITES_CUENTA_BANCARIA.numeroCuenta}
                      onChange={(e) => setFormulario((prev) => ({ ...prev, numeroCuenta: e.target.value }))}
                      className={claseInput}
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4 border-t border-outline pt-6">
                <h4 className="flex items-center gap-2 font-code-sm text-[12px] font-semibold text-primary-container uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[16px]">tune</span>
                  Configuración
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-4 items-start">
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Estado *</label>
                    <select
                      value={formulario.activo ? 'ACTIVA' : 'INACTIVA'}
                      onChange={(e) => setFormulario((prev) => ({ ...prev, activo: e.target.value === 'ACTIVA' }))}
                      className={`${claseInput} cursor-pointer`}
                    >
                      <option value="ACTIVA">Activa</option>
                      <option value="INACTIVA">Inactiva</option>
                    </select>
                  </div>
                  <div>
                    <span className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Visibilidad</span>
                    <label className="flex items-start gap-3 border border-outline bg-background px-3 py-2.5 cursor-pointer select-none hover:border-primary-container transition-colors">
                      <input
                        type="checkbox"
                        checked={formulario.titularVisibleCliente}
                        onChange={(e) => setFormulario((prev) => ({ ...prev, titularVisibleCliente: e.target.checked }))}
                        className="w-4 h-4 mt-0.5 accent-primary-container cursor-pointer shrink-0"
                      />
                      <span>
                        <span className="block font-code-sm text-code-sm text-on-surface">Mostrar el titular al cliente</span>
                        <span className="block font-code-sm text-[11px] text-on-surface-variant">
                          Si se desmarca, el cliente verá la cuenta sin el nombre del titular.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </section>
              </div>

              <div className="border-t border-outline px-6 py-4 shrink-0 space-y-3">
                {mensajeModal && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{mensajeModal}</p>
                )}
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button
                    type="button"
                    disabled={guardando}
                    onClick={solicitarCierre}
                    className="inline-flex items-center justify-center px-6 py-2.5 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    CANCELAR
                  </button>
                  <button
                    type="submit"
                    disabled={guardando}
                    className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">{modalAbierto === 'crear' ? 'add' : 'save'}</span>
                    {guardando ? 'GUARDANDO...' : modalAbierto === 'crear' ? 'CREAR CUENTA BANCARIA' : 'GUARDAR CAMBIOS'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
