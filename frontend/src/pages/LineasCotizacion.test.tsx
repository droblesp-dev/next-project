import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LineasCotizacionEditor from './LineasCotizacionEditor';
import TablaLineasCotizacion from './TablaLineasCotizacion';
import type { LineaFormulario } from '../lib/lineasCotizacion';

const lineas: LineaFormulario[] = [
  { clave: 'a', descripcion: 'Torneado', cantidad: '10', precio: '12.50' },
  { clave: 'b', descripcion: 'Acabado', cantidad: '2.5', precio: '10' },
];

describe('editor y tabla de líneas de la cotización (#4)', () => {
  it('el editor muestra una fila por línea, el subtotal de cada una y el resumen con IVA y total', () => {
    const html = renderToStaticMarkup(
      <LineasCotizacionEditor token="t" lineas={lineas} onCambio={() => {}} ivaPorcentaje={15} anticipoPorcentaje={50} />
    );
    expect(html).toContain('Descripción línea 1');
    expect(html).toContain('Descripción línea 2');
    expect(html).toContain('125.00');
    expect(html).toContain('25.00');
    expect(html).toContain('150,00'); // subtotal
    expect(html).toContain('22,50'); // IVA 15 %
    expect(html).toContain('172,50'); // total
    expect(html).toContain('+ Agregar línea');
  });

  it('con una sola línea no se puede quitar y la línea derivada muestra su aviso', () => {
    const html = renderToStaticMarkup(
      <LineasCotizacionEditor token="t" lineas={[lineas[0]]} onCambio={() => {}} ivaPorcentaje={0} anticipoPorcentaje={0} nota="Línea derivada" />
    );
    expect(html).toMatch(/aria-label="Quitar línea 1"[^>]*disabled/);
    expect(html).toContain('Línea derivada');
  });

  it('la tabla de solo lectura muestra descripción, cantidad, precio unitario y subtotal; sin líneas no muestra nada', () => {
    const html = renderToStaticMarkup(
      <TablaLineasCotizacion items={[{ descripcion: 'Fresado', cantidad: '2.500', precio_unitario: '10.00', subtotal: '25.00' }]} />
    );
    expect(html).toContain('Fresado');
    expect(html).toContain('2,5');
    expect(html).toContain('$10,00');
    expect(html).toContain('$25,00');
    expect(renderToStaticMarkup(<TablaLineasCotizacion items={[]} />)).toBe('');
  });
});
