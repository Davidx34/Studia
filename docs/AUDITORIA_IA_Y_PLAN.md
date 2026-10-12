# Auditoría de la IA de Stud.ia y plan para escalar (octubre de 2026)

Estado: auditoría **del código y de la base de producción** (verificado) + **investigación de mercado** (fuentes de terceros, ver §6: los límites gratuitos cambian sin aviso y Google ya no publica cifras por modelo). Lo que no pude verificar está marcado.

## 1. Cómo funciona hoy (verificado en el código)

| Etapa | Qué hace | Proveedor | Observación |
|---|---|---|---|
| Subir material | PDF → Markdown (visión), chunking por secciones (~440 tokens/chunk), temas y dificultad | Gemini 2.5 Flash/Flash‑Lite (vía `GEMINI_API_KEY`) | 197 chunks en 15 materiales, 0 sin embedding |
| Embeddings | un `embedContent` por chunk, `gemini-embedding-001`, 768 dims | Gemini | sin `taskType`, sin normalizar, sin registro del modelo usado |
| Recuperación (RAG) | 1 consulta = título + descripción del módulo → top‑5 chunks por coseno (HNSW), con filtro por materiales vinculados | pgvector | sin búsqueda léxica, sin reranking, sin diversidad, sin umbral |
| Generar preguntas | Cohere Aya Expanse 32B (principal) → OpenRouter (respaldo) | Cohere / OpenRouter | contexto limitado a 16.000 caracteres por el límite de Cohere |
| Juez | Gemini 2.5 Flash por lotes de 8 → OpenRouter (respaldo) | Gemini / OpenRouter | **la llave gratuita de Gemini da ~20 peticiones/día en este modelo** (medido por el propio proyecto) → "cuota agotada" |
| Fichas / flashcards / infografías | Aya → OpenRouter, con validación de anclaje al material | Cohere | bien resuelto: valida palabras y números contra el material |

Hay además un **banco de evaluación** ya existente (`npm run eval:context`, `npm run eval:judge`): mide la recuperación y el acuerdo juez‑profesor. Es lo que permite mejorar con datos y no a ciegas.

## 2. Hallazgos (ordenados por impacto)

1. **Dependencia dura de proveedores sueltos.** Cohere está cableado en 4 archivos y Gemini en 6+, cada uno con su propio manejo de errores. No hay una capa común: cada respaldo es una excepción.
2. **El juez se queda sin cuota** (Gemini ≈ 20/día). Con 18 módulos del curso, el juez casi nunca puede opinar y todo cae a revisión humana.
3. **Embeddings sin `taskType`.** `gemini-embedding-001` está diseñado para distinguir documento (`RETRIEVAL_DOCUMENT`) de consulta (`RETRIEVAL_QUERY`); hoy ambos se embeben igual. Es la mejora de recuperación más barata que existe.
4. **Un solo modelo, sin registro.** `material_chunks` no guarda con qué modelo se calculó cada vector. Cambiar de modelo de embeddings mezclaría espacios incompatibles sin que nadie lo note. (Una función antigua, `generate-lesson-from-material`, aún declara `text-embedding-004`: otro espacio vectorial.)
5. **Recuperación de una sola pasada.** Una consulta, 5 chunks, sin búsqueda por palabras. Si Gemini se queda sin cuota de embeddings, el RAG degrada a "los primeros chunks" (orden de documento, no relevancia).
6. **Corrupción de LaTeX** en 26 preguntas (arreglado en el #100 hacia adelante; las ya guardadas siguen dañadas).
7. **Sin observabilidad de IA**: no se registra qué proveedor respondió, cuánto tardó ni por qué falló.

## 3. Embeddings: ¿se aprovechan al máximo? ¿es el mejor modelo?

**No se aprovechan al máximo**, y el modelo en sí no es el problema:

- `gemini-embedding-001` es de los mejores modelos **con nivel gratuito**: aparece entre los primeros del benchmark multilingüe MTEB desde 2025 y soporta español bien. Qwen3‑Embedding‑8B puntúa algo más, pero no tiene API gratuita (hay que alojarlo). BGE‑M3 (MIT) es un buen plan B alojable y trae vectores densos + dispersos.
- Lo que sí falta es **usarlo bien**: `taskType`, normalización (a 768 dims los vectores *no* vienen normalizados), búsqueda **híbrida** (vector + texto completo en español, fusionados con RRF), consultas múltiples, diversidad (MMR) y un umbral de relevancia.
- **Riesgo de cuota**: el nivel gratuito de embeddings se reporta ~100 peticiones/min y ~1.000/día (una sola fuente, sin confirmar). Con un chunk por petición, subir un material grande gasta el día. Alternativas gratuitas viables para *indexar*: Voyage (200 M de tokens gratis por cuenta, multilingüe), Cloudflare Workers AI `bge-m3` (~9 M de tokens/día dentro de los 10.000 neurons gratuitos), Jina (10 M de tokens, solo uso no comercial; cifras contradictorias). Supabase trae `gte-small` gratis dentro de las Edge Functions, pero es 384 dims y **principalmente inglés**: no lo recomiendo para español.
- **Regla de oro**: los vectores de modelos distintos **no son comparables**. Cualquier cambio de modelo exige guardar `embedding_model` por chunk y re‑indexar; mientras tanto, la búsqueda por palabras (FTS) sirve de red de seguridad.

## 4. IA de generación y de juicio: ¿es la mejor disponible? ¿hay gratuitas?

- **Generador (Aya Expanse 32B)**: correcto en español, pero su salida está topada a 4.096 tokens y la cuenta *trial* de Cohere es de **uso no comercial** y de pocas llamadas. Es un riesgo de continuidad, no de calidad.
- **Mejores gratuitas hoy** (cifras orientativas, §6): Cerebras (~1 M tokens/día, muy rápido, `gpt-oss-120b`), Groq (~30 RPM / ~1.000 por día, Llama 3.3 70B), Mistral Small (plan Experiment: pide teléfono y aceptar entrenamiento), GitHub Models (GPT‑4.1‑mini, ~150–1.000/día), NVIDIA NIM (~1.000/día), Cloudflare Workers AI (10.000 neurons/día), OpenRouter (modelos `:free`: 50/día, 1.000 con ≥10 USD comprados en total).
- **Para el juez** conviene una familia distinta de la del generador (Llama / gpt‑oss / Mistral frente a Aya): evita que el modelo apruebe su propio estilo.
- **"Omni‑router"**: OpenRouter ya lo es (y se usa), pero sus modelos gratuitos son pocos y limitados. La solución adecuada es una **pasarela propia** (lo que se construye en este PR) que enruta entre *todos* los proveedores gratuitos; y, si algún día se quiere un servicio, cualquier LiteLLM/Portkey propio entra como proveedor `custom` sin tocar código.
- **Privacidad**: varios niveles gratuitos usan los prompts para entrenar (Gemini fuera de UE/UK, Mistral Experiment). Los materiales del curso no son datos personales, pero **no mandes nombres ni correos de estudiantes a un nivel gratuito**. Hoy la IA solo recibe contenido de materiales.

## 5. Arquitectura objetivo (por fases, un PR por fase)

**Fase 1 — Pasarela de IA (este PR).** `src/lib/ai/gateway/`: catálogo de proveedores (un cliente OpenAI‑compatible + el adaptador de OpenRouter), cadenas por tarea configurables por variable de entorno, cortacircuito (429 por minuto vs. cuota diaria, 401/402/404, 5xx), orden **adaptativo** por salud/latencia, validación de la salida (si un modelo responde mal, pasa al siguiente) y selección de la mejor respuesta. Conectada al respaldo de generación y al respaldo del juez. Sin llaves nuevas todo se comporta como antes. `npm run ai:doctor` comprueba qué modelos existen de verdad.
**Estado (2026-10-11):** Fase 1 mergeada (#101). Fase 2 en curso: migración 068 (perfil de embedding por fragmento, texto completo en español, búsqueda híbrida), `taskType` + normalización, consultas múltiples fusionadas, respaldo al camino anterior, `npm run eval:retrieval` y `npm run reindex:embeddings`.

**Fase 2 — Embeddings y recuperación.** `taskType` y normalización; columna `embedding_model` y re‑indexado; búsqueda híbrida (FTS español + vector, RRF); consultas múltiples; MMR y umbral; presupuesto de contexto según el modelo (Cohere 16 k caracteres vs. modelos de contexto largo). Medido con `eval:context` antes y después.
**Fase 3 — Registro y presupuesto de IA.** Tabla `ai_usage_log` (proveedor, modelo, tarea, estado, latencia, tokens) → panel en `/dev`, contadores diarios por proveedor para apartar *antes* de agotar, y alertas.
**Fase 4 — Revisión adaptativa.** Juez con **conjunto** (dos familias; si discrepan, escala a revisión humana), prechequeos deterministas (formato, anclaje léxico, claves de respuesta), y el banco `eval:judge` como puerta de calidad al cambiar de modelo.
**Fase 5 — Escalar a pago sin tocar código.** Poner `OPENAI_API_KEY` (o la de un proveedor de pago/propio) y reordenar `AI_CHAIN_*`; el resto (cortacircuito, registro, evaluación) ya está.

## 6. Fuentes y nivel de confianza

Los límites provienen de páginas de terceros (comparativas de 2026) y de la documentación oficial de OpenRouter (verificada): **20 peticiones/min y 50/día para modelos `:free`, 1.000/día con ≥10 créditos comprados**. Google ya no publica cifras gratuitas por modelo (se ven en AI Studio). Voyage publica 200 M de tokens gratuitos por cuenta en su documentación. Todo lo demás: tratar como orientativo y confirmar en la consola de cada proveedor, o con `npm run ai:doctor -- --ping`.

## 7. Qué necesito de ti (solo tú puedes hacerlo)

Crear cuentas y llaves (yo no puedo ni debo hacerlo ni verlas) y pegarlas en Vercel → Environment Variables (Production y Preview), y redesplegar. Orden de más a menos útil:

1. `CEREBRAS_API_KEY` — https://cloud.cerebras.ai
2. `GROQ_API_KEY` — https://console.groq.com
3. `MISTRAL_API_KEY` — https://console.mistral.ai (pide teléfono)
4. `GITHUB_MODELS_TOKEN` — token personal de GitHub con permiso *models*
5. `NVIDIA_API_KEY` — https://build.nvidia.com
6. `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — https://dash.cloudflare.com

Con 1 y 2 el juez y el respaldo de generación ya dejan de depender de la cuota de Gemini.
