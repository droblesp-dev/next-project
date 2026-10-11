import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { API_BASE } from '../lib/authClient';

// Página pública contextual: el prospecto llega con el enlace que le envió su
// asesor (JWT firmado, 7 días, uso único). Usa los mismos campos y reglas que
// el formulario de solicitud de la landing y NO precarga ningún dato del
// lead. El token solo viaja en la URL: el backend obtiene el lead a partir de
// él y decide cliente/estado; aquí nunca se envía ningún id.

interface SolicitudPorEnlaceProps {
  token: string;
}

type Estado = 'validando' | 'formulario' | 'enviando' | 'exito' | 'expirado' | 'invalido' | 'usado' | 'error';

const SERVICIO_PLACEHOLDER = 'SELECCIONE UN SERVICIO';
const SERVICIOS = [
  'TORNO INDUSTRIAL',
  'FRESADO INDUSTRIAL',
  'FABRICACIÓN DE PIEZA NUEVA',
  'REPARACIÓN / RECUPERACIÓN',
  'OTRO',
];

const CLASE_INPUT =
  'w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none';
const CLASE_LABEL = 'block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2';

const MENSAJES_ENLACE: Record<'expirado' | 'invalido' | 'usado', { icono: string; titulo: string; texto: string }> = {
  expirado: {
    icono: 'schedule',
    titulo: 'ENLACE EXPIRADO',
    texto: 'Este enlace ya no está vigente. Solicite uno nuevo a su asesor comercial.',
  },
  invalido: {
    icono: 'link_off',
    titulo: 'ENLACE NO VÁLIDO',
    texto: 'Este enlace no es válido. Verifique que lo copió completo o solicite uno nuevo a su asesor comercial.',
  },
  usado: {
    icono: 'task_alt',
    titulo: 'ENLACE YA UTILIZADO',
    texto: 'Este enlace ya fue utilizado o ya no está disponible. Si necesita enviar otra solicitud, contacte a su asesor comercial.',
  },
};

function estadoDesdeCodigo(status: number, code: string | undefined): Estado {
  if (status === 410 || code === 'ENLACE_EXPIRADO') return 'expirado';
  if (status === 409 || code === 'ENLACE_USADO') return 'usado';
  if (status === 401 || code === 'ENLACE_INVALIDO') return 'invalido';
  return 'error';
}

export default function SolicitudPorEnlace({ token }: SolicitudPorEnlaceProps) {
  const [estado, setEstado] = useState<Estado>('validando');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    nombre: '',
    empresa: '',
    telefono: '',
    email: '',
    servicio: SERVICIO_PLACEHOLDER,
    descripcion: '',
    cantidad: '',
    fecha: '',
  });

  useEffect(() => {
    let cancelado = false;

    async function validarEnlace() {
      try {
        const response = await fetch(`${API_BASE}/api/leads/enlace-solicitud/${encodeURIComponent(token)}`);
        if (cancelado) return;
        if (response.ok) {
          setEstado('formulario');
          return;
        }
        const data = (await response.json().catch(() => null)) as { code?: string } | null;
        setEstado(estadoDesdeCodigo(response.status, data?.code));
      } catch {
        if (!cancelado) setEstado('error');
      }
    }

    validarEnlace();
    return () => {
      cancelado = true;
    };
  }, [token]);

  function handleInputChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (formData.servicio === SERVICIO_PLACEHOLDER) {
      setSubmitError('Seleccione el tipo de servicio.');
      return;
    }

    setEstado('enviando');
    try {
      const response = await fetch(
        `${API_BASE}/api/leads/enlace-solicitud/${encodeURIComponent(token)}/solicitud`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: formData.nombre,
            empresa: formData.empresa || undefined,
            email: formData.email,
            telefono: formData.telefono,
            servicio: formData.servicio,
            descripcion: formData.descripcion,
            cantidad: Number(formData.cantidad),
            fecha_requerida: formData.fecha || undefined,
          }),
        }
      );

      if (response.ok) {
        setEstado('exito');
        return;
      }

      const data = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
      if (response.status === 400) {
        setSubmitError(data?.message || 'Revise los datos ingresados.');
        setEstado('formulario');
        return;
      }
      const siguiente = estadoDesdeCodigo(response.status, data?.code);
      if (siguiente === 'error') {
        setSubmitError('No se pudo registrar la solicitud. Intente nuevamente.');
        setEstado('formulario');
        return;
      }
      setEstado(siguiente);
    } catch {
      setSubmitError('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
      setEstado('formulario');
    }
  }

  const bloqueado = estado === 'expirado' || estado === 'invalido' || estado === 'usado';

  return (
    <div className="bg-background text-on-surface font-body-md antialiased min-h-screen flex items-center justify-center px-margin-mobile py-12">
      <div className="w-full max-w-2xl">
        <a className="font-headline-lg text-headline-lg-mobile font-black text-on-surface uppercase tracking-tighter flex items-center justify-center mb-1">
          <span>NEXT</span>
          <span className="text-primary-container">PROJECT</span>
        </a>
        <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-8 text-center">
          SOLICITAR COTIZACIÓN
        </h3>

        <div className="bg-surface sharp-border p-6 md:p-8">
          {estado === 'validando' && (
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase text-center py-8">
              VALIDANDO ENLACE...
            </p>
          )}

          {estado === 'error' && (
            <div className="text-center py-6 space-y-3">
              <span className="material-symbols-outlined text-4xl text-error" aria-hidden="true">
                error
              </span>
              <p className="font-body-md text-body-md text-on-surface">
                No se pudo validar el enlace en este momento. Intente nuevamente más tarde.
              </p>
            </div>
          )}

          {bloqueado && (
            <div className="text-center py-6 space-y-3">
              <span
                className={`material-symbols-outlined text-4xl ${estado === 'usado' ? 'text-primary-container' : 'text-error'}`}
                aria-hidden="true"
              >
                {MENSAJES_ENLACE[estado as 'expirado' | 'invalido' | 'usado'].icono}
              </span>
              <h4 className="font-label-caps text-label-caps text-on-surface uppercase">
                {MENSAJES_ENLACE[estado as 'expirado' | 'invalido' | 'usado'].titulo}
              </h4>
              <p className="font-body-md text-body-md text-on-surface-variant">
                {MENSAJES_ENLACE[estado as 'expirado' | 'invalido' | 'usado'].texto}
              </p>
            </div>
          )}

          {estado === 'exito' && (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 bg-primary-container text-on-primary-container flex items-center justify-center mx-auto">
                <span className="material-symbols-outlined text-4xl" aria-hidden="true">
                  check_circle
                </span>
              </div>
              <h4 className="font-headline-md text-headline-md text-on-surface uppercase">
                SOLICITUD REGISTRADA CON ÉXITO
              </h4>
              <p className="font-body-md text-on-surface-variant max-w-md mx-auto">
                Hemos recibido sus datos y especificaciones. Su asesor comercial revisará la información y se
                comunicará con usted a la brevedad.
              </p>
            </div>
          )}

          {(estado === 'formulario' || estado === 'enviando') && (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <p className="font-body-md text-sm text-on-surface-variant">
                Complete el formulario para que podamos evaluar su requerimiento.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <label className={CLASE_LABEL}>NOMBRE COMPLETO</label>
                  <input
                    name="nombre"
                    value={formData.nombre}
                    onChange={handleInputChange}
                    required
                    className={CLASE_INPUT}
                    placeholder="Ej. Juan Pérez"
                    type="text"
                  />
                </div>
                <div>
                  <label className={CLASE_LABEL}>EMPRESA / CLIENTE</label>
                  <input
                    name="empresa"
                    value={formData.empresa}
                    onChange={handleInputChange}
                    className={CLASE_INPUT}
                    placeholder="Nombre de la industria"
                    type="text"
                  />
                </div>
                <div>
                  <label className={CLASE_LABEL}>TELÉFONO / WHATSAPP</label>
                  <input
                    name="telefono"
                    value={formData.telefono}
                    onChange={handleInputChange}
                    required
                    className={CLASE_INPUT}
                    placeholder="Ej. 099 999 9999"
                    type="tel"
                  />
                </div>
                <div>
                  <label className={CLASE_LABEL}>CORREO ELECTRÓNICO</label>
                  <input
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className={CLASE_INPUT}
                    placeholder="correo@empresa.com"
                    type="email"
                  />
                </div>
                <div>
                  <label className={CLASE_LABEL}>CANTIDAD ESTIMADA</label>
                  <input
                    name="cantidad"
                    value={formData.cantidad}
                    onChange={handleInputChange}
                    required
                    className={CLASE_INPUT}
                    placeholder="Ej. 10 piezas"
                    type="number"
                    min="1"
                  />
                </div>
                <div>
                  <label className={CLASE_LABEL}>FECHA TENTATIVA (OPCIONAL)</label>
                  <input
                    name="fecha"
                    value={formData.fecha}
                    onChange={handleInputChange}
                    className={`${CLASE_INPUT} text-on-surface-variant [color-scheme:dark]`}
                    type="date"
                  />
                </div>
              </div>

              <div>
                <label className={CLASE_LABEL}>TIPO DE SERVICIO</label>
                <select
                  name="servicio"
                  value={formData.servicio}
                  onChange={handleInputChange}
                  className={`${CLASE_INPUT} cursor-pointer`}
                >
                  <option value={SERVICIO_PLACEHOLDER}>{SERVICIO_PLACEHOLDER}</option>
                  {SERVICIOS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={CLASE_LABEL}>DESCRIPCIÓN DEL REQUERIMIENTO</label>
                <textarea
                  name="descripcion"
                  value={formData.descripcion}
                  onChange={handleInputChange}
                  required
                  className={`${CLASE_INPUT} resize-none`}
                  placeholder="Ej.: Necesito fabricar 4 piezas iguales a una muestra que tengo."
                  rows={4}
                ></textarea>
              </div>

              {submitError && <p className="font-code-sm text-xs text-error uppercase">{submitError}</p>}

              <button
                type="submit"
                disabled={estado === 'enviando'}
                className="w-full px-6 py-4 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
              >
                {estado === 'enviando' ? 'ENVIANDO...' : 'ENVIAR SOLICITUD'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
