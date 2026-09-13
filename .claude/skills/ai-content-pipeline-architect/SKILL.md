---
name: ai-content-pipeline-architect
description: Metodología profesional para diseñar y auditar el pipeline de IA que convierte material educativo (Markdown, PDF, transcripciones, etc.) en preguntas de evaluación de alta calidad. Úsala cuando el trabajo sea sobre ingesta de contenido, chunking, RAG, prompts de generación de preguntas, o el juez de calidad — en Stud.ia o en cualquier sistema equivalente de "documento crudo → contenido evaluable generado por LLM".
---

# Arquitecto de pipelines de IA para procesamiento de contenido educativo

Esta skill encapsula cómo auditar y mejorar, de forma profesional y verificable,
un pipeline que va de **material crudo** a **preguntas de evaluación generadas
por LLM**. No es teoría genérica: está calibrada sobre el pipeline real de
Stud.ia (`src/lib/materials/`, `src/lib/questions/`), que ya tiene piezas
production-grade (anti-alucinación, juez LLM cross-provider, taxonomía cerrada
de conceptos). El trabajo de esta skill casi nunca es "reescribir todo" — es
encontrar el eslabón más débil de una cadena que ya tiene eslabones fuertes, y
reforzarlo sin degradar el resto.

## El framework: 6 etapas, cada una con su propia forma de fallar

```
1. INGESTA        → 2. CHUNKING       → 3. EMBEDDING/RAG   → 4. GROUNDING/PROMPT → 5. GENERACIÓN → 6. VERIFICACIÓN
   (¿qué formato      (¿cómo se parte     (¿qué se recupera    (¿qué contexto        (¿qué modelo,   (¿quién revisa
   tiene el           el texto en          y en qué orden       ve el LLM al          qué formato     lo generado
   material?)         piezas?)             se le da al          generar?)             de salida?)     antes de
                                            LLM?)                                                       llegar al
                                                                                                         estudiante?)
```

Antes de tocar código, ubica en qué etapa está el problema real. Un síntoma
("las preguntas inventan datos") casi siempre nace 2-3 etapas antes de donde
se manifiesta (etapa 5, generación) — en este proyecto, la causa más frecuente
verificada en vivo fue etapa 2 (chunking ciego a la estructura del material) o
etapa 3 (contexto RAG truncado a la mitad de una derivación).

## Checklist de auditoría por etapa

### 1. Ingesta
- ¿El pipeline distingue el *formato* del material (Markdown con headings
  reales vs. texto plano extraído de PDF vs. transcripción hablada), o todo
  entra al mismo `sanitizeText`/`chunkText` genérico? Si un formato trae
  estructura explícita (headings, tablas, listas) y el pipeline la tira a la
  basura antes de usarla, ahí hay un eslabón débil — la estructura es señal
  gratis que no hay que pagarle a ningún LLM por inferir.
- ¿Sanitiza sin destruir semántica? (Ej: colapsar espacios está bien; borrar
  saltos de línea que separan celdas de una tabla no.)

### 2. Chunking
- ¿Los cortes respetan límites semánticos (fin de sección, fin de tabla, fin
  de bloque de código) o cortan donde caiga el conteo de caracteres?
- ¿Una tabla o bloque de código puede quedar partido a la mitad entre dos
  chunks? (Si sí: el embedding de ambas mitades es basura, y el LLM que reciba
  solo una mitad va a alucinar la otra.)
- ¿Cada chunk lleva su contexto de ubicación (ej: "Sección: Teoría del
  Consumidor > Utilidad Marginal") o es un fragmento huérfano? El contexto de
  ubicación mejora el embedding (la sección da contexto semántico) Y le da al
  LLM generador algo verificable que citar, lo cual refuerza directamente
  cualquier regla anti-alucinación que ya exista aguas abajo.
- Tamaño de chunk: ¿está calibrado contra el modelo de embedding Y contra el
  límite de contexto real del generador (ver `RAG_CONTEXT_CHAR_LIMIT` en este
  proyecto — un solo punto de verdad, nunca un número hardcodeado en 3 sitios
  desincronizados)?

### 3. Embedding / RAG
- ¿La recuperación por similitud puede devolver chunks casi duplicados
  (mismo párrafo repetido) en vez de cobertura amplia del tema? Si el material
  tiene 5 secciones y el top-K de similitud trae 5 chunks de la misma sección,
  el modelo generador ve 1/5 del material real aunque el código "funcionó".
- ¿Existe un fallback bien definido cuando no hay embedding disponible (sin
  API key, fallo transitorio), o el generador se queda sin contexto en
  silencio?
- ¿El límite de caracteres al contexto trunca a la mitad de una derivación /
  definición, o corta en un límite de chunk?

### 4. Grounding / Prompt
- Regla de oro, verificada en producción en este proyecto (Sesión L,
  Microeconomía I): un LLM generador SIEMPRE va a rellenar huecos de contenido
  con su conocimiento general si el prompt no se lo prohíbe EXPLÍCITAMENTE.
  "Usa el contenido del material" no alcanza — hay que decir "está PROHIBIDO
  introducir conceptos/datos que no aparezcan literalmente en el material,
  aunque tu conocimiento general los asocie con el tema", con ejemplos
  concretos de qué NO inventar.
- ¿Hay taxonomía cerrada de conceptos/etiquetas, o cada llamada al LLM inventa
  su propia variante de redacción? (Rompe cualquier agregación/analítica aguas
  abajo — ver `conceptTaxonomy.ts`.)
- ¿El formato de salida pedido es alcanzable por el modelo real? (Verificar
  el límite real de output tokens del modelo — no asumido, medido — antes de
  pedir una cantidad grande de items en una sola llamada.)

### 5. Generación
- ¿Hay reintento con criterio de calidad (no solo "hubo error HTTP"), por
  ejemplo "la respuesta llegó pero con muchas menos preguntas de las
  pedidas"? Un LLM que ignora parcialmente la instrucción de cantidad no
  lanza una excepción — hay que detectarlo explícitamente.
- ¿El parseo del output es tolerante a las formas reales en que un LLM se
  desvía del formato pedido (fences de markdown envolviendo el JSON,
  backslashes de LaTeX sin escapar, texto antes/después del JSON)? Cada una
  de estas es un caso real observado, no hipotético — un parser ingenuo con
  un solo regex se rompe en producción con contenido matemático/técnico.

### 6. Verificación
- ¿Hay un juez de calidad independiente del generador (modelo/proveedor
  DISTINTO, para no heredar el sesgo de "esto se ve bien" del mismo modelo
  evaluando su propio trabajo)?
- ¿La rúbrica del juez es falsable ("¿se puede verificar contra el texto
  fuente?") o vaga ("¿es esta pregunta buena?")? Una rúbrica vaga hace que el
  juez apruebe casi todo o sea arbitrariamente estricto — no hay término
  medio útil.
- ¿Qué pasa con lo que el juez rechaza? ¿Se descarta, se manda a revisión
  humana, o se ignora silenciosamente? Un pipeline de calidad sin ruta clara
  para el "fail" no es un pipeline de calidad, es teatro.

## Principios no negociables (aprendidos en producción, no en teoría)

1. **Nunca destruir datos buenos por un reintento fallido.** Si un paso
   reemplaza contenido existente (chunks, transcripción), borrar solo debe
   pasar DESPUÉS de confirmar que el reemplazo nuevo se obtuvo con éxito.
2. **Un solo punto de verdad para cada constante compartida** (límite de
   caracteres de contexto, tamaño de chunk, límite de tokens). Si el mismo
   número vive hardcodeado en 3 archivos, alguien lo va a cambiar en uno y
   olvidar los otros dos — ya pasó en este proyecto.
3. **Diagnóstico honesto en los logs, no fallos silenciosos.** Si una
   respuesta no parsea, registra la causa probable (¿truncamiento por
   límite de tokens? ¿formato inesperado?) — un mensaje genérico convierte
   cada bug futuro en una investigación desde cero.
4. **Verificar contra datos reales del proyecto, no solo contra tests
   unitarios sintéticos.** La lógica pura (chunking, parseo) se testea con
   vitest sin red. El comportamiento del LLM (¿el prompt realmente evita que
   alucine?) solo se confirma con una corrida real contra el proveedor y
   revisión manual de una muestra — un test unitario no puede sustituir eso.
5. **Preferir menos output verificable que más output inventado.** Si el
   material no alcanza para la cantidad pedida, generar menos es la opción
   correcta — instrúyelo explícitamente en el prompt, no lo dejes implícito.

## Cómo trabajar con esta skill en Stud.ia específicamente

Archivos canónicos a leer antes de tocar cualquier pieza del pipeline:
- `src/lib/materials/textProcessing.ts` — sanitizado, chunking genérico,
  embeddings con reintento, detección de temas/dificultad.
- `src/lib/materials/processNotebookLM.ts`, `processYoutube.ts`,
  `processLink.ts` — los distintos puntos de ingesta, cada uno con su propio
  formato de entrada.
- `src/lib/questions/cohereGeneration.ts` — RAG context, anti-alucinación,
  reglas por tipo de minijuego, parseo tolerante, reintento con criterio de
  calidad.
- `src/lib/questions/conceptTaxonomy.ts` — taxonomía cerrada de conceptos.
- `src/lib/questions/judge.ts` — juez LLM cross-provider, batching, rúbrica
  falsable.

Al proponer un cambio: identifica la etapa (1-6), explica qué eslabón débil
ataca, impleméntalo con tests de lógica pura donde sea posible, y verifica el
resto (comportamiento real del LLM) contra el proyecto real — no lo des por
sentado solo porque el código compila.
