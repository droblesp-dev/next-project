// Documentación OpenAPI (Swagger) de NextProject. Solo describe endpoints REALMENTE implementados
// (CLAUDE.md §16): hoy, el cambio de contraseña (Fase 2C). Se irá ampliando al documentar otras
// áreas. Se sirve en /api-docs únicamente fuera de producción (ver server.ts).
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'NextProject API',
    version: '0.1.0',
    description: 'API de NextProject. Documentación parcial: solo los endpoints indicados.',
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Usuario: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          nombre: { type: 'string' },
          email: { type: 'string', format: 'email' },
          activo: { type: 'boolean' },
          rol: { type: 'string', enum: ['ADMIN', 'COMERCIAL', 'OPERATIVO'] },
        },
      },
      CambioPasswordRequest: {
        type: 'object',
        required: ['passwordActual', 'passwordNueva', 'confirmacion'],
        properties: {
          passwordActual: { type: 'string', description: 'Contraseña vigente del usuario autenticado.' },
          passwordNueva: {
            type: 'string',
            description:
              'Mínimo 12 caracteres y máximo 72 bytes. Debe clasificarse como FUERTE: no común, sin datos del usuario, ni repetida ni en secuencia, y con variedad suficiente o 16+ caracteres.',
          },
          confirmacion: { type: 'string', description: 'Debe coincidir exactamente con passwordNueva.' },
        },
      },
      CambioPasswordResponse: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'JWT NUEVO con la versión de sesión actualizada. El anterior deja de ser válido.',
          },
          usuario: { $ref: '#/components/schemas/Usuario' },
        },
      },
      Error: { type: 'object', properties: { message: { type: 'string' } } },
      ErrorPasswordNoFuerte: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          nivel: { type: 'string', enum: ['DEBIL', 'MEDIA'] },
          problemas: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['LONGITUD_MIN', 'MAX_BYTES', 'COMUN', 'CONTIENE_DATOS', 'REPETIDA', 'SECUENCIA', 'POCA_VARIEDAD'],
            },
          },
          detalles: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  paths: {
    '/api/auth/password': {
      patch: {
        tags: ['Autenticación'],
        summary: 'Cambiar la contraseña del usuario autenticado',
        description:
          'Solo afecta a la cuenta del token. Si se cambia, incrementa la versión de sesión: todos los tokens anteriores quedan inválidos y se devuelve uno nuevo. Máximo 5 intentos fallidos de contraseña actual cada 15 minutos por usuario. Envía un aviso por correo (sin contraseñas ni enlaces).',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CambioPasswordRequest' } } },
        },
        responses: {
          '200': {
            description: 'Contraseña cambiada. Devuelve un token nuevo.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CambioPasswordResponse' } } },
          },
          '400': {
            description:
              'Datos inválidos: faltan campos, contraseña actual incorrecta, confirmación distinta, igual a la actual o no lo bastante fuerte (en ese caso incluye nivel, problemas y detalles).',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/Error' },
                    { $ref: '#/components/schemas/ErrorPasswordNoFuerte' },
                  ],
                },
              },
            },
          },
          '401': {
            description: 'Sin sesión, sesión inválida o ya cerrada.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '429': {
            description: 'Demasiados intentos fallidos de contraseña actual. Incluye el encabezado Retry-After (segundos).',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '503': {
            description: 'La migración V18 aún no está aplicada en este entorno.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
} as const;
