# Modelos de IA: cómo pasar a un plan con presupuesto

Cómo dejar de depender de los límites gratuitos y probar modelos mejores (Gemini 3.5, Kimi) **cambiando variables, sin tocar código**.
Todo lo medido aquí se midió el **2026-10-26 con la llave gratuita del proyecto**; con la facturación activada los números pueden cambiar.

## Activar el perfil con presupuesto

1. En Google AI Studio / Cloud, activa la facturación del proyecto de la llave `GEMINI_API_KEY`. (Es lo que quita la cuota gratuita
   pequeña; la llave no cambia.)
2. En Vercel → *Environment Variables* (Production): `AI_PROFILE` = `paid`. Redespliega.
3. Opcional, para medir el costo: `AI_LOG_USAGE` = `1`. Cada respuesta deja una línea `[AI_USAGE] task=… model=… ms=… in=… out=…` en los logs
   del servidor (nunca el contenido).

Para volver atrás: quita `AI_PROFILE` y redespliega. Todo regresa a los modelos de siempre.

## Qué cambia con `AI_PROFILE=paid`

| Pieza | Gratis (por defecto) | Con `paid` |
|---|---|---|
| Generar preguntas y fichas, estudio | Groq / Cerebras / … (gratuitos) | **Gemini 3.5 Flash-Lite** primero; los gratuitos quedan de respaldo |
| Análisis (temas, dificultad) | gpt-oss-20b, Gemini 2.5 Flash-Lite | **Gemini 3.5 Flash-Lite** primero |
| Juez de calidad | Gemini 2.5 Flash | **Gemini 3.5 Flash** |
| Lectura de PDFs | 2.5 Flash-Lite → 2.5 Flash | 3.5 Flash-Lite → 3.5 Flash |
| Resumen de fragmentos / detección de temas | Gemini 2.5 Flash | 3.5 Flash-Lite |
| Embeddings | gemini-embedding-001 | **igual** (cambiarlo obliga a reindexar todo) |

Si Gemini falla o no hay llave, la pasarela sigue con el resto de la cadena: nada se rompe.

**Cada papel se puede fijar aparte**, sobre el perfil: `GEMINI_MODEL_JUDGE`, `GEMINI_MODEL_PDF`, `GEMINI_MODEL_CHUNKS`,
`GEMINI_MODEL_TOPICS` (lista con comas: el primero es el preferido). Para la generación, análisis y estudio:
`AI_CHAIN_GENERATION`, `AI_CHAIN_JUDGE`, `AI_CHAIN_ANALYSIS`, `AI_CHAIN_STUDY` con `proveedor:modelo,proveedor:modelo`.

## Lo medido (llave gratuita del proyecto, 2026-10-26)

| Modelo | Petición mínima (JSON corto) | Generar 8 preguntas | JSON válido |
|---|---|---|---|
| `gemini-3.5-flash-lite` | **16 a 24 s** (en todas las repeticiones) | 23 a 27 s | 8/8 preguntas bien formadas |
| `gemini-3.5-flash` | 1 a 3 s (a veces 7 s) | 14 a 55 s | sí |
| `gemini-2.5-flash` / `2.5-flash-lite` | 1 a 2 s | — | sí |

- **El 3.5 Flash-Lite fue el más lento, no el más rápido**, con la llave gratuita. No sé si es la prioridad de la cuota gratuita o del
  modelo. **Repite la medición después de activar la facturación**: `npm run ai:probe -- gemini-3.5-flash-lite gemini-3.5-flash`.
  Si sigue lento, la alternativa es `AI_CHAIN_GENERATION="gemini:gemini-3.5-flash,…"`.
- Hubo respuestas **503 "alta demanda"** en 3.5 Flash y 2.5 Flash (con la llave gratuita). La pasarela las trata como fallo transitorio
  y pasa al siguiente candidato.
- **Pensar cuesta.** El 3.5 Flash y el 2.5 Flash "piensan" por defecto (≈200 a 420 tokens ocultos en una petición trivial) y se cobran como
  salida. El código ya los apaga donde importa (resumen, temas, PDF). **El juez NO**: usa el pensamiento por defecto.
- **`thinkingBudget: 0` da HTTP 400 en el 3.5 Flash-Lite** (no piensa por defecto) y el 3.5 Flash pide `thinkingLevel: "minimal"`. Por eso
  `thinkingConfigFor()` (`src/lib/ai/geminiModels.ts`) decide el ajuste por modelo; un modelo desconocido no recibe ninguno.

## Cómo comparar con datos

1. **Velocidad y tokens:** `npm run ai:probe -- <modelo> [<modelo>…] --runs 5`.
2. **Juez contra el criterio del profesor:** `GEMINI_MODEL_JUDGE=gemini-3.5-flash-lite npm run eval:judge -- --guardar`, y lo mismo con
   `gemini-3.5-flash` y `gemini-2.5-flash`. Lo que más importa es el **falso aprobado** (el profesor la rechazó y el juez la dejó pasar).
3. **Generación:** con `AI_PROFILE=paid` y `AI_LOG_USAGE=1`, regenera el pool de un módulo de prueba y compara: tasa de preguntas
   aprobadas por el juez y por el profesor, JSON válido, tiempo, y tokens (de ahí sale el costo real por módulo con los precios de Google).
4. **Un detalle de método:** si el generador y el juez son de la misma familia (Gemini genera y Gemini juzga), el juez puede ser más
   indulgente con su propio estilo. Por eso el juez va en un modelo distinto al generador. Si se igualan, mídelo con el paso 2.

## Kimi (Moonshot)

Está en el catálogo (`moonshot`, API compatible con OpenAI) pero **no entra en ninguna cadena por defecto**.

1. Crea la llave en https://platform.moonshot.ai y ponla como `MOONSHOT_API_KEY`.
2. `npm run ai:doctor` lista los modelos de tu cuenta.
3. Elígelo con una cadena, por ejemplo: `AI_CHAIN_GENERATION="moonshot:<modelo>,gemini:gemini-3.5-flash-lite"`.

**No verificado** con una llave real: el nombre exacto del modelo y que acepte `response_format` en JSON (si no lo acepta, la pasarela
reintenta sin ese parámetro). La calidad en español tampoco está medida.

## Lo que este cambio NO resuelve

- **Los embeddings** (búsqueda en el material) siguen en `gemini-embedding-001` a 768 dimensiones.
- **Límites pensados para la cuota gratuita** que siguen igual: lotes del juez de 8 preguntas / 9.000 caracteres, contexto del RAG de 16.000
  caracteres, 4.096 tokens de salida por defecto. Con presupuesto se podrían subir, pero eso cambia los prompts y habría que medirlo.
- **Tiempo máximo de las rutas en Vercel.** Calificar una respuesta (`/api/lesson/answer`) tiene un tope de 15 s: un modelo que tarde ~20 s
  no cabe ahí. Esa ruta hoy no llama a ningún modelo de IA; si algún día lo hiciera, habría que revisarlo.
- **Que un modelo mejor mejore el producto.** Hay que medirlo (arriba). Los prompts se afinaron con modelos gratuitos.

## Respaldo entre modelos de Gemini (que un modelo retirado no deje piezas sin servicio)

**Caso real (2026-10-26):** con una llave nueva (proyecto creado en 2026), `gemini-2.5-flash` y `gemini-2.5-flash-lite` dan **HTTP 404**
("ya no disponible para usuarios nuevos") aunque la lista de modelos de la API los muestre. Antes, el juez, la lectura de PDFs, el resumen
de fragmentos y la detección de temas tenían UN solo modelo cada uno: un 404 los dejaba sin servicio (la lectura de PDFs, además, tomaba el
404 por "petición inválida" y se detenía sin probar OpenRouter).

Ahora esas cuatro piezas pasan por `geminiGenerate` (`src/lib/ai/geminiDirect.ts`):

| Situación | Qué hace |
|---|---|
| Modelo no disponible (404 / 403) | Lo salta, lo recuerda unas horas (404: 6 h; 403: 10 min), avisa UNA vez en el log y prueba el siguiente |
| Cuota diaria agotada (es **por modelo**) | Prueba otro modelo |
| 429 por minuto, 5xx / 503, timeout | Reintenta con espera; si persiste, el siguiente modelo |
| Ajuste de "pensar" que el modelo rechaza (400) | Reintenta sin ese ajuste |
| Respuesta vacía | Siguiente modelo |
| Llave inválida (401) | Se detiene: ningún modelo lo arregla |
| Todo falla | Devuelve la causa (`reason`); **nunca inventa texto**. El juez deja la pregunta en revisión humana y **nunca aprueba por omisión** |

**Orden de prueba:** lo configurado para cada papel (perfil o `GEMINI_MODEL_*`) y después la cola de respaldo `GEMINI_MODEL_FALLBACKS`
(por defecto `gemini-3.5-flash-lite, gemini-3.5-flash, gemini-3.1-flash-lite`; el valor `none` la desactiva).

**Cómo ver el estado real:** `npm run ai:doctor -- --ping` prueba CADA modelo con tu llave y marca `NO SIRVE` los que dan 404. La lista de
modelos por sí sola no basta. Sin `--ping` solo muestra "en la lista".

### Qué garantiza esto y qué no
- **Garantiza:** que un modelo retirado, sin cuota o saturado no deje a estas cuatro piezas sin servicio mientras exista otro modelo que
  responda; que la causa de un fallo sea visible; que un fallo nunca se convierta en una aprobación.
- **NO garantiza que la respuesta sea correcta.** Ningún modelo de IA acierta el 100 %. En las 26 preguntas etiquetadas por el profesor el
  juez coincide con él alrededor del 54-58 %, y esa cifra no mejoró al subir de modelo. La calidad se vigila con el banco de evaluaciones
  (`npm run eval:judge`) y con la revisión humana, no con este mecanismo.

### Fuera de este cambio (pendiente)
Las **funciones de Supabase** (`supabase/functions/process-material`, `generate-classroom-map`, `generate-lesson-from-material`,
`gemini-tutor`) tienen el modelo escrito a mano (`gemini-2.5-flash`, y `gemini-1.5-flash` en una) y leen su propio secreto
`GEMINI_API_KEY` de Supabase, distinto del de Vercel. Con una llave nueva en ese secreto, sus modelos 2.5 darían 404. Son código Deno
aparte (se despliega con la CLI de Supabase) y no usan este módulo.
