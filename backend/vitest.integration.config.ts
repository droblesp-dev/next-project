import { defineConfig } from 'vitest/config';

// Comando MANUAL `npm run test:integration` (nunca en el pipeline ni en `npm test`). El guard exige
// nextproject_test + localhost + sandbox + llaves externas vacías y bloquea sockets no locales.
// Un archivo a la vez: comparten la BD.
//
// EXCLUIDAS (dependen de infraestructura retirada en d3dc79c y fallan con este guard; no son regresiones):
//  - correo: capturan el cuerpo del correo enviado a Brevo, lo que exige una BREVO_API_KEY (el guard la
//    prohíbe): correoCotizaciones.fase1, recuperacionOtp.fase1, ajustesWhatsappYRegeneracion.
//  - logos: necesitan el setup que redirigía la carpeta de logos a una carpeta temporal, hoy retirado
//    (sin él escribirían en uploads/logos-bancos): aislamientoLogosPruebas, cuentasBancarias.http,
//    cuentasBancariasLogoPropio.http, cuentasBancariasLogoPublico.
// Rehabilitarlas requiere decidir cómo aislar correo y logos; hasta entonces no se ejecutan.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    exclude: [
      'node_modules/**',
      'src/services/correoCotizaciones.fase1.integration.test.ts',
      'src/services/recuperacionOtp.fase1.integration.test.ts',
      'src/services/ajustesWhatsappYRegeneracion.integration.test.ts',
      'src/config/aislamientoLogosPruebas.integration.test.ts',
      'src/routes/cuentasBancarias.http.integration.test.ts',
      'src/routes/cuentasBancariasLogoPropio.http.integration.test.ts',
      'src/services/cuentasBancariasLogoPublico.integration.test.ts',
    ],
    setupFiles: ['./src/config/integracion.guard.setup.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
