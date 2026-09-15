import { useState, type FormEvent } from 'react';

interface AsistenteComercialProps {
  onIrFormulario: () => void;
}

type Paso = 'menu' | 'servicio' | 'asesor' | 'confirmado';

const FUENTES = [
  { value: 'WEB', label: 'Sitio web' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'REFERIDO', label: 'Un referido' },
  { value: 'OTRO', label: 'Otro' },
];

export default function AsistenteComercial({ onIrFormulario }: AsistenteComercialProps) {
  const [paso, setPaso] = useState<Paso>('menu');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [fuente, setFuente] = useState('WEB');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:3000/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, telefono, email: email || undefined, fuente }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || 'No se pudo registrar tu solicitud de contacto.');
      }

      setPaso('confirmado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar tu solicitud de contacto.');
    } finally {
      setEnviando(false);
    }
  }

  if (paso === 'menu') {
    return (
      <div className="space-y-4">
        <p className="font-body-md text-sm text-on-surface-variant">
          Cuéntenos qué necesita y le ayudamos a elegir el siguiente paso.
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={onIrFormulario}
            className="w-full text-left px-4 py-3 bg-surface-container-high hover:bg-outline/40 border border-outline transition-colors font-code-sm text-sm"
          >
            1. SOLICITAR COTIZACIÓN
          </button>
          <button
            type="button"
            onClick={() => setPaso('servicio')}
            className="w-full text-left px-4 py-3 bg-surface-container-high hover:bg-outline/40 border border-outline transition-colors font-code-sm text-sm"
          >
            2. CONSULTAR UN SERVICIO
          </button>
          <button
            type="button"
            onClick={() => setPaso('asesor')}
            className="w-full text-left px-4 py-3 bg-primary-container text-on-primary-container hover:bg-primary-fixed-dim transition-colors font-code-sm text-sm"
          >
            3. HABLAR CON UN ASESOR
          </button>
        </div>
      </div>
    );
  }

  if (paso === 'servicio') {
    return (
      <div className="space-y-4">
        <p className="font-body-md text-sm text-on-surface-variant">
          Trabajamos torno industrial, fresado industrial, fabricación de piezas nuevas bajo plano o muestra, y
          reparación/recuperación de componentes desgastados. Si su pieza no está en la lista, igual podemos
          evaluarla.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onIrFormulario}
            className="px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-xs uppercase hover:bg-primary-fixed-dim transition-colors cursor-pointer"
          >
            SOLICITAR COTIZACIÓN
          </button>
          <button
            type="button"
            onClick={() => setPaso('asesor')}
            className="px-4 py-2 border border-outline text-on-surface font-label-caps text-xs uppercase hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            HABLAR CON UN ASESOR
          </button>
          <button
            type="button"
            onClick={() => setPaso('menu')}
            className="px-4 py-2 text-on-surface-variant font-label-caps text-xs uppercase hover:text-on-surface transition-colors cursor-pointer"
          >
            VOLVER
          </button>
        </div>
      </div>
    );
  }

  if (paso === 'confirmado') {
    return (
      <div className="text-center py-6 space-y-3">
        <span className="material-symbols-outlined text-4xl text-primary-container">check_circle</span>
        <p className="font-body-md text-sm text-on-surface">
          Gracias, {nombre || 'recibimos tu mensaje'}. Un asesor comercial revisará tu contacto y te escribirá a la
          brevedad.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleEnviar}>
      <p className="font-body-md text-sm text-on-surface-variant">
        Déjenos sus datos y un asesor comercial le contactará.
      </p>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          type="text"
        />
      </div>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">Teléfono / WhatsApp</label>
        <input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          required
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          type="tel"
        />
      </div>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">Correo (opcional)</label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
          type="email"
        />
      </div>
      <div>
        <label className="block font-code-sm text-xs text-on-surface-variant uppercase mb-1">¿Cómo nos encontró?</label>
        <select
          value={fuente}
          onChange={(e) => setFuente(e.target.value)}
          className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none cursor-pointer"
        >
          {FUENTES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="font-code-sm text-xs text-error uppercase">{error}</p>}

      <div className="flex gap-3">
        <button
          disabled={enviando}
          type="submit"
          className="px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-xs uppercase hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
        >
          {enviando ? 'ENVIANDO...' : 'ENVIAR'}
        </button>
        <button
          type="button"
          onClick={() => setPaso('menu')}
          className="px-4 py-2 text-on-surface-variant font-label-caps text-xs uppercase hover:text-on-surface transition-colors cursor-pointer"
        >
          VOLVER
        </button>
      </div>
    </form>
  );
}
