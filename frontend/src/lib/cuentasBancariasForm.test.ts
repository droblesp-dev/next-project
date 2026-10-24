import { describe, expect, it } from 'vitest';
import { hayCambiosSinGuardar, LIMITES_CUENTA_BANCARIA, puedeElegirLogo, type FormularioCuentaState } from './cuentasBancariasForm';

function vacio(): FormularioCuentaState {
  return {
    bancoSeleccionado: '',
    bancoPersonalizadoNombre: '',
    tipoEntidad: 'BANCO',
    titular: '',
    tipoCuenta: 'AHORROS',
    numeroCuenta: '',
    activo: true,
    titularVisibleCliente: true,
  };
}
const sinLogo = { logoArchivo: false, logoQuitado: false };

describe('LIMITES_CUENTA_BANCARIA', () => {
  it('coinciden con las columnas de cuentas_bancarias (V14)', () => {
    expect(LIMITES_CUENTA_BANCARIA).toEqual({ titular: 60, numeroCuenta: 20, bancoNombre: 100 });
  });
});

describe('hayCambiosSinGuardar', () => {
  it('un formulario intacto no tiene cambios', () => {
    expect(hayCambiosSinGuardar(vacio(), vacio(), sinLogo)).toBe(false);
  });

  it('detecta cambios en cada campo de texto', () => {
    for (const campo of ['bancoSeleccionado', 'bancoPersonalizadoNombre', 'titular', 'numeroCuenta'] as const) {
      expect(hayCambiosSinGuardar({ ...vacio(), [campo]: 'x' }, vacio(), sinLogo)).toBe(true);
    }
    expect(hayCambiosSinGuardar({ ...vacio(), tipoCuenta: 'CORRIENTE' }, vacio(), sinLogo)).toBe(true);
    expect(hayCambiosSinGuardar({ ...vacio(), tipoEntidad: 'COOPERATIVA' }, vacio(), sinLogo)).toBe(true);
  });

  it('detecta cambios en estado y visibilidad del titular', () => {
    expect(hayCambiosSinGuardar({ ...vacio(), activo: false }, vacio(), sinLogo)).toBe(true);
    expect(hayCambiosSinGuardar({ ...vacio(), titularVisibleCliente: false }, vacio(), sinLogo)).toBe(true);
  });

  it('elegir o quitar un logo cuenta como cambio', () => {
    expect(hayCambiosSinGuardar(vacio(), vacio(), { logoArchivo: true, logoQuitado: false })).toBe(true);
    expect(hayCambiosSinGuardar(vacio(), vacio(), { logoArchivo: false, logoQuitado: true })).toBe(true);
  });

  it('escribir solo espacios no es un cambio', () => {
    expect(hayCambiosSinGuardar({ ...vacio(), titular: '   ' }, vacio(), sinLogo)).toBe(false);
  });

  it('en edición compara contra los valores cargados, no contra el formulario vacío', () => {
    const cargado = { ...vacio(), titular: 'ACME', numeroCuenta: '123', bancoSeleccionado: 'id-1' };
    expect(hayCambiosSinGuardar({ ...cargado }, cargado, sinLogo)).toBe(false);
    expect(hayCambiosSinGuardar({ ...cargado, titular: 'ACME S.A.' }, cargado, sinLogo)).toBe(true);
  });
});

import { resolverLogoVisible, type EntradaLogoVisible } from './cuentasBancariasForm';

describe('resolverLogoVisible (logo propio vs heredado)', () => {
  const base = (): EntradaLogoVisible => ({
    editando: true,
    hayArchivoNuevo: false,
    archivoNuevoPreviewUrl: null,
    logoPropioUrl: null,
    logoQuitado: false,
    entidadActual: 'e1',
    entidadInicial: 'e1',
    urlHeredada: '/heredado.png',
  });

  it('sin logo propio muestra el heredado y NO ofrece «Quitar»', () => {
    expect(resolverLogoVisible(base())).toEqual({ previewUrl: '/heredado.png', puedeQuitar: false });
  });

  it('con logo propio lo muestra y ofrece «Quitar»', () => {
    expect(resolverLogoVisible({ ...base(), logoPropioUrl: '/propio.png' })).toEqual({
      previewUrl: '/propio.png',
      puedeQuitar: true,
    });
  });

  it('tras quitar el propio vuelve al heredado y ya no ofrece «Quitar»', () => {
    expect(resolverLogoVisible({ ...base(), logoPropioUrl: '/propio.png', logoQuitado: true })).toEqual({
      previewUrl: '/heredado.png',
      puedeQuitar: false,
    });
  });

  it('un archivo recién elegido tiene prioridad (también sobre un heredado) y se puede quitar', () => {
    expect(
      resolverLogoVisible({ ...base(), hayArchivoNuevo: true, archivoNuevoPreviewUrl: 'blob:nuevo' })
    ).toEqual({ previewUrl: 'blob:nuevo', puedeQuitar: true });
  });

  it('al cambiar de entidad el logo propio anterior deja de mostrarse', () => {
    expect(resolverLogoVisible({ ...base(), logoPropioUrl: '/propio.png', entidadActual: 'e2' })).toEqual({
      previewUrl: '/heredado.png',
      puedeQuitar: false,
    });
  });

  it('al crear nunca hay logo propio guardado: solo heredado o archivo nuevo', () => {
    expect(resolverLogoVisible({ ...base(), editando: false, logoPropioUrl: '/x.png' })).toEqual({
      previewUrl: '/heredado.png',
      puedeQuitar: false,
    });
  });

  it('sin logo en absoluto devuelve null (la UI muestra el icono genérico)', () => {
    expect(resolverLogoVisible({ ...base(), urlHeredada: null })).toEqual({ previewUrl: null, puedeQuitar: false });
  });
});

describe('puedeElegirLogo', () => {
  it('no permite elegir logo sin entidad seleccionada', () => {
    expect(puedeElegirLogo('')).toBe(false);
    expect(puedeElegirLogo('   ')).toBe(false);
  });

  it('permite elegir logo con una entidad del catálogo o con «otro banco»', () => {
    expect(puedeElegirLogo('0d48762a-bfb9-4637-a775-293dfc8e7609')).toBe(true);
    expect(puedeElegirLogo('__OTRO__')).toBe(true);
  });
});
