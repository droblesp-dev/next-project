// Lógica pura del menú de usuario y de «Mi perfil» (sin React) para poder probarla sin DOM.
// Solo presentación: nada de esto cambia la sesión, el rol real ni los permisos.

// Iniciales del avatar: primera letra de las dos primeras palabras del nombre
// ("Sergio Rogelio Floreán" -> "SR"); con una sola palabra, su primera letra.
export function obtenerIniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  const primeraLetra = (palabra: string) => Array.from(palabra)[0] ?? '';
  return palabras
    .slice(0, 2)
    .map(primeraLetra)
    .join('')
    .toLocaleUpperCase('es');
}

// El valor interno del rol (ADMIN / COMERCIAL / OPERATIVO) no cambia nunca: aquí solo se
// decide cómo se escribe en pantalla. OPERATIVO se muestra como «Operario».
export function etiquetaRol(rol: string): string {
  switch (rol) {
    case 'ADMIN':
      return 'Admin';
    case 'COMERCIAL':
      return 'Comercial';
    case 'OPERATIVO':
      return 'Operario';
    default:
      return rol;
  }
}

// Correo parcialmente oculto para la tarjeta del menú: conserva el dominio y deja visibles
// solo la primera y la última letra de la parte local ("sergio@x.ec" -> "s***o@x.ec").
export function ocultarCorreo(correo: string): string {
  const arroba = correo.lastIndexOf('@');
  if (arroba <= 0) return correo;
  const local = Array.from(correo.slice(0, arroba));
  const dominio = correo.slice(arroba);
  if (local.length <= 2) return `${local[0]}***${dominio}`;
  return `${local[0]}***${local[local.length - 1]}${dominio}`;
}
