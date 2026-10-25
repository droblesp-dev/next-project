import { describe, expect, it } from 'vitest';
import { contenidoComprobanteCoincideConMime } from './uploadsComprobantes.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ', 'latin1');

describe('contenidoComprobanteCoincideConMime (QA-05)', () => {
  it('acepta PNG, JPEG y PDF cuyo contenido real coincide con el MIME declarado', () => {
    expect(contenidoComprobanteCoincideConMime(PNG, 'image/png')).toBe(true);
    expect(contenidoComprobanteCoincideConMime(JPG, 'image/jpeg')).toBe(true);
    expect(contenidoComprobanteCoincideConMime(PDF, 'application/pdf')).toBe(true);
  });

  it('rechaza un archivo cuyo contenido no corresponde al MIME declarado', () => {
    expect(contenidoComprobanteCoincideConMime(PNG, 'application/pdf')).toBe(false);
    expect(contenidoComprobanteCoincideConMime(PDF, 'image/jpeg')).toBe(false);
    expect(contenidoComprobanteCoincideConMime(JPG, 'image/png')).toBe(false);
  });

  it('rechaza texto o scripts que declaran ser una imagen o un PDF', () => {
    const script = Buffer.from('<script>alert(1)</script>');
    for (const mime of ['image/png', 'image/jpeg', 'application/pdf']) {
      expect(contenidoComprobanteCoincideConMime(script, mime)).toBe(false);
    }
  });

  it('rechaza buffers vacíos o demasiado cortos y MIME no permitidos', () => {
    expect(contenidoComprobanteCoincideConMime(Buffer.alloc(0), 'image/png')).toBe(false);
    expect(contenidoComprobanteCoincideConMime(Buffer.from([0x89, 0x50]), 'image/png')).toBe(false);
    expect(contenidoComprobanteCoincideConMime(PNG, 'image/gif')).toBe(false);
  });
});
