import { useState, type FormEvent } from 'react';
import { login, type Sesion } from '../lib/authClient';

interface LoginProps {
  mensajeInicial?: string | null;
  onLoginSuccess: (sesion: Sesion) => void;
  onVolver: () => void;
}

export default function Login({ mensajeInicial, onLoginSuccess, onVolver }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(mensajeInicial ?? null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const sesion = await login(email.trim(), password);
      onLoginSuccess(sesion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background text-on-surface font-body-md antialiased min-h-screen flex items-center justify-center px-margin-mobile">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={onVolver}
          className="mb-6 inline-flex items-center font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL SITIO
        </button>

        <div className="bg-surface sharp-border p-8">
          <a className="font-headline-lg text-headline-lg-mobile font-black text-on-surface uppercase tracking-tighter flex items-center mb-1">
            <span>NEXT</span>
            <span className="text-primary-container">PROJECT</span>
          </a>
          <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-8">
            ÁREA PRIVADA
          </h3>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                CORREO ELECTRÓNICO
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                placeholder="correo@empresa.com"
                type="email"
              />
            </div>

            <div>
              <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                CONTRASEÑA
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                placeholder="••••••••"
                type="password"
              />
            </div>

            {error && (
              <p className="font-code-sm text-xs text-error uppercase">{error}</p>
            )}

            <button
              disabled={loading}
              type="submit"
              className="w-full inline-flex items-center justify-center px-6 py-4 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'INGRESANDO...' : 'INGRESAR'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
