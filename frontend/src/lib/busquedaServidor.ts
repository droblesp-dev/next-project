import { useEffect, useRef, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from './authClient';

// Búsqueda parcial resuelta en la base de datos (GET /api/busqueda/:entidad?q=): devuelve los ids de
// TODAS las filas que contienen el término, sin distinguir mayúsculas ni tildes. Cada listado
// conserva sus propios filtros (estado, fechas, orden…) y solo se queda con las filas cuyo id vino
// en la respuesta.

export type EntidadBusqueda = 'solicitudes' | 'cotizaciones' | 'ordenes' | 'alertas' | 'leads' | 'usuarios';

// Espera tras la última tecla antes de consultar al servidor.
export const ESPERA_BUSQUEDA_MS = 300;

export async function buscarIdsEnServidor(entidad: EntidadBusqueda, termino: string, token: string): Promise<Set<string>> {
  const response = await fetchAutenticado(`/api/busqueda/${entidad}?q=${encodeURIComponent(termino)}`, token);
  if (!response.ok) {
    throw new Error(`La búsqueda falló (${response.status}).`);
  }
  const data = (await response.json()) as { ids: string[] };
  return new Set(data.ids);
}

interface ResultadoBusqueda {
  termino: string;
  ids: Set<string>;
}

// Resultado de la búsqueda en el servidor para el término actual, o null mientras llega (o si falla).
// Mientras es null, cada pantalla sigue filtrando con su coincidencia local, de modo que el listado
// nunca queda vacío ni muestra resultados de un término anterior.
export function useBusquedaServidor(
  entidad: EntidadBusqueda,
  busqueda: string,
  token: string,
  onSesionInvalida?: () => void
): Set<string> | null {
  const termino = busqueda.trim();
  const [resultado, setResultado] = useState<ResultadoBusqueda | null>(null);
  // El callback puede cambiar de identidad en cada render del padre: se guarda en una referencia para
  // que no reinicie la búsqueda (ni provoque consultas repetidas).
  const alSesionInvalida = useRef(onSesionInvalida);
  alSesionInvalida.current = onSesionInvalida;

  useEffect(() => {
    if (termino === '') {
      setResultado(null);
      return;
    }

    let cancelado = false;
    const temporizador = setTimeout(async () => {
      try {
        const ids = await buscarIdsEnServidor(entidad, termino, token);
        if (!cancelado) setResultado({ termino, ids });
      } catch (err) {
        if (err instanceof SesionInvalidaError) {
          alSesionInvalida.current?.();
          return;
        }
        if (!cancelado) setResultado(null);
      }
    }, ESPERA_BUSQUEDA_MS);

    return () => {
      cancelado = true;
      clearTimeout(temporizador);
    };
  }, [entidad, termino, token]);

  return resultado !== null && resultado.termino === termino ? resultado.ids : null;
}
