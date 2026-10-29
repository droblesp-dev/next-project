# Barrera de credenciales contra instancias antiguas (alternativa A): ensayo y procedimiento

Estado: **ensayada únicamente en `nextproject_ensayo`** (copia local restaurada del respaldo de la base de pruebas). No se ha
creado ninguna cuenta ni se ha cambiado ningún permiso en `nextproject` ni en `nextproject_test`. Aplicarla en producción
requiere autorización específica (crear cuentas, cambiar permisos y terminar conexiones).

No contiene contraseñas: se usan marcadores (`<clave-generada>`). Las contraseñas del ensayo eran aleatorias y descartables y
están fuera del repositorio.

## 1. Objetivo y alcance

Las capas operativas (artefactos antiguos retirados y verificación de `application_name`) detectan instancias antiguas pero
no impiden que una conexión con credenciales válidas lea la base. La barrera consiste en que **solo la versión nueva** disponga
de credenciales con permiso de conexión: la cuenta antigua se inhabilita y sus conexiones se terminan. Así una instancia
anterior, aunque se arranque por error, no puede conectarse y falla cerrando.

## 2. Cuentas del ensayo

| Cuenta (ensayo) | Representa | Atributos |
|---|---|---|
| `nextproject_app_ensayo` | Cuenta nueva de la aplicación, permisos mínimos | `LOGIN`, sin superusuario, sin crear bases ni roles, sin salto de políticas |
| `nextproject_legacy_ensayo` | Cuenta antigua simulada (en producción es la cuenta que usa hoy el backend) | Mismos permisos que la nueva |
| `nextproject_vigia_ensayo` | Vigilancia de la huella, miembro de `pg_monitor` | `LOGIN`, solo lectura de estadísticas |

## 3. Plantilla SQL (ejecutar con la cuenta administradora; adaptar nombres y bases)

Creación de cuentas y acceso (en la base `postgres`):
```sql
CREATE ROLE <app> LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '<clave-generada>';
CREATE ROLE <vigia> LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '<clave-generada>';
GRANT pg_monitor TO <vigia>;
REVOKE ALL ON DATABASE <base> FROM PUBLIC;            -- ver §6 sobre el alcance de este REVOKE
GRANT CONNECT ON DATABASE <base> TO <app>, <vigia>;
```
Permisos mínimos (conectado a `<base>`):
```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO <app>;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO <app>;      -- la aplicación no hace DELETE ni DDL
REVOKE UPDATE ON solicitud_mensajes FROM <app>;                              -- historial de mensajes de solo añadir
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO <app>;
ALTER DEFAULT PRIVILEGES FOR ROLE <cuenta_migraciones> IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO <app>;
ALTER DEFAULT PRIVILEGES FOR ROLE <cuenta_migraciones> IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO <app>;
```
Las migraciones se siguen aplicando con la cuenta administradora (la cuenta de la aplicación no puede hacer DDL). Los privilegios
por defecto garantizan que las tablas nuevas de futuras migraciones queden accesibles sin otro paso.

## 4. Resultados del ensayo en `nextproject_ensayo`

**Permisos verificados con la cuenta de la aplicación (13 comprobaciones, todas correctas):**
- Permitido: `SELECT` de tablas, `INSERT` de mensajes, `UPDATE` de participantes (retiro) y uso de secuencias.
- Denegado: `UPDATE`, `DELETE` y `TRUNCATE` sobre `solicitud_mensajes` (historial de solo añadir para la aplicación),
  `CREATE TABLE`, `ALTER TABLE` (retirar una restricción), `DROP TABLE`, `CREATE ROLE` y lectura de contraseñas de roles.
- La cuenta es no superusuaria y no salta políticas.

**Arranque y humo HTTP (backend real contra la base de ensayo con la cuenta dedicada):** el backend arranca y conecta; login de
COMERCIAL, OPERATIVO y ADMIN; lectura de solicitudes; envío de mensajes (INSERT); respuesta privada de NexIA guardada con
destinatario y visible solo para él; contadores (C3), participantes y marcadores responden; ADMIN recibe 403 en el chat; lectura
de órdenes. La detección de esquema funciona con la cuenta de permisos mínimos.

**Barrera ensayada con la cuenta antigua simulada:** con una conexión viva de la cuenta antigua, `ALTER ROLE ... NOLOGIN` y
terminar sus conexiones dejó la conexión existente terminada y rechazó las nuevas («al rol no se le permite conectar»), mientras
la cuenta nueva siguió operativa. El control de huella visto desde la cuenta de vigilancia mostró la conexión antigua como
`(sin marca)`.

**Suite de integración (25 archivos, base de ensayo):**
- Como administradora: 270 de 271 pruebas pasan; 7 archivos no se cargan porque sus utilidades de limpieza exigen que la base
  se llame `nextproject_test` (no es un defecto: el nombre de la base de ensayo es otro).
- Con la cuenta dedicada: todo lo de chat que no requiere DDL pasa (participantes, lecturas y C3 con 22 pruebas, matriz de
  endpoints con 12, órdenes con 3 y 4). Fallan, además de lo anterior, solo pruebas que por diseño exigen privilegios que la
  aplicación no tiene: 3 de la limpieza de transferencias (`DELETE`/`TRUNCATE`), 3 de `chatPrivacidad` que usan DDL para crear un
  dato histórico, y el borrado de usuarios de prueba de `cambioPassword`. Las pruebas se siguen ejecutando con la cuenta
  administradora en la base de pruebas.

## 5. Hallazgos que condicionan el procedimiento de producción

1. **La huella exige una cuenta de vigilancia.** Con la cuenta de la aplicación, `pg_stat_activity` solo muestra su propia conexión
   (1 de 1). La comprobación del guion se ejecuta con una cuenta miembro de `pg_monitor` (o la administradora).
2. **`CONNECT` por defecto de `PUBLIC`.** Mientras no se revoque, una cuenta nueva puede conectarse a otras bases del servidor
   (en el ensayo conectó a `nextproject_test` pero no pudo leer tablas por falta de permisos). En producción conviene revocar
   `CONNECT` de `PUBLIC` sobre la base real; es un cambio sobre producción y no se hizo.
3. **Historial de mensajes de solo añadir.** Quitar `UPDATE` sobre `solicitud_mensajes` a la aplicación refuerza que el
   historial no se modifique. Si algún proceso futuro necesitara actualizarlo, se concedería de forma explícita.
4. **Pruebas.** No se deben ejecutar con la cuenta dedicada: necesitan `DELETE` y DDL.

## 6. Procedimiento propuesto para producción (cada paso requiere autorización específica)

| Paso | Acción | Riesgo y control |
|---|---|---|
| 1 | Comprobar en solo lectura los atributos de la cuenta actual (consulta 3.3 del guion) y qué permisos usa el backend | Ninguno |
| 2 | Crear la cuenta de la aplicación y la de vigilancia con las plantillas de §3, y probarlas en una copia restaurada reciente | Una cuenta mal configurada deja a la aplicación sin acceso: se prueba antes de la ventana |
| 3 | En la ventana: arrancar la versión nueva con la cuenta nueva y verificar huella | Se conserva la credencial anterior para volver atrás |
| 4 | Verificar funcionamiento y controles de reapertura | Se detiene si algo falla |
| 5 | `ALTER ROLE <cuenta_antigua> NOLOGIN` (o cambiar su clave) y terminar sus conexiones restantes | **Afecta a sesiones activas**: solo con autorización específica y con la versión nueva ya sirviendo |
| 6 | Repetir la verificación de huella (cuenta de vigilancia): solo `nextproject-api-r0` | Cualquier otra fila detiene el procedimiento |
| 7 | Guardar la credencial antigua de forma segura durante el periodo de vuelta atrás; revocarla después | Nunca en el repositorio ni en el guion |

**Vuelta atrás de la barrera:** `ALTER ROLE <cuenta_antigua> LOGIN` y volver a arrancar con ella. Mientras exista una instancia
anterior a este cambio con esa cuenta habilitada, el riesgo de lectura del historial reaparece, por lo que la vuelta atrás
debe ser transitoria y con el chat cerrado.

## 7. Qué NO se ha hecho

- No se creó ninguna cuenta ni se cambió ningún permiso en `nextproject` ni en `nextproject_test`.
- No se cambió ninguna credencial real ni la configuración (`.env`).
- Las cuentas de ensayo y la base `nextproject_ensayo` siguen existiendo en el servidor local para poder repetir el ensayo.
