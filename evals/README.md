# Arnés de evaluación del pipeline de IA

Sin esto, ninguna mejora del pipeline de contenido es comprobable. Es la
respuesta al hallazgo §3.e de la review 360 y al **Cruce C**: el proyecto tiene
101 tests unitarios en verde y un presupuesto de errores de TypeScript que baja,
pero **no tenía ninguna medición de si lo que el modelo recibe tiene que ver con
lo que se le pide generar**. Por eso un cambio que empeoró el producto (el P0
del contexto) pasó todos los controles sin romper nada.

Son dos evaluaciones, deliberadamente separadas: una mide **la entrada** del
pipeline y otra **la salida**.

---

## 1 · Calidad del contexto — `scripts/eval-context.ts`

```bash
npx tsx --env-file=.env.local scripts/eval-context.ts
npx tsx --env-file=.env.local scripts/eval-context.ts --classroom <id>
npx tsx --env-file=.env.local scripts/eval-context.ts --json
```

Corre `getRagContext` de verdad contra la base de verdad y verifica cuatro
propiedades falsables por clase. Sale con código 1 si alguna falla.

| Propiedad | Umbral | Qué detecta |
|---|---|---|
| Módulos distintos reciben contexto distinto | ≤10% de pares idénticos | El P0: 8 módulos con el mismo contexto |
| El material se usa más allá de su principio | ≥10% de chunks alcanzados | Tomar los primeros N chunks en vez de buscar |
| El contexto aprovecha el presupuesto | ≥35% de `RAG_CONTEXT_CHAR_LIMIT` | Truncar y desperdiciar la recuperación |
| Ningún módulo se genera casi sin contexto | 0 módulos <200 chars | Fallos silenciosos de recuperación |

**Los umbrales son flojos a propósito.** No buscan perfección, buscan detectar
el colapso. Comprobado contra el código anterior a #52 — el evaluador falla,
que es lo único que demuestra que sirve:

| | Antes de #52 | Después |
|---|---|---|
| Pares con contexto idéntico | **28/28 (100%)** ❌ | 0/28 (0%) ✅ |
| Chunks alcanzados | **4/121 (3,3%)** ❌ | 45/121 (37,2%) ✅ |
| Propiedades que se cumplen | 6/8 | **8/8** |

**Línea base actual (2026-09-13):** 5to grado 45/121 chunks, 9.187 chars prom ·
Microeconomía 38/83 chunks, 8.859 chars prom.

No gasta cuota de LLM (solo embeddings) y no escribe nada.

---

## 2 · Acuerdo del juez — `scripts/eval-judge.ts`

```bash
npx tsx --env-file=.env.local scripts/eval-judge.ts
npx tsx --env-file=.env.local scripts/eval-judge.ts --limit 24   # cuota de Gemini
npx tsx --env-file=.env.local scripts/eval-judge.ts --guardar    # escribe evals/runs/
```

Vuelve a correr el juez **actual** sobre las preguntas que un humano etiquetó y
compara. Volver a correrlo en vez de leer el veredicto guardado es deliberado:
así la métrica mide el juez de hoy contra el criterio humano, que es lo que
hace falta para decir *"esta versión es mejor que la anterior"*.

**El error que importa no es el desacuerdo en general, es el falso aprobado**
— el profesor la rechazó y el juez la deja pasar: esa pregunta llega al
estudiante. Un falso rechazo solo desperdicia contenido bueno.

`review` no se cuenta ni como acierto ni como fallo: es el juez diciendo "no me
alcanza para decidir", que es su comportamiento correcto ante la duda.

### Cómo crear la verdad de referencia

Hoy hay **0 preguntas con `reviewed_by='teacher'`**, y eso no es un error del
script: es el estado real del proyecto. Todos los veredictos de la base los
puso el juez IA. Hasta la migración 044 la base no distinguía entre un veredicto
de la IA y uno de una persona — ambigüedad que **hizo que la propia review 360
interpretara mal sus datos** (leyó 49 `rejected` de la IA como decisiones del
profesor). Medir el juez contra sus propios veredictos anteriores no dice nada
sobre si acierta.

1. Entra a `/teacher/classrooms/<id>/review` — hay **48 preguntas** esperando.
2. Aprueba o rechaza al menos **30**, mezclando clásicas y minijuegos.
   Cada una ahora muestra **por qué la marcó la IA** y, si es minijuego, **su
   contenido completo** — antes había que decidir a ciegas sobre un título
   genérico como *"Resuelve la crisis"*.
3. Vuelve a correr el script.

30 etiquetas dan una señal útil; 60 dan una buena.

---

## Cuándo correrlos

- **Antes y después** de tocar chunking, RAG, prompts, el juez o la rúbrica.
  Si no puedes mostrar el número de antes, no sabes si mejoraste.
- `--guardar` escribe `evals/runs/<fecha>.json` para poder comparar corridas.
- El de contexto no gasta cuota de LLM: puede correrse siempre. El del juez sí
  — usa `--limit` para no agotar los 20 requests/día de Gemini.

## Qué NO miden

Honestidad sobre los huecos, para que nadie lea de más en un número verde:

- **Calidad pedagógica.** El juez verifica anclaje al material y estructura, no
  si la pregunta enseña algo. La profundidad cognitiva (§6.1 del informe: ~73%
  de las preguntas son de recordar) sigue sin medirse automáticamente.
- **Si el estudiante aprende.** Eso requiere datos de uso que el producto
  apenas empezó a registrar (ver PR #54).
- **Relevancia semántica del contexto.** `eval-context` mide cobertura y
  distinción, no si el chunk recuperado es *el mejor* para ese módulo.
