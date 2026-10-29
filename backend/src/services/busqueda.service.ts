import * as busquedaRepo from '../repositories/busqueda.repository.js';
import { listarAlertas } from './alertas.service.js';
import { patronCodigo, patronParcial } from './busquedaPatron.js';

export type EntidadBusqueda = 'solicitudes' | 'cotizaciones' | 'ordenes' | 'alertas' | 'leads' | 'usuarios';

export class EntidadBusquedaInvalidaError extends Error {}
export class SinAccesoBusquedaError extends Error {}

export interface UsuarioBusqueda {
  sub: string;
  rol: string;
}

// Mismos roles que ya tiene el listado de cada entidad (ver routes/*.routes.ts): buscar nunca da
// acceso a algo que el rol no pueda listar.
const ROLES_POR_ENTIDAD: Record<EntidadBusqueda, string[]> = {
  solicitudes: ['ADMIN', 'COMERCIAL', 'OPERATIVO'],
  cotizaciones: ['ADMIN', 'COMERCIAL'],
  ordenes: ['ADMIN', 'COMERCIAL', 'OPERATIVO'],
  alertas: ['ADMIN', 'COMERCIAL', 'OPERATIVO'],
  leads: ['ADMIN', 'COMERCIAL'],
  usuarios: ['ADMIN'],
};

export function esEntidadBusqueda(valor: string): valor is EntidadBusqueda {
  return Object.prototype.hasOwnProperty.call(ROLES_POR_ENTIDAD, valor);
}

// Los datos del cliente (nombre, empresa, correo, teléfono) solo los puede consultar ADMIN/COMERCIAL,
// igual que GET /api/clientes: para OPERATIVO la búsqueda no los usa.
function puedeVerCliente(rol: string): boolean {
  return rol === 'ADMIN' || rol === 'COMERCIAL';
}

// Ids de TODAS las filas de la entidad que contienen el término (búsqueda parcial, sin distinguir
// mayúsculas ni tildes), resuelto en PostgreSQL.
export async function buscarIds(entidad: EntidadBusqueda, termino: string, usuario: UsuarioBusqueda): Promise<string[]> {
  if (!ROLES_POR_ENTIDAD[entidad].includes(usuario.rol)) {
    throw new SinAccesoBusquedaError();
  }

  const parcial = patronParcial(termino);
  const codigo = patronCodigo(termino);
  const cliente = puedeVerCliente(usuario.rol);

  switch (entidad) {
    case 'solicitudes':
      return busquedaRepo.buscarSolicitudes(parcial, codigo, cliente);
    case 'cotizaciones':
      return busquedaRepo.buscarCotizaciones(parcial, codigo, cliente);
    case 'ordenes':
      return busquedaRepo.buscarOrdenes(parcial, codigo, cliente);
    case 'alertas': {
      // La visibilidad de las alertas depende del rol (todas / solo del responsable / solo ENTREGA): se
      // reutiliza el mismo listado y se devuelve únicamente la intersección.
      const [encontradas, visibles] = await Promise.all([
        busquedaRepo.buscarAlertas(parcial, codigo, cliente),
        listarAlertas({ sub: usuario.sub, rol: usuario.rol }),
      ]);
      const permitidas = new Set(visibles.map((a) => a.id));
      return encontradas.filter((id) => permitidas.has(id));
    }
    case 'leads':
      return busquedaRepo.buscarLeads(parcial, codigo, usuario.rol === 'ADMIN');
    case 'usuarios':
      return busquedaRepo.buscarUsuarios(parcial, codigo);
  }
}
