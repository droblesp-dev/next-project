# NEXTPROJECT — REGLAS DE DESARROLLO

## 1. Propósito del documento

Este documento contiene las reglas generales, decisiones arquitectónicas y criterios de desarrollo permanentes de NEXTPROJECT — un sistema para la gestión de solicitudes, análisis técnico asistido por IA, cotizaciones y órdenes de trabajo de un centro de mecanizado industrial.

El proyecto evoluciona progresivamente desde un MVP funcional hacia una solución mantenible, segura, escalable y defendible académicamente.

**CLAUDE.md es el documento base y está congelado** (ver §28). Las instrucciones específicas de cada fase se entregan mediante prompts independientes, no mediante ediciones de este archivo.

---

## 2. Principios fundamentales

**Prioridades permanentes:**

1. Veracidad
2. Evidencia
3. Coherencia
4. Seguridad
5. Viabilidad técnica
6. Trazabilidad
7. Mantenibilidad
8. Escalabilidad razonable
9. Defendibilidad académica

**Claude no debe inventar:** datos, resultados, pruebas, usuarios, contraseñas, hashes, endpoints, funcionalidades, implementaciones, fuentes, ni decisiones no aprobadas.

**Diferenciar siempre mediante etiquetas:**

- `[VERIFICADO]` — comprobado mediante archivos, código, base de datos o pruebas reales.
- `[DECISIÓN]` — decisión aprobada y vigente del proyecto.
- `[PROPUESTA]` — alternativa técnica todavía no aprobada.
- `[SUPUESTO]` — información temporal que requiere validación.
- `[PENDIENTE]` — información o trabajo que todavía no existe.
- `[REQUIERE VALIDACIÓN]` — información disponible que necesita confirmación.
- `[PROPUESTA DE CAMBIO]` — alternativa que contradice o modifica una decisión existente.

Nunca presentar una `PROPUESTA` o `SUPUESTO` como `VERIFICADO`. Nunca afirmar que un endpoint/conexión/consulta/prueba/funcionalidad funciona o existe sin evidencia real, ni afirmar una vulnerabilidad o resultado sin evidencia.

**Reglas mnemónicas:**

Antes de cambiar → comprender. Antes de instalar → justificar. Antes de modificar PostgreSQL → verificar y autorizar. Antes de afirmar que funciona → probar. Antes de modificar una decisión → explicar (§5). Antes de un commit → mostrar cambios y esperar autorización (§20). Antes de avanzar de fase → validar.

No inventar. No exponer secretos. No adelantar fases (§23). No modificar arquitectura sin justificación. No reconstruir lo que ya existe. No modificar lo que no sea necesario (§4).

---

## 3. Revisión antes de implementar

Ante información sobre decisiones, avances, código, resultados o cambios recientes, priorizar en este orden:

1. Estado real del proyecto.
2. Decisiones recientes aprobadas por el usuario.
3. Archivos actuales.
4. Base de datos actual verificada.
5. Documentación institucional.
6. Este CLAUDE.md.
7. Propuestas técnicas.

Antes de una tarea importante:

1. **Inspeccionar** el estado real (código, BD, decisiones y cambios recientes).
2. **Proponer** qué se hará y por qué.
3. **Validar alcance** — confirmar que corresponde a la fase autorizada.
4. **Implementar** únicamente lo necesario.
5. **Probar** con pruebas apropiadas.
6. **Analizar resultados**, distinguiendo prueba planificada / ejecutada / resultado obtenido (§21).
7. **Informar** resultados y evidencias.
8. **Detenerse** — no continuar automáticamente.

No repetir trabajo ya realizado ni modificar componentes innecesarios para la tarea.

---

## 4. Regla de mínimo cambio

Implementar únicamente lo necesario para cumplir el objetivo autorizado.

No realizar por iniciativa propia: refactorizaciones innecesarias, reorganización de carpetas, reemplazo de tecnologías aprobadas, cambios de arquitectura, nuevas abstracciones, dependencias innecesarias, ni cambios funcionales no solicitados.

Priorizar: **cambio mínimo + funcionalidad real + mantenibilidad + escalabilidad razonable.**

---

## 5. Decisiones arquitectónicas y cambios críticos

Se consideran cambios críticos: tema, problema, objetivo general, objetivos específicos, alcance, caso de estudio, producto tecnológico, arquitectura, metodología, tecnologías principales, estructura fundamental de PostgreSQL, y cualquier cambio de stack tecnológico.

Claude no debe modificar silenciosamente una decisión crítica ya aprobada. Si una implementación requiere cambiarla, detenerse **antes** de aplicar el cambio y presentar:

```
DECISIÓN ACTUAL:      qué está aprobado hoy.
PROPUESTA DE CAMBIO:  qué se pretende modificar.
JUSTIFICACIÓN:        por qué es necesario.
IMPACTO:               qué componentes se afectan.
RIESGOS:               qué puede salir mal.
ALTERNATIVAS:          qué otras opciones existen.
RECOMENDACIÓN:         cuál es la más conveniente y por qué.
```

Esperar validación explícita antes de aplicar el cambio. No convertir una propuesta en decisión automáticamente.

---

## 6. Stack tecnológico aprobado

- **Frontend:** React + TypeScript + Vite.
- **Backend:** Node.js + Express + TypeScript.
- **Base de datos:** PostgreSQL (`nextproject`).
- **Acceso a PostgreSQL:** `pg` (node-postgres) + SQL directo + patrón Repository. **No usar ORM** (Prisma, Sequelize, TypeORM, Drizzle u otros) salvo autorización explícita.
- **Autenticación:** `bcryptjs` para hash/verificación de contraseñas; JWT para tokens, cuando corresponda a la fase.
- **Documentación de API:** Swagger/OpenAPI (§16), documentando únicamente endpoints reales.
- **Python:** no forma parte del backend principal (ver §17, límites del módulo de IA).

---

## 7. Estructura general del proyecto

```
/
├── backend/
├── database/
├── src/
├── CLAUDE.md
├── package.json
└── ...
```

Antes de crear una carpeta nueva: inspeccionar la estructura existente, comprobar si ya hay una ubicación adecuada, reutilizarla, y crear una nueva únicamente si está justificada. No reorganizar globalmente el proyecto ni eliminar carpetas sin comprobar antes su función.

---

## 8. Frontend — conservación del diseño

El diseño visual actual de NEXTPROJECT está **aprobado** y debe conservarse como base. No reconstruir la landing ni rediseñar por iniciativa propia. No modificar innecesariamente: colores, tipografías, tamaños, espaciados, distribución, imágenes, componentes (tarjetas, botones, navegación, footer), secciones, identidad visual ni estilo industrial general.

Prioridad: **frontend existente → conservar → agregar funcionalidad → minimizar cambios visuales.**

Una modificación visual solo se permite si es técnicamente necesaria, necesaria para usabilidad, necesaria para integrar una funcionalidad, o solicitada expresamente — y debe explicarse antes de ejecutarse.

---

## 9. PostgreSQL — modelo aprobado

**[DECISIÓN]** La base `nextproject` mantiene exactamente **8 tablas**: `roles`, `usuarios`, `clientes`, `solicitudes`, `analisis_ia`, `cotizaciones`, `ordenes`, `alertas`. Este es el modelo físico actualmente aprobado.

No crear tablas adicionales sin autorización — en particular no crear automáticamente `pagos`, `facturas`, `dashboard`, `historial`, `seguimiento_orden`, `notificaciones` u otras entidades no aprobadas. Un dashboard debe representar datos ya existentes, nunca convertirse por sí mismo en una tabla nueva.

**Decisiones estructurales aprobadas:**

- UUID como PK y FK donde corresponda.
- Estados mediante VARCHAR + CHECK cuando corresponda.
- `clientes.email` y `clientes.telefono` son `NOT NULL`.
- `solicitudes → analisis_ia` mantiene relación 1:N.
- `analisis_ia.prioridad_sugerida` permite ALTA, MEDIA, BAJA o NULL.
- `analisis_ia` registra `modelo_ia`, `version_ia` y `estado_analisis`.
- `estado_analisis` permite PENDIENTE, PROCESANDO, COMPLETADO, ERROR.
- `cotizaciones.valor` es obligatorio y no debe ser negativo.
- `cotizaciones.fecha_vigencia` utiliza TIMESTAMPTZ.
- Una sola cotización `ACEPTADA` por solicitud.
- Una orden pertenece a una cotización; `ordenes.responsable_id` puede ser NULL al crearla.
- `ordenes.codigo` es el identificador de la orden; su unicidad debe garantizarse; la estrategia de generación automática respeta la decisión aprobada en la fase correspondiente.
- Las alertas equivalentes por orden + tipo + condición deben evitar duplicarse.
- No existe relación directa entre `analisis_ia` y `cotizaciones`.
- Las reglas de negocio que no correspondan a constraints de PostgreSQL se implementan en el backend (ver §10).

**Integridad y seguridad:** mantener las FK existentes y sus políticas `ON DELETE` actuales salvo autorización; las FK nuevas usan la política aprobada para el modelo. No eliminar constraints ni desactivar restricciones temporalmente para facilitar una inserción o evitar un error. No ejecutar SQL destructivo como solución rápida.

**Importante:** no asumir que una regla de negocio es automáticamente un constraint de PostgreSQL. Antes de modificar el esquema, comprobar la estructura real.

---

## 10. Reglas de negocio vs PostgreSQL

**Garantizadas por PostgreSQL:** PK, FK, NOT NULL, CHECK, UNIQUE, índices, integridad referencial.

**Garantizadas por el backend:** transiciones de estado, autorización por rol, permisos, validación de aceptación de cotizaciones, validación de anticipo, generación de código de orden, reglas comerciales, reglas de IA, validaciones cruzadas, flujos de negocio.

No trasladar automáticamente una regla de negocio al esquema de PostgreSQL. Si se considera necesario un trigger o constraint adicional: explicar la razón, justificar técnicamente, indicar el impacto, y solicitar autorización cuando represente un cambio arquitectónico.

---

## 11. Roles aprobados

**[DECISIÓN]** Roles internos: `ADMIN`, `COMERCIAL`, `OPERATIVO`. `CLIENTE` no se implementa como rol interno en esta etapa — la entidad `clientes` se mantiene separada de `usuarios`. No crear ni insertar roles adicionales sin autorización.

- **ADMIN** — administración y supervisión general.
- **COMERCIAL** — gestión de solicitudes, revisión de análisis y preparación de cotizaciones.
- **OPERATIVO** — gestión y actualización de órdenes de trabajo.

---

## 12. Operaciones y autorización

**Siempre permitido** (inspección, no requiere autorización): `git status`/`diff`/`log`, listar/leer archivos, buscar archivos, inspeccionar `package.json` y configuraciones, revisión estática de código. La inspección **no** constituye autorización para modificar el proyecto.

**Requieren autorización:** `git commit`, `git push`, `npm install`/`uninstall`, migraciones, SQL modificatorio (`INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER`/`DROP`/`TRUNCATE`), cambios destructivos, modificaciones arquitectónicas, instalación de tecnologías futuras, y cualquier cambio fuera del alcance de la fase actual.

En PostgreSQL, distinguir **datos** (`INSERT`/`UPDATE`/`DELETE`, ejecutables solo dentro de una fase autorizada) de **estructura/esquema** (`CREATE`/`ALTER`/`DROP`/`TRUNCATE`, siempre requieren autorización explícita). Nunca ejecutar operaciones destructivas por iniciativa propia.

**Qué constituye autorización:** una solicitud de análisis, revisión, explicación, propuesta o diseño **no** autoriza modificar el proyecto. Una instrucción explícita de implementación **sí** autoriza los cambios técnicos necesarios dentro del alcance indicado (ej. "Implementa Fase 3.1" autoriza; "¿Qué propones para Fase 3.1?" no autoriza). Una fase explícitamente autorizada permite los cambios necesarios dentro de su alcance. Si durante una implementación autorizada surge una decisión crítica no contemplada: **detenerse** (ver §5).

---

## 13. Seguridad y secretos

Nunca almacenar contraseñas en texto plano ni directamente en el código: contraseñas, API keys, JWT secrets, credenciales de PostgreSQL, tokens o secretos de servicios externos — usar variables de entorno o mecanismos locales seguros.

Nunca mostrar secretos en consola, logs, respuestas, commits, documentación, capturas o archivos versionados.

`.env` y cualquier secreto local (incluido `.local-secrets/`) deben permanecer fuera de Git.

---

## 14. Autenticación

Contraseñas mediante `bcryptjs`; tokens mediante JWT. Las contraseñas se almacenan únicamente como hash seguro — nunca la contraseña original. Nunca imprimir contraseña o hash innecesariamente.

Login, JWT, middleware, `/api/auth/me` y autorización por rol se implementan únicamente en la fase autorizada para ello. No crear autenticación adicional o paralela.

---

## 15. Desarrollo backend

Cada endpoint debe: tener un propósito definido, validar entradas, manejar errores, respetar autenticación y autorización por rol cuando corresponda, usar consultas parametrizadas, y evitar exposición innecesaria de datos.

No crear endpoints futuros antes de la fase correspondiente ni implementar funcionalidades no solicitadas. No afirmar que un endpoint, módulo o funcionalidad existe hasta que esté realmente implementado y verificado.

---

## 16. Documentación de API — Swagger/OpenAPI

Swagger/OpenAPI se usa para documentar la API, visualizar endpoints, documentar contratos, facilitar pruebas y apoyar la defensa técnica. Debe representar únicamente endpoints realmente implementados — no inventar ni documentar funcionalidades futuras como si existieran. Se incorpora en la fase correspondiente; no instalarlo anticipadamente sin autorización.

---

## 17. Inteligencia Artificial

La IA es un módulo especializado y **asistente del sistema** — no toma decisiones comerciales definitivas; la revisión humana es obligatoria antes de emitir una cotización. No afirmar resultados, precisión, métricas o modelos de IA sin pruebas reales.

Posibles funciones futuras: análisis de solicitudes, clasificación, extracción de información, identificación de información faltante, sugerencia de prioridad, procesamiento de documentos/técnico, Machine Learning, visión artificial (si está justificada).

Python **no** forma parte del backend principal (Node.js + Express + TypeScript se mantiene). Python podrá incorporarse más adelante, únicamente para funciones especializadas de IA con necesidad técnica concreta y justificación:

```
React → Node.js + Express → Módulo IA → Python / servicios de IA
      → Resultado → Node.js → PostgreSQL
```

No instalar Python, SDKs de IA, modelos, frameworks de ML ni librerías de IA antes de la fase correspondiente.

---

## 18. Herramientas de apoyo

Las herramientas de apoyo (asistentes, extensiones, skills, IA de desarrollo) son medios opcionales y no sustituyen las decisiones arquitectónicas del proyecto. Toda herramienta incorporada debe justificar utilidad, impacto, seguridad, mantenimiento, compatibilidad y necesidad real. No instalar nada únicamente por recomendación externa o porque "podría ser útil más adelante".

Brainstorming: las ideas exploradas son `PROPUESTA` hasta ser aprobadas. UI/UX: puede usarse para analizar/mejorar experiencia, nunca para rediseñar automáticamente la interfaz aprobada (§8).

---

## 19. Dependencias

Antes de instalar: identificar la necesidad, explicar para qué se usará, verificar si ya existe una solución con las dependencias actuales, evaluar impacto, e instalar solo si está justificado. No instalar por moda o conveniencia personal.

Después de instalar: revisar `package.json` y `package-lock.json`, ejecutar las validaciones correspondientes, y comprobar vulnerabilidades cuando corresponda. No ejecutar `npm audit fix` automáticamente si puede cambiar versiones relevantes sin revisión.

---

## 20. Git — control de versiones

Git es obligatorio para mantener trazabilidad. Antes de cambios importantes: `git status`. Después de cambios: `git status` + `git diff`.

Claude **no** debe ejecutar automáticamente `git commit` ni `git push`. Antes de un commit solicitado por el usuario, mostrar: archivos creados, modificados y eliminados; resumen del cambio; diff relevante; y estado actual de Git. El usuario decide si se realiza el commit — nunca hacerlo silenciosamente.

---

## 21. Pruebas y evidencia

Diferenciar siempre: **prueba planificada** (aún no ejecutada) vs. **prueba ejecutada** (realmente realizada) vs. **resultado obtenido** (resultado real de una prueba ejecutada). Nunca presentar una prueba planificada como resultado.

Cuando corresponda, documentar: objetivo, procedimiento, datos utilizados, resultado esperado, resultado obtenido, evidencia y estado. Una prueba fallida se reporta como fallida — no ocultar errores para presentar una fase como exitosa.

---

## 22. Manejo de errores

Ante un error: identificarlo, determinar si es bloqueante, investigar su causa, no ocultarlo, no aplicar soluciones destructivas, informar el impacto y proponer una solución.

Si la solución requiere un cambio crítico, **detenerse** y presentar:

```
ESTADO / HALLAZGO / CAUSA / IMPACTO / RIESGOS / ALTERNATIVAS / RECOMENDACIÓN
```

Esperar validación antes de continuar.

---

## 23. Regla de no adelantar fases

No implementar funcionalidades de fases posteriores solo porque sea técnicamente posible. En particular, no: crear endpoints o tablas futuras, implementar IA o instalar Python/SDKs de IA antes de su fase, implementar automatizaciones, crear dashboard, modificar el frontend para funcionalidades futuras, ni instalar Swagger antes de su fase (salvo autorización explícita). El proyecto evoluciona incrementalmente.

---

## 24. Plan general de evolución

Evolución orientativa (ajustable mediante decisión aprobada; no iniciar una fase automáticamente):

```
FASE 1  Auditoría
FASE 2  Preparación del proyecto
FASE 3  Backend y autenticación
FASE 4  Base de datos / evolución del modelo
FASE 5  Formulario real de solicitudes
FASE 6  Área privada
FASE 7  Cotizaciones
FASE 8  Órdenes de trabajo
FASE 9  IA
FASE 10 Automatización
FASE 11 Dashboard
FASE 12 Pruebas y demostración
```

---

## 25. Cierre de fase

Al finalizar una fase o tarea importante, entregar: estado final; qué se hizo; archivos creados/modificados/eliminados; dependencias agregadas/eliminadas; scripts creados o modificados; comandos ejecutados; pruebas realizadas; resultados obtenidos; errores y advertencias; cambios en PostgreSQL; cambios en frontend; estado de Git; pendientes; riesgos restantes; evidencias relevantes.

Después del informe: **detenerse**. No iniciar automáticamente la siguiente fase — esperar autorización del usuario.

---

## 26. Modo defensa académica

Para decisiones técnicas importantes, considerar posibles preguntas del tribunal: ¿cuál es el problema?, ¿por qué es relevante?, ¿por qué esta solución/metodología/tecnologías?, ¿cómo se validó?, ¿qué resultados se obtuvieron?, ¿cuáles son las limitaciones?, ¿qué evidencia demuestra el funcionamiento?, ¿qué parte está realmente implementada y qué parte es trabajo futuro?

Las respuestas deben basarse en evidencia real — no inventar resultados para mejorar la presentación académica.

---

## 27. Modo revisor crítico

Claude debe evaluar las propuestas y no aceptarlas automáticamente. Analizar viabilidad técnica, alcance, tiempo, recursos, posibilidad real de desarrollo y de pruebas, evidencia disponible, coherencia metodológica, calidad académica y defendibilidad. Si detecta una debilidad importante, debe señalarla antes de continuar.

---

## 28. Regla de congelación de CLAUDE.md

**[DECISIÓN]** A partir de esta limpieza, CLAUDE.md queda **congelado** como documento base del proyecto.

No modificar CLAUDE.md para: nuevas fases, nuevas funcionalidades, correcciones menores, prompts específicos, decisiones propias de una fase, o instrucciones temporales. Las instrucciones de cada fase se entregan mediante prompts independientes y pequeños.

Solo se modifica nuevamente CLAUDE.md si el usuario solicita explícitamente cambiar las reglas generales del proyecto.

---

*Fin de CLAUDE.md*
