import type { Pool } from 'pg';

// Infraestructura de pruebas de integración (nunca la importa código de producción): fixtures de pagos.
//
// Fase 2 («Dinero acreditado»): acreditar un anticipo por TRANSFERENCIA exige que el cliente haya subido su
// comprobante y que COMERCIAL lo haya revisado (una gestión vigente PENDIENTE). Las cotizaciones ficticias de las
// pruebas nacen sin comprobante; esta función deja el comprobante registrado en la cotización ficticia de la prueba
// (el archivo no se necesita: la acreditación no lo lee). La revisión se registra aparte con `registrarGestionPago`.
export async function simularComprobanteDelCliente(pool: Pool, cotizacionId: string): Promise<void> {
  await pool.query(
    `UPDATE cotizaciones
        SET comprobante_anticipo = COALESCE(comprobante_anticipo, 'comprobante-ficticio-pruebas.png')
      WHERE id = $1 AND metodo_anticipo = 'TRANSFERENCIA'`,
    [cotizacionId]
  );
}
