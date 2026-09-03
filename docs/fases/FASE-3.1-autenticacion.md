# NEXTPROJECT — CIERRE DOCUMENTAL: FASE 3.1 (Autenticación)

---

## 1. Estado final

`[VERIFICADO]` La Fase 3.1 quedó **implementada y validada end-to-end**. Los casos de error (401 genéricos, timing seguro, ausencia/invalidez de token) fueron probados directamente por Claude con evidencia de ejecución real. El caso de éxito completo (login con credenciales reales + `/api/auth/me` con el token resultante) fue ejecutado localmente por el estudiante, quien confirmó directamente HTTP 200 en ambos pasos. Esa parte queda registrada como `[VERIFICADO]` en base a la confirmación explícita del estudiante, no como algo observado directamente por Claude.

---

## 2. Objetivo de la fase

Implementar la base de autenticación del backend: login mediante email/contraseña verificado con `bcryptjs`, emisión de un token JWT tras un login exitoso, un middleware que valida ese JWT en rutas protegidas, y un endpoint que confirma la identidad de la sesión autenticada.

---

## 3. Archivos creados

- `backend/src/repositories/usuarios.repository.ts`
- `backend/src/services/auth.service.ts`
- `backend/src/middleware/auth.middleware.ts`
- `backend/src/controllers/auth.controller.ts`
- `backend/src/routes/auth.routes.ts`

## 4. Archivos modificados

- `backend/package.json`
- `backend/.env`
- `backend/src/config/env.ts`
- `backend/src/server.ts`

## 5. Dependencias agregadas

- `jsonwebtoken ^9.0.2`
- `@types/jsonwebtoken ^9.0.7`

---

## 6. Decisiones técnicas aplicadas

- Payload JWT: `{ sub: usuario.id, rol: rol.nombre }`.
- `JWT_EXPIRES_IN=8h`, sin mecanismo de refresh token.
- Mensaje y código HTTP idénticos (401, `"Credenciales inválidas."`) tanto para email inexistente como para contraseña incorrecta.
- Hash bcrypt "señuelo" (sin relación con ninguna contraseña real) usado para mantener el tiempo de respuesta consistente cuando el email no existe.
- `requireAuth` valida únicamente la autenticidad del token — sin autorización por rol (RBAC) en esta fase.
- Validación de entrada manual en el controller, sin agregar Zod ni otra librería.

---

## 7. Endpoints implementados

```
POST /api/auth/login
GET  /api/auth/me
```

No existe ningún otro endpoint de autenticación en el código.

---

## 8. Pruebas ejecutadas

| # | Prueba | Quién la ejecutó | Tipo |
|---|---|---|---|
| 1 | `npm run build` | Claude | `[RESULTADO OBTENIDO]` |
| 2 | `GET /api/health` | Claude | `[RESULTADO OBTENIDO]` |
| 3 | Login con email inexistente | Claude | `[RESULTADO OBTENIDO]` |
| 4 | Login con contraseña incorrecta | Claude | `[RESULTADO OBTENIDO]` |
| 5 | `/api/auth/me` sin token | Claude | `[RESULTADO OBTENIDO]` |
| 6 | `/api/auth/me` con token inválido | Claude | `[RESULTADO OBTENIDO]` |
| 7 | Login con credenciales reales válidas | Estudiante (confirmado directamente) | `[VERIFICADO]` por confirmación del estudiante |
| 8 | `/api/auth/me` con token válido | Estudiante (confirmado directamente) | `[VERIFICADO]` por confirmación del estudiante |

---

## 9. Resultados obtenidos

| # | Prueba | HTTP | Evidencia |
|---|---|---|---|
| 1 | `npm run build` | — | Sin errores de TypeScript |
| 2 | `GET /api/health` | **200** | `{"status":"ok","message":"NextProject backend está activo"}` |
| 3 | Login email inexistente | **401** | `{"message":"Credenciales inválidas."}` |
| 4 | Login contraseña incorrecta | **401** | `{"message":"Credenciales inválidas."}` (idéntico al #3) |
| 5 | `/me` sin token | **401** | `{"message":"Token no proporcionado."}` |
| 6 | `/me` token inválido | **401** | `{"message":"Token inválido o expirado."}` |
| 7 | Login credenciales válidas | **200** | Confirmado por el estudiante — no se registra el token ni la contraseña |
| 8 | `/me` token válido | **200** | Confirmado por el estudiante — no se registra el token |

No se registra en este documento ninguna contraseña, JWT, `JWT_SECRET` ni credencial del archivo `.env`.

---

## 10. Base de datos

`[VERIFICADO]` Durante la implementación de Fase 3.1:
- No se modificó el esquema de PostgreSQL.
- No se ejecutó ninguna migración.
- No se ejecutó ningún `INSERT`/`UPDATE`/`DELETE` como parte de esta fase.
- Se utilizaron exclusivamente los roles y el usuario administrador ya sembrados en fases anteriores.

## 11. Frontend

`[VERIFICADO]` No se modificó ningún archivo del frontend durante esta fase.

---

## 12. Errores y advertencias

- `[VERIFICADO]` `npm install` introdujo **3 vulnerabilidades moderadas** (`qs`/`body-parser`, transitivas de `express`, no de `jsonwebtoken`). **No se ejecutó `npm audit fix`** — siguen presentes, sin resolver.
- `[VERIFICADO]` Error de tipado de TypeScript en `expiresIn` (tipo esperado por `jsonwebtoken@9` más estricto que `string`) — corregido con una conversión de tipo explícita, sin cambios de lógica.
- `[VERIFICADO]` Sin regresión observada en `GET /api/health` — respuesta idéntica antes y después de esta fase.

Las vulnerabilidades **no están solucionadas**, solo identificadas y reportadas.

---

## 13. Estado de Git

`[VERIFICADO]` Al momento del cierre, sin commits realizados para esta fase:

```
Modificados (no confirmados):
  backend/package-lock.json
  backend/package.json
  backend/src/config/env.ts
  backend/src/server.ts

Sin seguimiento (no confirmados):
  backend/src/controllers/
  backend/src/middleware/
  backend/src/repositories/
  backend/src/routes/
  backend/src/services/
```

Todos los archivos de la Fase 3.1 seguían sin commitear al momento de este cierre.

---

## 14. Pendientes

`[PENDIENTE]`:
- Autorización por roles / RBAC (fase posterior).
- Documentación Swagger/OpenAPI de estos dos endpoints.
- Testing automatizado (sin framework instalado todavía).
- Resto de módulos de negocio (solicitudes, cotizaciones, órdenes, alertas).

Nada de esto fue implementado en esta fase.

---

## 15. Conclusión de la Fase 3.1

`[VERIFICADO]` La autenticación básica del backend de NEXTPROJECT quedó implementada conforme al diseño aprobado: login con verificación `bcryptjs`, emisión de JWT con payload mínimo, middleware de validación reutilizable, y endpoint de verificación de sesión. Los casos de error fueron validados directamente por Claude con evidencia real (401 consistentes, sin fuga de información sobre existencia de email). El caso de éxito completo (login real → token → acceso autenticado a `/api/auth/me`) fue validado por el estudiante, con confirmación directa de HTTP 200 en ambos pasos. La fase queda cerrada como funcionalmente completa para su alcance definido, con las vulnerabilidades de dependencias y los pendientes de fases futuras explícitamente señalados, sin resolver.
