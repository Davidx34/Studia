# Evaluaciones con conjuntos dorados y afinado del RAG (iteración 6)

Hasta ahora, cada mejora de la IA se justificaba con razonamiento y comprobaciones puntuales. Esta iteración añade **evaluadores repetibles** con umbrales («compuertas») que fallan de verdad, un **barrido de hiperparámetros** de la recuperación y lleva el tipado de TypeScript a **cero errores**.

## 1. Los tres evaluadores

Los tres comparten el marco de `src/lib/evals/common.ts`: cada uno produce métricas y las compara con umbrales. Un evaluador **sin casos no aprueba**, una métrica ausente o no numérica **no aprueba**, y los scripts terminan con **código 1** si una compuerta falla. Las pruebas inyectan generadores defectuosos y comprueban que cada evaluador los detecta.

El generador bajo prueba es siempre el modelo (o la tubería real) y se **inyecta**: en las pruebas es un simulado; en los scripts es la misma cadena que usa la aplicación.

| Comando | Qué mide | Compuertas |
|---|---|---|
| `npm run eval:memory` | ¿La memoria de clase lee bien los apuntes? | precisión de conceptos ≥ 0,8 · recall ≥ 0,7 · perfil (cuantitativo/narrativo) = 1 · causas falsas ≤ 0,2 · trampas sin expresión causal marcadas «causa» ≤ 0,1 · recall de causas ≥ 0,5 |
| `npm run eval:judge -- --dorado` | ¿El juez deja pasar alucinaciones sutiles? | falsos aprobados ≤ 0,1 · falsos aprobados sutiles ≤ 0,15 · falsos rechazos ≤ 0,4 · respondidos ≥ 0,9 |
| `npm run eval:lab-design` | ¿El diseñador de laboratorios es confiable de extremo a extremo? | clasifica bien la suficiencia ≥ 0,8 · diseño con materiales insuficientes = 0 · ficha aceptada que no valida = 0 · fórmulas que contradicen los apuntes = 0 · logra diseñar cuando bastan ≥ 0,8 |

Todos aceptan `--guardar` (escriben en `evals/runs/`).

### Conjuntos dorados

Los versionados son **sintéticos**: textos y memorias inventados para la prueba, sin material de ninguna clase real (el repositorio es público).

- **Memoria** (`golden/memoryGolden.ts`): dos textos narrativos (con causas explícitas y pares mencionados juntos *sin* causa) y uno cuantitativo.
- **Juez** (`golden/judgeGolden.ts`): 15 preguntas en cuatro familias: fieles, falsas sutiles, contrarias a una convención del curso y verdaderas pero ausentes del fragmento.
- **Laboratorio** (`golden/labDesignGolden.ts`): memorias de microeconomía y química con pedidos suficientes, parciales, insuficientes y «no es un experimento».

**Casos reales:** para medir la memoria con materiales de una clase, guárdalos en `evals/golden/local/memoria.json` (carpeta en `.gitignore`) y corre `npm run eval:memory -- --archivo evals/golden/local/memoria.json`. El archivo se valida (`parseMemoryCases`) y se rechaza con el motivo exacto si está mal formado.

### Dos decisiones de medición que conviene conocer

1. **El juez tiene dos criterios** (`JUDGE_CRITERION`). Con `subject` (el actual, decisión del dueño del 27/10) un dato verdadero pero ausente del fragmento **debe aprobarse**; con `material` se rechaza. Por eso cada caso dorado declara su resultado esperado *por criterio*, y el falso aprobado se mide contra el criterio activo. Un juez estricto con `subject` aparece como exceso de falsos rechazos.
2. **Contradicción vs divergencia en laboratorios.** El verificador de fórmulas marca «divergente» una fórmula que coincide con los apuntes en menos del 100 % de los puntos. El ejemplo del consumidor (`Y = max((M − px·x)/py, 0)`) queda en 88 % por un tope legítimo en cero. El evaluador solo frena la **contradicción** (coincidencia < 50 %, un corte propio del evaluador, no del producto) e informa la divergencia parcial.

### Límite conocido de la memoria (medido, no ocultado)

Una causa expresada en la frase vecina deja pasar un par que no es causal («Debido a las guerras púnicas, Roma conquistó Sicilia. Las guerras púnicas enfrentaron a Roma con Cartago.» → «guerras púnicas → Cartago» queda como causa). Es el compromiso de la iteración 1 para no perder causas que se expresan en dos frases. Se mide aparte (`knownGapTrapCausaRate`) y no frena la compuerta de causas falsas, que mide lo corregible.

## 2. Barrido de hiperparámetros del RAG

`npm run eval:rag-sweep` mide, sobre los módulos **reales** de una clase, cómo cambian tres propiedades del contexto al variar:

- el peso del texto en la búsqueda híbrida (`RAG_TEXT_WEIGHT`, de 0 a 2),
- la constante `k` de la fusión RRF (`RAG_RRF_K`),
- el corte relativo de relevancia (`RAG_CUTOFF_RATIO`).

Propiedades (compuesto 0,4 / 0,3 / 0,3): **diversidad entre módulos** (que dos módulos no reciban el mismo contexto: Jaccard de fragmentos, con los pares idénticos contados), **cobertura del documento** y **precisión de conceptos clave** (fragmentos elegidos que hablan de algún concepto clave del módulo; el recall se informa aparte).

La selección de contexto vive en `selectContext` (`src/lib/rag/fusion.ts`), la **misma función** que usa la recuperación de producción: lo que se mide es lo que corre. `RAG_RRF_K` (1–1000, por defecto 60) y `RAG_CUTOFF_RATIO` (0–1, por defecto 0,25) se pueden cambiar sin desplegar, igual que `RAG_TEXT_WEIGHT`. Los valores por defecto **no cambiaron**.

**Es solo lectura** (no escribe en la base). Gasta un embedding por variante de consulta de cada módulo (con caché y ritmo) y llamadas baratas a la función híbrida.

### Cómo se decide un cambio

`recommend` propone cambiar un valor por defecto **solo si**: se midió la configuración actual, la mejor mejora el compuesto al menos 0,02 y ninguna de las tres propiedades empeora más de 0,05. De lo contrario, «no hay evidencia para cambiar».

### Límite de la métrica

Es un **sustituto**: no hay una verdad etiquetada del «contexto correcto» (eso lo mide `eval:retrieval` con preguntas generadas), y los conceptos clave salen de `topic_keywords`, que genera la propia tubería. Por eso el umbral para recomendar es prudente.

## 3. TypeScript en cero

El presupuesto de errores pasó de 20 a **0** y el tope en `scripts/check-ts-error-budget.mjs` quedó en 0. Sin `any` ni `@ts-ignore`:

- `src/types/database.ts` importaba un tipo que no existe; al corregirlo, los tipos de las tablas pasaron a ser reales y destaparon columnas que la base permite dejar vacías (NULL).
- `tsconfig.json` no definía `target` (caía a ES5): se fijó en `es2017`.
- Las columnas NULL se normalizan en la frontera (`src/lib/achievements/normalize.ts` para los logros, que usa los valores por defecto de la base; el resto en cada página).
- Las actualizaciones usan `TablesUpdate<...>` en vez de `Record<string, unknown>`.

### Cambio de comportamiento: `middleware.ts`

`setAll` de Supabase no puede devolver una respuesta (su tipo es `void`). El código creaba una respuesta dentro de `setAll` y la descartaba, así que **las cookies de renovación de sesión nunca llegaban al navegador**. Ahora se guardan y se aplican a la respuesta que sí se devuelve (incluidas las redirecciones). El control de acceso no cambió. Está cubierto con pruebas con Supabase simulado; **no se probó con sesiones reales**.

## 4. Primeras corridas reales (2026-10-31)

Se corrieron los cuatro comandos con el modelo y la base reales (solo lectura). Resultados:

- **`eval:memory`: NO aprobado.** Con la cadena real (la de `callStudyModel`; sirvió Groq `gpt-oss-120b`): precisión 0,87 y recall 0,84 pasan, pero las causas falsas dan 0,5 (límite 0,2). La tubería deja como «causa» pares como «Nilo → limo fértil» o «guerras púnicas → Roma»: la frase vecina trae una expresión causal que menciona uno de los dos conceptos. Es el mismo límite que el caso Roma documenta, **más general de lo que parecía**. En el caso cuantitativo el modelo nombró «p_x» y «TMS» en vez de «precios» y «tasa marginal de sustitución», y dejó fuera «ingreso» y «equilibrio» (recall bajo). Endurecer `hasCausalLink` (exigir que la frase causal mencione los dos conceptos) reduciría las causas falsas a costa de perder causas expresadas en dos frases; **no se cambió**: es una decisión de producto.
- **`eval:lab-design`: NO aprobado, solo por la suficiencia (0,67).** Las compuertas de seguridad pasan: nunca diseñó con materiales insuficientes, toda ficha aceptada validó y ninguna fórmula contradijo los apuntes. Falla la clasificación en dos casos: el modelo pidió más requisitos de los previstos en el caso «parcial» (resultó «insuficiente») y trató de listar requisitos para «escribe un poema» en vez de decir que no es un experimento. El caso «parcial» es frágil por naturaleza: depende de los requisitos exactos que elija el modelo.
- **`eval:judge -- --dorado`: aprobado** con el criterio `subject` (0 falsos aprobados, 0 falsos rechazos, 15/15 respondidos). Aviso de configuración: `gemini-2.5-flash` devuelve 404 con la llave actual, así que el juez cayó a `gemini-3.5-flash-lite`; conviene revisar `AI_PROFILE` / `GEMINI_MODEL_JUDGE`.
- **`eval:rag-sweep`:** de tres clases, una no tiene fragmentos (se omite) y en las otras dos **ninguna configuración mejora al menos 0,02 la actual** (0,3 / 60 / 0,25): Microeconomía I +0,003 y 5.º grado A +0,007 (la mejor allí usa peso del texto 1). **Los valores por defecto no cambian.** Limitación: 18 de 26 módulos de Microeconomía no tienen palabras clave, así que su precisión de conceptos clave es casi nula y no distingue configuraciones.
