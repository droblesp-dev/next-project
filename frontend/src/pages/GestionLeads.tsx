import { useEffect, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError, type Usuario } from '../lib/authClient';

export interface Lead {
  id: string;
  nombre: string;
  telefono: string;
  email: string | null;
  fuente: string;
  estado: string;
  clasificacion: string;
  comercial_id: string | null;
  cliente_id: string | null;
  solicitud_id: string | null;
  ultimo_contacto: string | null;
  proximo_seguimiento: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface LeadSeguimiento {
  id: string;
  lead_id: string;
  comercial_id: string | null;
  tipo: string;
  observacion: string | null;
  fecha: string;
}

const TIPOS_SEGUIMIENTO = ['LLAMADA', 'WHATSAPP', 'EMAIL', 'VISITA', 'OTRO'];

interface GestionLeadsProps {
  token: string;
  esAdmin: boolean;
  onSesionInvalida: () => void;
}

export default function GestionLeads({ token, esAdmin, onSesionInvalida }: GestionLeadsProps) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [leadSeleccionado, setLeadSeleccionado] = useState<Lead | null>(null);
  const [mensajeAccion, setMensajeAccion] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  const [clienteIdInput, setClienteIdInput] = useState('');
  const [solicitudIdInput, setSolicitudIdInput] = useState('');
  const [tipoSeguimientoInput, setTipoSeguimientoInput] = useState('LLAMADA');
  const [observacionInput, setObservacionInput] = useState('');

  const [seguimientos, setSeguimientos] = useState<LeadSeguimiento[] | null>(null);
  const [loadingSeguimientos, setLoadingSeguimientos] = useState(false);

  const [comerciales, setComerciales] = useState<Usuario[] | null>(null);
  const [comercialElegido, setComercialElegido] = useState('');

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/leads', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar leads.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de leads.');
        return;
      }

      const data = (await response.json()) as { leads: Lead[] };
      setLeads(data.leads);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de leads.');
    } finally {
      setLoadingLista(false);
    }
  }

  async function cargarComerciales() {
    try {
      const response = await fetchAutenticado('/api/usuarios', token);
      if (!response.ok) return;
      const data = (await response.json()) as { usuarios: Usuario[] };
      setComerciales(data.usuarios.filter((u) => u.rol === 'COMERCIAL' && u.activo));
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  useEffect(() => {
    cargar();
    if (esAdmin) {
      cargarComerciales();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, esAdmin]);

  async function cargarSeguimientos(id: string) {
    setLoadingSeguimientos(true);
    try {
      const response = await fetchAutenticado(`/api/leads/${id}/seguimientos`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { seguimientos: LeadSeguimiento[] };
      setSeguimientos(data.seguimientos);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    } finally {
      setLoadingSeguimientos(false);
    }
  }

  async function abrirDetalle(id: string) {
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { lead: Lead };
      setLeadSeleccionado(data.lead);
      setClienteIdInput(data.lead.cliente_id ?? '');
      setSolicitudIdInput(data.lead.solicitud_id ?? '');
      setComercialElegido(data.lead.comercial_id ?? '');
      await cargarSeguimientos(id);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function patchLead(id: string, body: Record<string, unknown>, onExito?: (lead: Lead) => void) {
    setProcesando(true);
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensajeAccion(data?.message || 'No se pudo actualizar el lead.');
        return;
      }
      setLeadSeleccionado(data.lead as Lead);
      onExito?.(data.lead as Lead);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAccion('No se pudo actualizar el lead.');
    } finally {
      setProcesando(false);
    }
  }

  async function handleVincularCliente(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado || !clienteIdInput.trim()) return;
    await patchLead(leadSeleccionado.id, { cliente_id: clienteIdInput.trim() });
  }

  async function handleVincularSolicitud(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado || !solicitudIdInput.trim()) return;
    await patchLead(leadSeleccionado.id, { solicitud_id: solicitudIdInput.trim() });
  }

  async function handleMarcarConvertido() {
    if (!leadSeleccionado) return;
    await patchLead(leadSeleccionado.id, { clasificacion: 'CONVERTIDO' });
  }

  async function handleMarcarRecurrente() {
    if (!leadSeleccionado) return;
    await patchLead(leadSeleccionado.id, { clasificacion: 'RECURRENTE' });
  }

  async function handleDescartar() {
    if (!leadSeleccionado) return;
    await patchLead(leadSeleccionado.id, { estado: 'DESCARTADO' });
  }

  async function handleRegistrarSeguimiento(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado) return;
    setProcesando(true);
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${leadSeleccionado.id}/seguimientos`, token, {
        method: 'POST',
        body: JSON.stringify({
          tipo: tipoSeguimientoInput,
          observacion: observacionInput || undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensajeAccion(data?.message || 'No se pudo registrar el seguimiento.');
        return;
      }
      setLeadSeleccionado(data.lead as Lead);
      setObservacionInput('');
      await cargarSeguimientos(leadSeleccionado.id);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAccion('No se pudo registrar el seguimiento.');
    } finally {
      setProcesando(false);
    }
  }

  async function handleAsignar(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado || !comercialElegido) return;
    setProcesando(true);
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${leadSeleccionado.id}/asignar`, token, {
        method: 'PATCH',
        body: JSON.stringify({ comercial_id: comercialElegido }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensajeAccion(data?.message || 'No se pudo asignar el comercial.');
        return;
      }
      setLeadSeleccionado(data.lead as Lead);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAccion('No se pudo asignar el comercial.');
    } finally {
      setProcesando(false);
    }
  }

  if (leadSeleccionado) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setLeadSeleccionado(null);
            setMensajeAccion(null);
            setSeguimientos(null);
          }}
          className="mb-6 inline-flex items-center font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-4">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase">{leadSeleccionado.nombre}</h3>
            <div className="text-right">
              <span className="font-code-sm text-code-sm text-primary-container uppercase block">
                {leadSeleccionado.clasificacion}
              </span>
              <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                {leadSeleccionado.estado}
              </span>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
            <div>
              <dt className="text-on-surface-variant uppercase">Teléfono</dt>
              <dd className="text-on-surface">{leadSeleccionado.telefono}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Email</dt>
              <dd className="text-on-surface">{leadSeleccionado.email ?? 'No especificado'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Fuente</dt>
              <dd className="text-on-surface">{leadSeleccionado.fuente}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Comercial asignado</dt>
              <dd className="text-on-surface break-all">{leadSeleccionado.comercial_id ?? 'Sin asignar'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Cliente vinculado</dt>
              <dd className="text-on-surface break-all">{leadSeleccionado.cliente_id ?? 'Sin vincular'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Solicitud vinculada</dt>
              <dd className="text-on-surface break-all">{leadSeleccionado.solicitud_id ?? 'Sin vincular'}</dd>
            </div>
          </dl>

          {mensajeAccion && (
            <p className="font-code-sm text-xs text-on-surface-variant uppercase">{mensajeAccion}</p>
          )}

          {leadSeleccionado.estado !== 'DESCARTADO' && (
            <div className="border-t border-outline pt-4 space-y-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Vincular cliente</p>
              <form className="flex flex-wrap gap-3 items-end" onSubmit={handleVincularCliente}>
                <input
                  value={clienteIdInput}
                  onChange={(e) => setClienteIdInput(e.target.value)}
                  placeholder="UUID del cliente"
                  className="bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                />
                <button
                  disabled={procesando}
                  type="submit"
                  className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                >
                  VINCULAR
                </button>
              </form>

              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Vincular solicitud</p>
              <form className="flex flex-wrap gap-3 items-end" onSubmit={handleVincularSolicitud}>
                <input
                  value={solicitudIdInput}
                  onChange={(e) => setSolicitudIdInput(e.target.value)}
                  placeholder="UUID de la solicitud"
                  className="bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                />
                <button
                  disabled={procesando}
                  type="submit"
                  className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                >
                  VINCULAR
                </button>
              </form>

              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Registrar seguimiento</p>
              <form className="space-y-3" onSubmit={handleRegistrarSeguimiento}>
                <select
                  value={tipoSeguimientoInput}
                  onChange={(e) => setTipoSeguimientoInput(e.target.value)}
                  className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
                >
                  {TIPOS_SEGUIMIENTO.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <textarea
                  value={observacionInput}
                  onChange={(e) => setObservacionInput(e.target.value)}
                  placeholder="Observación del contacto"
                  rows={2}
                  className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md resize-none outline-none"
                />
                <button
                  disabled={procesando}
                  type="submit"
                  className="px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  REGISTRAR CONTACTO
                </button>
              </form>

              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mt-4">Historial de seguimientos</p>
              {loadingSeguimientos && (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO...</p>
              )}
              {!loadingSeguimientos && seguimientos && seguimientos.length === 0 && (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Sin seguimientos registrados todavía.</p>
              )}
              {!loadingSeguimientos && seguimientos && seguimientos.length > 0 && (
                <div className="space-y-2">
                  {seguimientos.map((s) => (
                    <div key={s.id} className="bg-background border border-outline p-3">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-code-sm text-code-sm text-primary-container uppercase">{s.tipo}</span>
                        <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                          {new Date(s.fecha).toLocaleString()}
                        </span>
                      </div>
                      {s.observacion && (
                        <p className="font-body-md text-body-md text-on-surface">{s.observacion}</p>
                      )}
                      <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mt-1 break-all">
                        Registrado por: {s.comercial_id ?? 'Desconocido'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                {leadSeleccionado.clasificacion === 'CALIENTE' && (
                  <button
                    type="button"
                    disabled={procesando}
                    onClick={handleMarcarConvertido}
                    className="px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                  >
                    MARCAR CONVERTIDO
                  </button>
                )}
                {leadSeleccionado.clasificacion === 'CONVERTIDO' && (
                  <button
                    type="button"
                    disabled={procesando}
                    onClick={handleMarcarRecurrente}
                    className="px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                  >
                    MARCAR RECURRENTE
                  </button>
                )}
                <button
                  type="button"
                  disabled={procesando}
                  onClick={handleDescartar}
                  className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                >
                  DESCARTAR LEAD
                </button>
              </div>

              {esAdmin && (
                <div className="border-t border-outline pt-4">
                  <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Asignar comercial</p>
                  <form className="flex flex-wrap items-end gap-3" onSubmit={handleAsignar}>
                    <select
                      value={comercialElegido}
                      onChange={(e) => setComercialElegido(e.target.value)}
                      className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
                    >
                      <option value="">Seleccione un COMERCIAL activo</option>
                      {(comerciales ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={procesando || !comercialElegido}
                      type="submit"
                      className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      ASIGNAR
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {loadingLista && (
        <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO LEADS...</p>
      )}
      {!loadingLista && errorLista && (
        <p className="font-code-sm text-xs text-error uppercase">{errorLista}</p>
      )}
      {!loadingLista && !errorLista && leads && leads.length === 0 && (
        <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">NO HAY LEADS REGISTRADOS.</p>
      )}
      {!loadingLista && !errorLista && leads && leads.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-outline">
                <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Nombre</th>
                <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Fuente</th>
                <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Clasificación</th>
                <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Estado</th>
                <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Creado</th>
                <th className="py-3 font-code-sm text-code-sm text-on-surface-variant uppercase"></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                  <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{l.nombre}</td>
                  <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">{l.fuente}</td>
                  <td className="py-3 pr-4 font-code-sm text-code-sm text-primary-container uppercase">{l.clasificacion}</td>
                  <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">{l.estado}</td>
                  <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant">
                    {new Date(l.creado_en).toLocaleDateString()}
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      onClick={() => abrirDetalle(l.id)}
                      className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-label-caps text-label-caps text-[10px] cursor-pointer"
                    >
                      VER DETALLE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
