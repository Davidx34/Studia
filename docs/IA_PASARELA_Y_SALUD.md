# Pasarela de IA unificada y salud persistente (iteración 5)

La pasarela (`src/lib/ai/gateway/`) ya decidía a qué proveedor va cada tarea de texto, con respaldo, cortacircuito y orden adaptativo. Pero tres sitios seguían llamando a Cohere (y dos a OpenRouter) **a mano**, cada uno con su propio reintento y sin cortacircuito. Esta iteración los mete en la pasarela, hace que los bloqueos largos sobrevivan a los arranques en frío y afina el margen de tokens de los modelos que razonan. Además, el verificador de PDF detecta tablas transpuestas.

## 1. Cohere es un proveedor más

- `src/lib/ai/gateway/cohere.ts`: adaptador propio (la API de Cohere no es compatible con OpenAI). Tope de salida de 4096 (el máximo real de Aya Expanse 32B), temperatura solo si el llamador la pide, y aviso si la respuesta se cortó por límite de tokens.
- `COHERE_MODEL` cambia el modelo sin tocar código. Se puede poner en cualquier cadena con `AI_CHAIN_<TAREA>="cohere:<modelo>,..."`.
- Un 429 de tope **mensual** («limited to 1000 API calls / month») se clasifica como cuota larga: esperar un minuto no lo arregla.
- Cohere **no** está en las cadenas por defecto: su lugar depende de quien llama (`chainWithCohere`). Va primero en fichas de estudio, taxonomía y generación de preguntas (como siempre), y último con `GENERATION_PRIMARY=gateway`.

### Llamadores migrados

| Llamador | Antes | Ahora |
|---|---|---|
| Preguntas (`callCohere`) | `fetch` a Cohere + bucle propio + respaldo por la pasarela | un solo `routeText` con Cohere en la cadena |
| Fichas (`callStudyModel`) | `fetch` a Cohere, luego `callOpenRouter` | `routeText` tarea `study`, Cohere primero, luego toda la cadena |
| Taxonomía de conceptos | `fetch` a Cohere, luego `callOpenRouter` | `routeText` tarea `analysis`; una lista vacía o ilegible pasa al siguiente proveedor |

Se conservan `latexJson.ts` y los validadores de anclaje: el parser de preguntas (`extractJsonQuestions`) sigue protegiendo las barras de LaTeX y es el `validate` de la pasarela.

**No se migró** `geminiPdf.ts`: lee PDF adjuntos (multimodal) y `routeText` es solo de texto.

### Reintentos por candidato

`routeText` acepta `attemptsPerCandidate` (número o función). Solo se repite ante fallos pasajeros (red, 5xx, tiempo agotado, límite por minuto, respuesta ilegible o de calidad baja), con espera 1,5 s, 3 s, 6 s. Una cuota diaria, una llave inválida, un modelo inexistente o una petición rechazada pasan de inmediato al siguiente. Cohere conserva sus reintentos de siempre: 2 si hay respaldo, 3 si es el único.

## 2. Salud persistente (opt-in)

El cortacircuito vive en la memoria de cada instancia de Vercel: una instancia fría no sabe que la cuota diaria ya se agotó y lo descubre con una llamada real fallida.

- Tabla `ai_provider_health` (migración `083`, **no aplicada**): `key`, `kind`, `open_until`. RLS activa y **sin políticas**; solo el servidor (service role) la toca.
- Solo se guardan bloqueos **largos**: `rate_daily`, `payment`, `auth`, `not_found`. Lo corto (429 por minuto, 5xx, tiempos) se aprende en pocas llamadas y no merece una escritura.
- Antes de ordenar la cadena, cada instancia lee los bloqueos vigentes (cache de 30 s) y los aplica **solo alargando**: nunca acorta un bloqueo local. La escritura espera como máximo 1,5 s y nunca lanza.
- También lo usa el router de embeddings (la cuota gratuita de embeddings es la más escasa).
- **Apagado por defecto.** Se activa con `AI_HEALTH_PERSIST=1` y exige la llave de servicio. Si la tabla no existe o la base falla, todo sigue como antes (solo memoria).

## 3. Margen de tokens para modelos que razonan

`src/lib/ai/thinking.ts` reúne la política: qué `reasoning_effort` se pide (gpt-oss en Groq/Cerebras, Gemini 3.x) y cuánto margen de salida se suma. Los tokens ocultos de razonamiento cuentan contra `max_tokens`; con un tope justo la respuesta llega vacía. Se suman 1 024 (bajo) o 2 048 (medio), sin pasar de 32 768. El nivel del API nativo de Gemini (`thinkingConfigFor`) no se toca: allí un parámetro mal puesto da HTTP 400.

## 4. PDF: tablas transpuestas

`pdfVerify` no veía una tabla con filas y columnas intercambiadas (mismos símbolos, números y LaTeX válido). `src/lib/materials/tableCheck.ts` compara la orientación de cada tabla de la transcripción con las **líneas** del texto determinista de la página, que conserva las filas:

- una transcripción fiel tiene sus **filas** juntas en una línea del original;
- una transpuesta tiene sus **columnas** juntas.

Solo se acusa con evidencia positiva (columnas ≥ 60 % en una línea y filas al menos 30 puntos por debajo). Si el texto original no sirve, o la tabla es simétrica, no se dice nada. Si una página se acusa, vuelve al texto determinista, como con cualquier otra verificación fallida.

**Límite conocido:** una tabla girada 90° en el PDF hace que una transcripción correcta parezca transpuesta. El costo es seguro (se pierde la transcripción de esa página, nunca se guarda una dudosa).

## Qué falta

- La migración 083 no está aplicada y `AI_HEALTH_PERSIST` no está activado.
- El margen de tokens y el tope mensual de Cohere no se probaron con llamadas reales.
- El detector de tablas se probó con casos sintéticos, no con PDF reales.
