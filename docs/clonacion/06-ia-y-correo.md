# 06 · Integraciones: IA (Gemini) y correo (Brevo)

## Principios de la IA **[VERIFICADO]**
1. **Asistente, nunca decisor.** Ninguna salida cambia estados, precios ni permisos. La revisión humana es obligatoria antes de cotizar (`analisis_ia.revisado`).
2. **Solo desde el backend.** La clave `GEMINI_API_KEY` nunca llega al navegador.
3. **Nunca inventar.** Los prompts prohíben suponer datos que el usuario no dio.
4. **Siempre termina.** Timeout explícito, **sin reintentos automáticos** (para no duplicar consumo de cuota) y el registro queda en `COMPLETADO` o `ERROR`.
5. **Sin datos personales** del cliente en el análisis; la clave de API se redacta si aparece en un mensaje de error.
6. **Degradación elegante.** Sin clave o con fallo del proveedor, el sistema sigue funcionando (el asistente público cae a un *modo estándar determinístico*; el análisis queda en `ERROR`; la ficha no se crea y se puede regenerar).

Configuración: `GEMINI_API_KEY`, `GEMINI_MODEL` (por defecto en `.env.example`: `gemini-3.6-flash`). SDK: `@google/genai`.

## Las cuatro funciones de IA
| # | Función | Quién la dispara | Entrada | Salida | Archivo |
|---|---|---|---|---|---|
| 1 | **Asistente de redacción del formulario** (NexIA público) | Visitante anónimo | Texto libre + servicio ya elegido | Texto breve (≤ 6 líneas, plano) que reorganiza lo escrito y sugiere 2–3 preguntas | `asistenteFormulario.service.ts` |
| 2 | **Análisis de solicitud** | COMERCIAL (solicitud `EN_REVISION`) | Servicio, descripción, cantidad, fecha, especificaciones | JSON estructurado: resumen, prioridad sugerida, material/proceso estimados, información faltante | `analisisIa.service.ts` |
| 3 | **Ficha técnica de la orden** | Automática al crear la orden / manual | Solicitud + conversación + cotización aceptada | Texto con secciones + bloque `INCONSISTENCIAS:` (si ≠ "Ninguna" ⇒ `tiene_inconsistencia = true` y alerta) | `fichaTecnica.service.ts` |
| 4 | **NexIA en el chat interno** | Mensaje que **empieza** por "nexia" | Últimos N mensajes del chat | Respuesta como autor `NEXIA` | `solicitudMensajes.service.ts` |

### Reglas del asistente público (función 1)
- **Prioridad absoluta del servicio elegido**: no cambia de servicio aunque el texto mencione otro; con "no estoy seguro" permanece neutral.
- Prohibido: inventar materiales/dimensiones/tolerancias/normas/procesos, hablar de precios/plazos, preguntar por cantidad, usar markdown.
- Incluye una *pregunta orientativa* por servicio (reformulada, no literal).
- **Límite de abuso**: 10 invocaciones por IP cada 10 min (en memoria) → 429. Requiere `TRUST_PROXY` correcto detrás de nginx.
- Contextos soportados (enum del código): `TORNO`, `FRESADO`, `FABRICACION`, `REPARACION_RECUPERACION`, `NO_ESTOY_SEGURO` ← **específico del negocio**.

### Formato de la ficha técnica (función 3)
Secciones exactas pedidas al modelo: `FICHA TÉCNICA` → `Trabajo`, `Cantidad`, `Material`, `Dimensiones`, `Acabado`, `Maquinaria/equipo`, `Tiempo estimado`, `Observaciones`, `INFORMACIÓN FALTANTE`, `INCONSISTENCIAS`. Reglas: dato ausente = "No especificado"; **sin precios ni condiciones económicas** (la ficha es solo técnica y el prompt recibe solo datos técnicos, no los montos); inconsistencias = contradicciones entre solicitud, conversación y cotización aceptada (o la palabra exacta "Ninguna"). Estas secciones son **específicas de mecanizado**: reemplázalas por las de tu rubro.

### Control de costo
- Chat: 20 invocaciones/min por usuario. Público: 10 por IP/10 min. Análisis: una llamada por clic, sin reintentos.

## Cómo adaptar la IA a otro negocio
1. Cambiar el **texto base de los prompts** (`construirPrompt`) en los 3 servicios: nombre de la empresa, tipo de trabajo, vocabulario.
2. Reemplazar `ContextoNexia` / `NOMBRE_CONTEXTO` / `PREGUNTA_ORIENTATIVA_CONTEXTO` por los servicios del nuevo negocio (y el respaldo determinístico `generarSugerenciaDeterministica`).
3. Reemplazar `material_estimado` / `proceso_estimado` del esquema de análisis (`ESQUEMA_RESPUESTA`) por los campos que importan para cotizar en tu rubro, manteniendo `resumen`, `prioridad_sugerida` e `informacion_faltante`.
4. Rehacer las secciones de la **ficha técnica** (título de secciones y reglas de "INCONSISTENCIAS").
5. Mantener intactas las salvaguardas (timeout, sin reintentos, validación estricta, redacción de clave, límite de uso).
6. Si cambias de proveedor de IA, aísla la llamada en una función y conserva el contrato de salida validado.

---

# Correo transaccional (Brevo) **[VERIFICADO]** — `services/email.service.ts`
- API HTTP de Brevo con `fetch` (sin SDK), timeout propio, remitente `NEXT_PROJECT_EMAIL` (**debe estar verificado en Brevo**).
- Variables: `BREVO_API_KEY`, `NEXT_PROJECT_EMAIL`, `BREVO_SANDBOX` (`true` ⇒ Brevo acepta pero **no entrega**), `NEXT_PROJECT_NAME`, `NEXT_PROJECT_WHATSAPP`.
- Si faltan la clave o el remitente, el envío queda **`skipped`** (se registra en logs) y el flujo continúa: **nunca bloquea** crear la solicitud ni la cotización.
- HTML con **escape de todos los datos** interpolados (`escaparHtml`) y versión de texto plano; destinatario enmascarado en logs.

| Correo | Cuándo | Contenido |
|---|---|---|
| Confirmación de solicitud | Al crear la solicitud | Código `SOL-…` y agradecimiento |
| Enlace de cotización | Al generar el enlace (`POST /cotizaciones/:id/enlace`) | Enlace firmado + código de acceso |
| Código temporal (OTP) | Recuperación de código | Código de 6 dígitos válido 10 min |
| Código de acceso regenerado | Tras verificar el OTP | Nuevo código de acceso |
| Aviso de cambio de contraseña | Al cambiar la contraseña | Advertencia de seguridad |

Al clonar: cambiar textos/branding de las plantillas, el remitente y el dominio; si prefieres otro proveedor (SES, SendGrid, SMTP), reemplaza solo las funciones `enviar…` conservando el contrato `ResultadoEnvioCorreo` (`{estado:'sent'}` · `{estado:'failed', error}` · `{estado:'skipped', motivo}`).

---

# WhatsApp
Solo enlaces `wa.me` con texto prellenado (`VITE_NEXT_PROJECT_WHATSAPP`); **no hay integración con la API de WhatsApp**. **[VERIFICADO]**
