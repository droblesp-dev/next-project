# 05 · Flujos de negocio y máquinas de estado

> **[VERIFICADO]** contra `services/*.ts`, `repositories/*.ts` y los `CHECK` de PostgreSQL. Las transiciones se aplican en el servicio; el `CHECK` solo restringe los valores posibles.

## 1. Solicitud (`solicitudes.estado`)
```
NUEVA ──► EN_REVISION ──► COTIZADA   (solo automático, al ENVIAR la cotización)
  │            │
  └──► CANCELADA ◄─┘            COTIZADA y CANCELADA son terminales
```
- Manual (COMERCIAL): `NUEVA→EN_REVISION`, `NUEVA|EN_REVISION→CANCELADA`.
- `COTIZADA` **no** es alcanzable manualmente: la cotización ENVIADA la fija en la misma transacción.
- **Creación pública**: `POST /api/solicitudes` con `Idempotency-Key` (evita duplicados por doble clic/reintento). Normaliza el correo, **reutiliza o crea el cliente por correo**, vincula un lead "huérfano" (mismo teléfono + correo, sin solicitud) o crea uno, asigna código `SOL-######` y envía correo de confirmación (el fallo del correo nunca invalida la solicitud).
- El campo `servicio` es **texto libre validado**; no hay tabla de servicios. `cantidad` > 0 (puede indicarse "aún no conocida" y queda anotado).

## 2. Análisis con IA (`analisis_ia`)
- Solo para solicitudes `EN_REVISION`. Cada ejecución crea una fila (1:N con la solicitud) que **siempre termina** en `COMPLETADO` o `ERROR` (nunca queda colgada en `PROCESANDO`).
- Salida estructurada exigida (esquema nativo del SDK): `resumen`, `prioridad_sugerida` ∈ ALTA/MEDIA/BAJA e `informacion_estructurada` con `material_estimado`, `proceso_estimado` e `informacion_faltante[]`. Se valida estrictamente; una prioridad fuera de contrato se descarta a `NULL`. **`material_estimado` y `proceso_estimado` son específicos del mecanizado**: al clonar, se sustituyen por los campos de tu negocio.
- **No se envían datos personales del cliente** al proveedor; no toma decisiones de precio ni comerciales.
- `revisado` / `revisado_por` / `revisado_en`: la revisión humana es el control. Un análisis no completado no puede revisarse.

## 3. Cotización (`cotizaciones.estado`)
```
BORRADOR ──► ENVIADA ──► ACEPTADA   (solo el cliente, con enlace + código)
   │            ├──────► RECHAZADA  (solo el cliente)
   │            ├──────► VENCIDA    (automático por fecha_vigencia, o manual)
   └────────────┴──────► CANCELADA  (administrativa)
```
- Crear exige solicitud `EN_REVISION`. **Una sola `ACEPTADA` por solicitud** (índice único parcial).
- **Edición** de condiciones: solo en `BORRADOR`.
- **Cálculo automático** (valores por defecto y permitidos, configurables en el servicio):

| Concepto | Defecto | Permitidos |
|---|---|---|
| IVA | 15 % | 0, 15 |
| Anticipo | 50 % | 0, 50, 75 |
| Vigencia | 15 días | entero > 0 |
| Método de anticipo/saldo | — | `TRANSFERENCIA`, `EFECTIVO` |

`subtotal = valor`, `iva_valor`, `total`, `anticipo_valor = total × %`, `saldo_pendiente = total − anticipo`. Si el anticipo es 0 %, `estado_anticipo = NO_APLICA` y no se admite método; si es > 0, el método es obligatorio y `estado_anticipo = PENDIENTE`.
- **Enviar** (`BORRADOR→ENVIADA`): marca la solicitud `COTIZADA` en la misma transacción y se genera el **enlace**.
- **Vencimiento perezoso**: sin cron; `marcarVencidasSiCorresponde()` corrige estados al listar/consultar.

### Enlace público y código de acceso
- Enlace = **JWT firmado (HS256)** con `COTIZACION_LINK_SECRET`, vigencia **30 días**, propósito `cotizacion_publica`. Nunca se acepta un UUID directo.
- **Código de 6 dígitos** (`crypto.randomInt`), guardado como **hash bcrypt** (`acceso_codigo_hash`), enviado por correo.
- Intentos fallidos: **5** → bloqueo **15 min** (por cotización, en memoria).
- **Recuperar código perdido (OTP)**: solicitar (máx. **5/hora**), el OTP vale **10 min**, máx. **3 fallos** → bloqueo; al verificar se **regenera** el código y se envía por correo.
- Si la cotización está `VENCIDA`/`RECHAZADA`/`CANCELADA`, el enlace deja de ser útil.

## 4. Pagos: anticipo y saldo
```
Anticipo:  NO_APLICA (0 %)            ──► crea la orden al ACEPTAR
           PENDIENTE ──► (cliente sube comprobante) ──► VALIDADO | RECHAZADO
                                                  VALIDADO ──► crea la orden
Saldo:     PENDIENTE ──► VALIDADO | RECHAZADO   (nunca NO_APLICA; reabrible tras rechazo)
```
- Subida del comprobante: PDF/JPG/PNG ≤ 5 MB, **tipo verificado por firma binaria**, nombre = UUID.
- `TRANSFERENCIA` exige comprobante recibido para validar; `EFECTIVO` no.
- Validación siempre por ADMIN/COMERCIAL (`anticipo_confirmado_por`, `saldo_confirmado_por`).
- `transferencias_pago` conserva el **historial**: un solo registro `vigente` por cotización+tipo; guarda un **snapshot** de la cuenta receptora (banco, titular, tipo, número) para que cambios posteriores no alteren el historial; banco de origen declarado y motivo de rechazo con catálogo cerrado.
- Cuentas receptoras administradas por ADMIN (`cuentas_bancarias`) con logo propio o heredado del catálogo (`bancos_catalogo`).

## 5. Orden de trabajo (`ordenes.estado`)
```
PENDIENTE ──► EN_PROCESO ◄──► PAUSADA
                  │
                  └──► FINALIZADA ──► CERRADA   (solo por el endpoint de cierre)
   cualquiera de PENDIENTE/EN_PROCESO/PAUSADA ──► CANCELADA (con motivo obligatorio)
```
- **Creación**: automática al aceptar la cotización (anticipo `NO_APLICA`) o al **validar el anticipo**; manual por ADMIN/COMERCIAL. Requisitos: cotización `ACEPTADA` y anticipo `NO_APLICA`/`VALIDADO`. Una orden por cotización (`UNIQUE(cotizacion_id)`).
- El **responsable por defecto** sale de `OPERATIVO_POR_DEFECTO_EMAIL` (debe existir, estar activo y ser OPERATIVO); si no es válido, la orden automática **no se crea** y se registra en el log (se puede crear a mano).
- **Ficha técnica**: se genera con IA al crear la orden (sin esperar; si falla, no hay fila y se puede regenerar a mano).
- **Avance** 0–100, solo ascendente, no se modifica en estados terminales ni en `PENDIENTE`.
- **FINALIZADA** exige `avance = 100` y **≥ 1 evidencia** (foto o PDF); admite observación final.
- **Entrega** (`PATCH /:id/entrega`): confirma la entrega física sobre una orden `FINALIZADA`.
- **Cierre** (`PATCH /:id/cerrar`): exige orden `FINALIZADA` **+ entrega confirmada + saldo `VALIDADO`**.
- **Cancelar** exige motivo; **reprogramar** la fecha de entrega no se permite en `CERRADA`/`CANCELADA` ni anterior al inicio.
- Reasignar responsable no se permite en `FINALIZADA`/`CERRADA`/`CANCELADA`.

## 6. Alertas (`alertas`)
- Tipo `ENTREGA`, condiciones `VENCIDA` (fecha de entrega pasada) y `PROXIMA` (en los próximos **3 días**) para órdenes que no estén `CERRADA`/`CANCELADA`; tipo `FICHA_TECNICA` condición `INCONSISTENCIA` cuando la ficha detecta contradicciones.
- **Únicas** por `(orden_id, tipo, condicion)`; si una alerta `CANCELADA` vuelve a aplicar, se **reactiva**; si deja de aplicar, se **cancela** por obsoleta.
- Se generan/actualizan al consultar (`POST /generar` o lectura); sin scheduler.
- `leida`, `leida_en` y `estado` (`PENDIENTE`, `ENVIADA`, `ATENDIDA`, `CANCELADA`); atender = `ATENDIDA`.
- Visibilidad por rol: ADMIN todas, OPERATIVO las de sus órdenes, COMERCIAL solo tipo `ENTREGA`.

## 7. Leads (mini-CRM)
- `estado` ∈ `ACTIVO`, `DESCARTADO`; `fuente` ∈ `WEB`, `WHATSAPP`, `FACEBOOK`, `INSTAGRAM`, `TIKTOK`, `REFERIDO`, `OTRO`.
- `clasificacion`: `FRIO → TIBIO → CALIENTE → CONVERTIDO → RECURRENTE`:
  - `FRIO`: lead recién captado ("hablar con un asesor" o formulario).
  - `TIBIO`: al registrar el primer seguimiento; puede recibir un **enlace de solicitud** (JWT con `LEAD_LINK_SECRET`, **7 días, uso único**) para completar su solicitud sin login.
  - `CALIENTE`: al vincular una solicitud existente (efecto real, no etiqueta manual).
  - `CONVERTIDO`: requiere `CALIENTE`; se aplica **automáticamente al aceptar la cotización** (misma transacción) o manualmente con validaciones.
  - `RECURRENTE`: requiere `CONVERTIDO` (cliente que vuelve).
- Nunca se degrada una clasificación más avanzada; leads `DESCARTADO`/`CONVERTIDO`/`RECURRENTE` no se re-vinculan.
- Asignación de comercial: solo ADMIN. Seguimientos: `LLAMADA`, `WHATSAPP`, `EMAIL`, `VISITA`, `OTRO`.

## 8. Chat interno por solicitud (`solicitud_mensajes`)
- Autores `COMERCIAL`, `OPERATIVO` o `NEXIA` (asistente, sin autor de usuario). Contenido 1–N caracteres (recortado, sin truncar).
- **Solo lectura** cuando la orden asociada está en estado terminal (`FINALIZADA`, `CERRADA`, `CANCELADA`) o la solicitud está `CANCELADA`.
- Lectura: COMERCIAL/ADMIN siempre; OPERATIVO solo si no hay orden o si es su responsable.
- **NexIA** se invoca solo si el mensaje **empieza** por "nexia" (sin distinguir mayúsculas); recibe únicamente los últimos N mensajes de contexto; con límite por usuario (20 invocaciones/min).

## 9. Dashboard (solo lectura, ADMIN)
Conteos por estado de solicitudes, cotizaciones y órdenes; suma de `valor` de cotizaciones aceptadas; alertas pendientes/atendidas; leads por clasificación; resumen de análisis IA (ejecuciones, completadas, con error, revisadas). **No crea tablas**: solo agrega datos existentes.

## Efectos secundarios y garantías transversales
| Evento | Efecto | Garantía |
|---|---|---|
| Crear solicitud | Cliente (upsert por correo), lead, código, correo de confirmación | Idempotente |
| Enviar cotización | Solicitud → `COTIZADA`, enlace + correo | Misma transacción |
| Aceptar cotización (cliente) | `ACEPTADA`, lead → `CONVERTIDO`, orden si anticipo `NO_APLICA` | Transacción; el fallo de orden no revierte la aceptación |
| Validar anticipo | Orden automática + ficha técnica | Nunca lanza |
| Cambio de contraseña | `session_version++`, otras sesiones caen, correo de aviso | Token nuevo para la sesión actual |
