# 08 · Seguridad

Estado tras la revisión OWASP Top 10:2021 (detalle y evidencias en [`docs/CHANGELOG-SEGURIDAD.md`](../CHANGELOG-SEGURIDAD.md)). **[VERIFICADO]** salvo donde se indique.

## Controles implementados
| Área (OWASP) | Control |
|---|---|
| A01 Control de acceso | `requireAuth` + `requireRole` en todas las rutas privadas; reglas contextuales (responsable de la orden, lectura del chat); el rol se lee **de la BD** en cada petición; UUID de ruta validado (404 en vez de 500); el cliente solo accede con token+código |
| A02 Criptografía | `bcryptjs` costo 12; JWT **HS256 explícito** al firmar y verificar; **tres secretos independientes** (`JWT_SECRET`, `COTIZACION_LINK_SECRET`, `LEAD_LINK_SECRET`); códigos de acceso y OTP guardados como hash bcrypt y generados con `crypto.randomInt` |
| A03 Inyección | SQL **100 % parametrizado** (lo único interpolado son listas de columnas constantes); HTML de correos con `escaparHtml`; sin `innerHTML`/`dangerouslySetInnerHTML` en el frontend |
| A04 Diseño inseguro | Límites de intentos (login, código de cotización, OTP, asistente IA); transiciones atómicas; efectos secundarios que no pueden revertir una operación ya confirmada |
| A05 Configuración | `helmet` (CSP, HSTS, `nosniff`, `X-Frame-Options`, CORP `cross-origin` para logos); CORS por lista blanca (`CORS_ORIGINS`), sin `*`; Swagger oculto con `NODE_ENV=production`; `TRUST_PROXY` configurable; `unhandledRejection` registrado |
| A06 Componentes | `npm audit fix` aplicado: **0 vulnerabilidades de producción**; CI ejecuta typecheck y pruebas antes de construir |
| A07 Autenticación | Límite de login (5 fallos por IP+correo y 30 por IP cada 15 min → 429); hash señuelo contra enumeración por tiempo; política de contraseñas (longitud, comunes, datos personales, secuencias, variedad, 72 bytes); `session_version` revoca sesiones al cambiar la contraseña; usuario inactivo cae de inmediato |
| A08 Integridad | Archivos subidos: lista blanca de tipos + **firma binaria**, 5 MB (1 MB logos), nombre de archivo = UUID generado por el servidor (nunca el original); descargas solo por endpoints autenticados |
| A09 Registro | Bitácora JSON de eventos de seguridad (`LOGIN_OK/FALLIDO/BLOQUEADO`, `PASSWORD_CAMBIADA`, `PROMESA_NO_CAPTURADA`) sin contraseñas ni tokens y con correos enmascarados |

## Secretos
- Nunca en el repositorio: `.env*` y `.local-secrets/` ignorados; en CI, variables del grupo `next-project-secrets`; el pipeline escribe un archivo de entorno **temporal** (`umask 077`) y lo borra tras `docker run`.
- Las contraseñas `SEED_*` solo se usan en el paso de seed (ya **no** se entregan al contenedor del backend).
- Mensajes de error y logs **no** incluyen claves de API ni parámetros de consulta.

## Límites conocidos y deuda (decídelos en el nuevo proyecto)
1. **Limitadores en memoria**: se reinician con el proceso y no se comparten entre réplicas. Con más de una instancia, hay que mover los contadores a PostgreSQL o Redis.
2. **Bloqueo por cotización**: un tercero con el enlace puede bloquear al cliente legítimo 15 min (aceptado como trade-off).
3. **SSL a PostgreSQL con `rejectUnauthorized: false`**: cifra pero no valida el certificado (aceptado). En el clon, conviene cargar la CA del servidor.
4. **Contenedor del backend corre como root** y el puerto 5000 se publica en el host: recomendado `USER node` + `--user` en `docker run` y publicar solo en `127.0.0.1`.
5. **`X-Forwarded-For` falsificable** si alguien llega directo al puerto del backend; mitigar con el punto anterior.
6. **Pruebas de integración retiradas**: la cobertura contra PostgreSQL real quedó sin ejecutar; el comportamiento de SQL/transacciones se valida solo manualmente.
7. **Credenciales de prueba** (`*.seed@…`) se siembran también en producción desde el pipeline: define cómo crear el primer ADMIN real en el nuevo entorno.
8. **Sin 2FA, sin recuperación de contraseña interna** (la recuperación existe solo para el código de acceso de cotización).
9. **JWT de sesión de 8 h** sin *refresh token*.

## Checklist de seguridad para el clon
- [ ] Tres secretos nuevos y distintos (≥ 64 caracteres aleatorios).
- [ ] `NODE_ENV=production`, `CORS_ORIGINS` solo con los dominios reales, `TRUST_PROXY=1` detrás de nginx.
- [ ] Remitente de correo verificado y `BREVO_SANDBOX` vacío en producción.
- [ ] Cambiar todas las credenciales sembradas; eliminar usuarios de prueba.
- [ ] Revisar `npm audit` antes de cada despliegue.
- [ ] Backups de PostgreSQL y del volumen `uploads/` (contiene comprobantes de pago y evidencias).
- [ ] Política de retención de comprobantes (datos financieros de clientes).
