// Contrato común de los proveedores de IA (patrón Strategy). Los servicios de
// negocio dependen únicamente de esta interfaz; nunca de un SDK concreto.

export type NombreProveedorIa = 'gemini' | 'openrouter';

// Esquema JSON neutral (tipos en minúscula, estilo JSON Schema). Cada proveedor
// lo adapta a su API.
export interface EsquemaJson {
  type: 'object' | 'string' | 'array';
  properties?: Record<string, EsquemaJson>;
  items?: EsquemaJson;
  enum?: string[];
  required?: string[];
}

export interface SolicitudIa {
  prompt: string;
  // Si se informa, la respuesta debe ser un JSON que cumpla este esquema.
  esquemaJson?: EsquemaJson;
  timeoutMs: number;
}

export interface RespuestaIa {
  texto: string | undefined;
  versionModelo?: string | null;
}

export interface ProveedorIa {
  readonly nombre: NombreProveedorIa;
  readonly modelo: string;
  // Nombre de la variable de entorno con la API key (solo para mensajes de error).
  readonly variableApiKey: string;
  estaConfigurado(): boolean;
  // Valor de la API key, únicamente para redactarla de mensajes de error.
  apiKey(): string;
  generar(solicitud: SolicitudIa): Promise<RespuestaIa>;
}
