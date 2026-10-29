import { pool } from '../config/db.js';
import { DESTINO_ACENTOS, ORIGEN_ACENTOS } from '../services/busquedaPatron.js';

// Búsqueda parcial (LIKE '%término%') a nivel de PostgreSQL. Cada función devuelve los ids de TODAS
// las filas que coinciden; la visibilidad por rol la decide el servicio, nunca aquí. Solo se
// consulta (SELECT) con parámetros: el término jamás se concatena al SQL.
//
// $1 = patrón de texto libre ('%término%', sin tildes y en minúsculas).
// $2 = patrón de números legibles ('%sol000491%') o null.

// Texto normalizado igual que el término: minúsculas, sin tildes y «_» como espacio.
const NORM = (expr: string): string =>
  `translate(replace(lower(COALESCE((${expr})::text, '')), '_', ' '), '${ORIGEN_ACENTOS}', '${DESTINO_ACENTOS}')`;

// Número legible sin guiones ni espacios: «SOL-000491» -> «sol000491».
const COD = (expr: string): string => `regexp_replace(lower(COALESCE((${expr})::text, '')), '[^a-z0-9]', '', 'g')`;

// Fecha como la ve el usuario (DD/MM/AAAA). FECHA: columnas timestamptz, en hora de Ecuador; DIA: columnas date.
const FECHA = (expr: string): string => `to_char((${expr}) AT TIME ZONE 'America/Guayaquil', 'DD/MM/YYYY')`;
const DIA = (expr: string): string => `to_char(${expr}, 'DD/MM/YYYY')`;

function donde(textos: string[], codigos: string[]): string {
  const porTexto = textos.map((e) => `${NORM(e)} LIKE $1 ESCAPE '\\'`);
  const porCodigo = codigos.map((e) => `${COD(e)} LIKE $2 ESCAPE '\\'`);
  return [...porTexto, ...porCodigo].join('\n       OR ');
}

async function ids(sql: string, parcial: string, codigo: string | null): Promise<string[]> {
  // Solo se envía $2 cuando la consulta lo usa (PostgreSQL rechaza parámetros sin usar).
  const params = sql.includes('$2') ? [parcial, codigo] : [parcial];
  const result = await pool.query<{ id: string }>(sql, params);
  return result.rows.map((r) => r.id);
}

// Datos del cliente: solo los pueden consultar ADMIN y COMERCIAL (igual que GET /api/clientes).
const CLIENTE = ['cl.nombre', 'cl.empresa', 'cl.email', 'cl.telefono'];

export function buscarSolicitudes(parcial: string, codigo: string | null, incluirCliente: boolean): Promise<string[]> {
  const textos = [
    's.servicio',
    's.descripcion',
    's.especificaciones',
    's.estado',
    's.cantidad',
    DIA('s.fecha_requerida'),
    FECHA('s.creado_en'),
    ...(incluirCliente ? CLIENTE : []),
  ];
  return ids(
    `SELECT s.id FROM solicitudes s
     LEFT JOIN clientes cl ON cl.id = s.cliente_id
     WHERE ${donde(textos, ['s.codigo'])}`,
    parcial,
    codigo
  );
}

export function buscarCotizaciones(parcial: string, codigo: string | null, incluirCliente: boolean): Promise<string[]> {
  const textos = [
    'c.descripcion',
    'c.estado',
    'c.estado_anticipo',
    'c.estado_saldo',
    'c.metodo_anticipo',
    'c.metodo_saldo',
    'c.valor',
    'c.subtotal',
    'c.iva_valor',
    'c.total',
    'c.anticipo_valor',
    'c.saldo_pendiente',
    FECHA('c.creado_en'),
    FECHA('c.fecha_vigencia'),
    's.servicio',
    's.descripcion',
    's.especificaciones',
    ...(incluirCliente ? CLIENTE : []),
  ];
  return ids(
    `SELECT c.id FROM cotizaciones c
     LEFT JOIN solicitudes s ON s.id = c.solicitud_id
     LEFT JOIN clientes cl ON cl.id = s.cliente_id
     WHERE ${donde(textos, ['c.codigo', 's.codigo'])}`,
    parcial,
    codigo
  );
}

export function buscarOrdenes(parcial: string, codigo: string | null, incluirCliente: boolean): Promise<string[]> {
  const textos = [
    'o.descripcion',
    'o.estado',
    'o.observaciones',
    'o.avance',
    FECHA('o.creado_en'),
    DIA('o.fecha_entrega'),
    's.servicio',
    's.descripcion',
    'u.nombre',
    ...(incluirCliente ? CLIENTE : []),
  ];
  return ids(
    `SELECT o.id FROM ordenes o
     LEFT JOIN cotizaciones c ON c.id = o.cotizacion_id
     LEFT JOIN solicitudes s ON s.id = c.solicitud_id
     LEFT JOIN clientes cl ON cl.id = s.cliente_id
     LEFT JOIN usuarios u ON u.id = o.responsable_id
     WHERE ${donde(textos, ['o.codigo', 'c.codigo', 's.codigo'])}`,
    parcial,
    codigo
  );
}

export function buscarAlertas(parcial: string, codigo: string | null, incluirCliente: boolean): Promise<string[]> {
  const textos = [
    'a.tipo',
    'a.condicion',
    'a.mensaje',
    'a.estado',
    FECHA('a.creado_en'),
    's.servicio',
    ...(incluirCliente ? CLIENTE : []),
  ];
  return ids(
    `SELECT a.id FROM alertas a
     LEFT JOIN ordenes o ON o.id = a.orden_id
     LEFT JOIN cotizaciones c ON c.id = o.cotizacion_id
     LEFT JOIN solicitudes s ON s.id = c.solicitud_id
     LEFT JOIN clientes cl ON cl.id = s.cliente_id
     WHERE ${donde(textos, ['o.codigo', 'c.codigo', 's.codigo'])}`,
    parcial,
    codigo
  );
}

// La empresa del lead solo se consulta para ADMIN (igual que la pantalla de leads).
export function buscarLeads(parcial: string, codigo: string | null, incluirEmpresa: boolean): Promise<string[]> {
  const textos = [
    'l.nombre',
    'l.telefono',
    'l.email',
    'l.fuente',
    'l.estado',
    'l.clasificacion',
    'l.observaciones',
    FECHA('l.creado_en'),
    ...(incluirEmpresa ? ['cl.empresa'] : []),
  ];
  return ids(
    `SELECT l.id FROM leads l
     LEFT JOIN clientes cl ON cl.id = l.cliente_id
     WHERE ${donde(textos, [])}`,
    parcial,
    codigo
  );
}

export function buscarUsuarios(parcial: string, codigo: string | null): Promise<string[]> {
  const textos = [
    'u.nombre',
    'u.email',
    'r.nombre',
    `CASE WHEN u.activo THEN 'activo' ELSE 'inactivo' END`,
    FECHA('u.creado_en'),
  ];
  return ids(
    `SELECT u.id FROM usuarios u
     LEFT JOIN roles r ON r.id = u.rol_id
     WHERE ${donde(textos, [])}`,
    parcial,
    codigo
  );
}
