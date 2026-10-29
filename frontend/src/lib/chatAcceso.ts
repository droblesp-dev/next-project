// #7: el chat de comunicación técnica es exclusivo de COMERCIAL y OPERATIVO. ADMIN no lo ve: ni el chat, ni los
// accesos a él, ni sus contadores. La protección real está en el backend (403); esto solo evita mostrar lo que no
// puede usarse.
export function puedeUsarChat(rol: string): boolean {
  return rol === 'COMERCIAL' || rol === 'OPERATIVO';
}
