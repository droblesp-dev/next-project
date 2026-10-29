import { describe, expect, it } from 'vitest';
import { puedeUsarChat } from './chatAcceso';

describe('acceso al chat (#7)', () => {
  it('solo COMERCIAL y OPERATIVO usan el chat; ADMIN y otros roles no', () => {
    expect(puedeUsarChat('COMERCIAL')).toBe(true);
    expect(puedeUsarChat('OPERATIVO')).toBe(true);
    expect(puedeUsarChat('ADMIN')).toBe(false);
    expect(puedeUsarChat('')).toBe(false);
    expect(puedeUsarChat('CLIENTE')).toBe(false);
  });
});
