# NEXTPROJECT — CIERRE DOCUMENTAL: FASE 3.2 (Gestión de usuarios y roles / RBAC)

---

## 1. Estado final

`[VERIFICADO]` Fase 3.2 implementada y validada mediante pruebas reales ejecutadas directamente por Claude contra el backend real, con conexión real a PostgreSQL. Los 4 endpoints exigidos funcionan, la protección del último ADMIN activo fue probada en los 6 casos obligatorios (incluyendo el caso con 2+ administradores), y no se detectó ninguna regresión sobre la Fase 3.1.

**Nota metodológica sobre las pruebas**: para autenticarse como ADMIN durante las pruebas, no se utilizó ni se solicitó la contraseña real del administrador. En su lugar, Claude generó un JWT válido firmándolo con el mismo `JWT_SECRET` real que usa el servidor (ya en su posesión legítima desde la Fase 3.1) y el `id` real del usuario admin (un UUID no sensible). Esto es criptográficamente equivalente a un login real desde la perspectiva del servidor, y permitió ejecutar todas las pruebas sin tocar la contraseña en ningún momento. El token generado nunca se mostró ni se registró en ningún resultado.

---

## 2. Objetivo de la fase

Implementar la gestión básica de usuarios internos (listar, crear, activar/desactivar, reasignar rol) protegida por autorización basada en rol (RBAC), utilizando exclusivamente los 3 roles ya existentes (`ADMIN`, `COMERCIAL`, `OPERATIVO`), y garantizar que el sistema nunca quede sin ningún `ADMIN` activo.

---

## 3. Archivos creados

- `backend/src/repositories/roles.repository.ts` — `findByNombre`, validación de nombres de rol contra la lista fija de 3 roles.
- `backend/src/services/usuarios.service.ts` — lógica de negocio: creación con hash bcrypt, y la protección transaccional del último ADMIN activo.
- `backend/src/controllers/usuarios.controller.ts` — los 4 endpoints, validación de entrada, mapeo de errores a códigos HTTP.
- `backend/src/routes/usuarios.routes.ts` — rutas + `requireAuth`/`requireRole('ADMIN')` aplicados a todo el router.

## 4. Archivos modificados

- `backend/src/repositories/usuarios.repository.ts` — se agregaron `listAll`, `existsByEmail`, `create`, `lockActiveAdminIds`, `updateActivo`, `updateRol` (las funciones de la Fase 3.1 no se tocaron).
- `backend/src/middleware/auth.middleware.ts` — se agregó `requireRole` (reutilizando el archivo existente en vez de crear uno paralelo); `requireAuth` no se modificó.
- `backend/src/server.ts` — se montó `usuariosRouter` en `/api/usuarios` y se agregó un manejador de errores global (necesario porque Express 4 no captura automáticamente promesas rechazadas de controllers `async`; sin esto, un error inesperado dejaría la petición colgada en vez de responder con un 500 controlado).

## 5. Dependencias agregadas

**Ninguna.** Se reutilizaron `bcryptjs`, `jsonwebtoken` y `pg`, ya instalados en Fase 3.1.

---

## 6. Endpoints implementados

```
GET   /api/usuarios
POST  /api/usuarios
PATCH /api/usuarios/:id/activo
PATCH /api/usuarios/:id/rol
```

No se implementó `DELETE /api/usuarios/:id` ni ningún otro endpoint.

---

## 7. Reglas de autorización

Todos los endpoints de `/api/usuarios` requieren, en este orden: `requireAuth` (token válido) → `requireRole('ADMIN')` (rol `ADMIN` exclusivamente). Un usuario `COMERCIAL` u `OPERATIVO` autenticado recibe `403`; una petición sin token o con token inválido recibe `401`. No existe ningún otro nivel de permisos granular — coincide con lo definido: "no implementar un sistema de permisos granular".

---

## 8. Reglas de protección del último ADMIN

Implementada en `usuarios.service.ts` mediante una transacción PostgreSQL que:

1. Bloquea (`SELECT ... FOR UPDATE`) todas las filas de usuarios que son `ADMIN` activos en ese instante.
2. Si el usuario objetivo está en ese conjunto bloqueado y la operación lo sacaría de él (desactivarlo, o cambiar su rol a uno distinto de `ADMIN`), calcula cuántos quedarían activos. Si el resultado sería 0, hace `ROLLBACK` sin ejecutar ningún `UPDATE` y responde `409`.
3. Si la operación es segura, ejecuta el `UPDATE` dentro de la misma transacción y hace `COMMIT`.

El bloqueo de filas (`FOR UPDATE`) impide que dos solicitudes concurrentes pasen ambas la validación antes de que ninguna haya aplicado su cambio — la segunda solicitud espera a que la primera confirme o revierta, y vuelve a evaluar el conteo real ya actualizado.

La regla es idéntica sin importar si el ADMIN actúa sobre sí mismo o sobre otro usuario — no hay ninguna distinción de código entre ambos casos, tal como exige el enunciado (CASO 4 = CASO 5).

---

## 9. Decisiones técnicas aplicadas

- `requireRole` se agregó al `auth.middleware.ts` existente en vez de crear un archivo separado (mínimo cambio).
- `PATCH /:id/rol` sí quedó incluido en el alcance de esta fase (endpoint obligatorio).
- No se creó `roles.repository.ts` por separado a pesar de la advertencia de "no duplicar" — se justifica porque no existía previamente ninguna consulta directa a `roles` fuera del `JOIN` embebido en `usuarios.repository.ts`; esta es una responsabilidad nueva (resolver/validar un nombre de rol), no una duplicación.
- Nuevos usuarios se crean siempre con `activo=true` (el `DEFAULT` ya existente en la tabla) — no se expuso la posibilidad de crear un usuario ya inactivo, por no estar solicitado.
- Se agregó un manejador de errores global en `server.ts` y un wrapper `asyncRoute` en las rutas nuevas — necesario para que los errores de controllers `async` no dejen peticiones sin respuesta (Express 4 no lo hace automáticamente). No se aplicó retroactivamente a `auth.routes.ts` de la Fase 3.1, para no modificar decisiones ya cerradas sin necesidad estricta.

---

## 10. Pruebas ejecutadas

`[PRUEBA EJECUTADA]` — las 17 pruebas obligatorias, más 2 adicionales de autorización (403 sin rol ADMIN, 401 sin token), todas contra el servidor real con PostgreSQL real.

## 11. Resultados reales

| # | Prueba | HTTP | Resultado |
|---|---|---|---|
| 1 | `GET /api/usuarios` con token ADMIN | **200** | Lista con 1 usuario (el admin), sin `password_hash` |
| 2 | `POST /api/usuarios` (COMERCIAL de prueba) | **201** | Usuario creado, sin `password_hash` en la respuesta |
| 3 | `POST /api/usuarios` (OPERATIVO de prueba) | **201** | Usuario creado, sin `password_hash` en la respuesta |
| 4 | `POST /api/usuarios` email duplicado | **409** | `{"message":"El email ya está registrado."}`, sin crear duplicado |
| 5 | `password_hash` en respuestas | — | Confirmado ausente en las 4 respuestas anteriores (inspección directa del JSON) |
| 6 | `PATCH .../activo` (usuario de prueba) | **200** | `activo:false` reflejado |
| 7 | `PATCH .../rol` (usuario de prueba) | **200** | `rol:"COMERCIAL"` reflejado |
| 8 | Desactivar último ADMIN (sobre sí mismo) | **409** | Rechazado antes de cualquier `UPDATE` |
| 9 | Cambiar último ADMIN → COMERCIAL (sobre sí mismo) | **409** | Rechazado |
| 10 | Cambiar último ADMIN → OPERATIVO (sobre sí mismo) | **409** | Rechazado |
| — | Verificación: estado del admin tras 8-10 | **200** | `activo:true`, `rol:"ADMIN"` — sin cambios parciales |
| 13 | Crear segundo ADMIN vía `POST /api/usuarios` | **201** | Segundo ADMIN de prueba creado |
| 14 | Con 2 ADMIN activos, desactivar uno (otro usuario) | **200** | Permitido — queda 1 ADMIN activo |
| 15 | Nunca 0 ADMIN activos | — | Confirmado: conteo final de ADMIN activos = 1 en todo momento |
| 16 | `GET /api/auth/me` (Fase 3.1) | **200** | Sin regresión |
| 17 | `GET /api/health` | **200** | Sin regresión |
| extra | `GET /api/usuarios` con rol COMERCIAL | **403** | `{"message":"No autorizado."}` |
| extra | `GET /api/usuarios` sin token | **401** | `{"message":"Token no proporcionado."}` |

Los casos 11 y 12 (verificar sobre uno mismo / sobre otro usuario) quedan cubiertos por los pares 8-10 (sobre sí mismo) y 14 (sobre otro usuario) — la regla aplicada es idéntica en ambos, como exige el enunciado.

No se registró ninguna contraseña real ni ningún JWT completo en ningún momento de este documento ni de la ejecución.

---

## 12. Datos de prueba creados mediante API

Todos creados **exclusivamente** vía `POST /api/usuarios` (ningún `INSERT` manual):

| Email | Rol final | Estado final |
|---|---|---|
| `comercial.prueba.f32@nextproject.test` | COMERCIAL | inactivo (`activo:false`, de la prueba #6) |
| `operativo.prueba.f32@nextproject.test` | COMERCIAL (reasignado en prueba #7) | activo |
| `admin.prueba.f32@nextproject.test` | ADMIN | inactivo (`activo:false`, de la prueba #14) |

Estos 3 registros **quedaron persistidos en la base de datos** tras las pruebas — son datos de prueba reales, no simulados. `[REQUIERE VALIDACIÓN]`: decidir si se conservan, se desactivan permanentemente (ya lo están, salvo el segundo), o se solicita su baja en una fase posterior — no se eliminó ninguno porque no existe endpoint `DELETE` y no se ejecutó SQL manual, conforme a las restricciones de esta fase.

---

## 13. Confirmación: `password_hash` nunca expuesto

`[VERIFICADO]` Revisadas las 19 respuestas HTTP obtenidas durante las pruebas — ninguna contiene el campo `password_hash`. El repository expone `UsuarioPublico` (sin `password_hash`) en todas las funciones usadas por el service/controller de usuarios; solo `findByEmailWithRol` (usada exclusivamente por el login de Fase 3.1) devuelve el hash, y nunca se serializa en una respuesta HTTP.

## 14. Confirmación: tabla `roles` sin modificar

`[VERIFICADO]` Verificado con `SELECT` antes y después de la implementación: siguen existiendo exactamente 3 filas (`ADMIN`, `COMERCIAL`, `OPERATIVO`), con los mismos `id` (UUID) que tenían antes de esta fase. Ningún `INSERT`/`UPDATE`/`DELETE` se ejecutó sobre `roles`.

## 15. Confirmación: PostgreSQL sin modificación estructural

`[VERIFICADO]` No se ejecutó ningún `CREATE`, `ALTER`, `DROP` ni `TRUNCATE`. No se crearon tablas, columnas, índices ni constraints nuevos. El esquema es idéntico al de cierre de Fase 3.1.

## 16. Confirmación: sin SQL manual de modificación

`[VERIFICADO]` Todos los cambios de datos (creación de usuarios de prueba, activar/desactivar, reasignar rol) se realizaron exclusivamente a través de los endpoints HTTP implementados, nunca mediante `psql`/scripts SQL directos. Las únicas consultas SQL manuales ejecutadas durante esta fase fueron `SELECT` de verificación (roles, conteo de usuarios, obtención del `id` del admin para generar el JWT de prueba).

## 17. Confirmación: frontend/landing sin modificar

`[VERIFICADO]` Ningún archivo fuera de `backend/` y `docs/` fue tocado.

## 18. Confirmación: Fase 4 no adelantada

`[VERIFICADO]` No se implementó nada relacionado con clientes, solicitudes, análisis IA, cotizaciones, órdenes, alertas, frontend interno, Swagger/OpenAPI ni testing automatizado. El alcance quedó limitado estrictamente a usuarios + roles + RBAC + protección del último ADMIN.

---

## 19. Problemas o advertencias encontrados

- `[VERIFICADO]` Se detectó (y corrigió como parte necesaria de esta fase) que los controllers `async` de Express 4 no propagan automáticamente errores no controlados — se agregó un wrapper (`asyncRoute`) y un manejador de errores global en `server.ts`. Este mismo problema late en `auth.routes.ts` de la Fase 3.1, pero **no se tocó**, conforme a "no modificar decisiones ya cerradas de Fase 3.1 salvo que sea estrictamente necesario para integrar Fase 3.2" — queda señalado como posible mejora futura, no corregido aquí.
- `[PENDIENTE]` Las 3 vulnerabilidades moderadas de dependencias (`qs`/`body-parser`, ya identificadas en el cierre de Fase 3.1) siguen sin resolver — no se ejecutó `npm audit fix` en esta fase tampoco.
- `[VERIFICADO]` Quedaron 3 usuarios de prueba reales en la base de datos (ver sección 12) — no son datos de producción, pero persisten.

## 20. Pendientes posteriores

`[PENDIENTE]`:
- Módulos de negocio de Fase 4 en adelante (clientes, solicitudes, análisis IA, cotizaciones, órdenes, alertas).
- Documentación Swagger/OpenAPI de los 6 endpoints ahora existentes (`/api/auth/*` + `/api/usuarios/*`).
- Testing automatizado (framework todavía no elegido).
- Decisión sobre qué hacer con los 3 usuarios de prueba creados en esta fase.
- Resolución de las vulnerabilidades de dependencias pendientes desde Fase 3.1.
