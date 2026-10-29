import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ComprobanteUploader from './ComprobanteUploader';

const base = {
  id: 'archivo',
  titulo: 'Título',
  descripcion: 'Descripción',
  archivo: null,
  error: null,
  subiendo: false,
  onSeleccionar: vi.fn(),
  onSubir: vi.fn(),
};

describe('ComprobanteUploader — textos reutilizables (#6)', () => {
  it('por defecto conserva los textos de los comprobantes de pago', () => {
    const h = renderToStaticMarkup(<ComprobanteUploader {...base} />);
    expect(h).toContain('Selecciona tu comprobante');
    expect(h).toContain('SUBIR COMPROBANTE');
    expect(h).toContain('Subir comprobante');
    expect(h).toContain('PDF, JPG o PNG');
  });

  it('con textos propios muestra los de la evidencia y no los de comprobante', () => {
    const h = renderToStaticMarkup(
      <ComprobanteUploader
        {...base}
        textos={{ seleccion: 'Selecciona la evidencia', subir: 'SUBIR EVIDENCIA', instruccion: 'Pulsa «Subir evidencia».' }}
      />
    );
    expect(h).toContain('Selecciona la evidencia');
    expect(h).toContain('SUBIR EVIDENCIA');
    expect(h).toContain('Subir evidencia');
    expect(h).not.toContain('SUBIR COMPROBANTE');
    expect(h).not.toContain('Selecciona tu comprobante');
  });

  it('el botón de subir queda deshabilitado mientras no hay archivo y muestra el error recibido', () => {
    const h = renderToStaticMarkup(<ComprobanteUploader {...base} error="Formato no permitido." />);
    expect(h).toMatch(/<button[^>]*disabled/);
    expect(h).toContain('Formato no permitido.');
  });
});
