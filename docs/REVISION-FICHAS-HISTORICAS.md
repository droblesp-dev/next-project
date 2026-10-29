# Revisión manual dirigida de las fichas técnicas existentes (D2 = F2)

Estado: **preparada; no ejecutada en producción**. No modifica, regenera ni sobrescribe ninguna ficha. La lista de candidatas se
obtiene con una consulta de solo lectura que requiere autorización específica en producción.

## 1. Por qué

Antes del cambio de privacidad, el contexto de IA de la ficha técnica incluía los últimos 20 mensajes de la solicitud con su
autor, respuestas de NexIA incluidas. Una ficha ya generada puede contener texto derivado de una respuesta que hoy es privada.
Esa información no se puede corregir con código: se revisa a mano.

## 2. Lista de fichas candidatas (solo identificadores, sin contenido)

```sql
SELECT f.id AS ficha_id, o.codigo AS orden, count(*) AS respuestas_nexia_previas, min(m.creado_en) AS primera, max(m.creado_en) AS ultima
FROM fichas_tecnicas f
JOIN ordenes o ON o.id = f.orden_id
JOIN cotizaciones c ON c.id = o.cotizacion_id
JOIN solicitud_mensajes m ON m.solicitud_id = c.solicitud_id AND m.autor_tipo = 'NEXIA' AND m.creado_en < f.generado_en
GROUP BY f.id, o.codigo ORDER BY o.codigo;
```
Criterio conservador: candidata = ficha de una solicitud con alguna respuesta de NexIA anterior a `generado_en`. Una ficha que no
aparece no tuvo respuestas de NexIA en el contexto. Validada en la base de pruebas (devuelve fichas candidatas con su número de
respuestas); el recuento real de producción no se ha consultado.

## 3. Procedimiento de revisión (persona designada por el responsable del proyecto)

1. Obtener la lista del apartado 2 (con autorización) y asignar un identificador de revisión a cada ficha.
2. Para cada ficha, abrirla **solo con los permisos normales de lectura** (ADMIN o COMERCIAL) y comparar su contenido con los
   mensajes compartidos de la solicitud (los que escribieron COMERCIAL y OPERATIVO), que son los únicos que hoy forman el contexto.
3. Marcar qué partes de la ficha no se explican por mensajes compartidos ni por la propia solicitud: son sospechosas de proceder de
   una respuesta de NexIA.
4. Decidir caso por caso: sin hallazgo; hallazgo menor (dato técnico genérico); hallazgo relevante (información que solo estaba
   en una respuesta privada).
5. Para un hallazgo relevante, **no editar la ficha**: informar al responsable del proyecto, que decide el tratamiento (por
   ejemplo, una nota aparte o un procedimiento específico de corrección con autorización y respaldo).
6. Registrar el resultado **fuera de la base** (informe o plantilla de §4). No se crean tablas ni columnas.

## 4. Plantilla de registro

| ficha_id | orden | revisor | fecha | resultado (sin hallazgo / menor / relevante) | partes sospechosas | acción decidida por el responsable |
|---|---|---|---|---|---|---|

## 5. Reglas

- Ninguna ficha se regenera (el servicio lo impide) ni se sobrescribe.
- La revisión no cambia permisos: ADMIN conserva el acceso a las fichas y no al chat.
- Las respuestas privadas de NexIA no se muestran al revisor: se compara contra mensajes compartidos.
- La revisión no exige contar mensajes históricos de NexIA (conteo prohibido) ni acceder a su texto.
- Criterio de cierre: todas las fichas candidatas con resultado registrado y las de hallazgo relevante resueltas por decisión
  escrita del responsable del proyecto.
