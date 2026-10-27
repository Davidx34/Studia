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

---

### Nota sobre cómo leer el acuerdo del juez (2026-10-27)

`eval-judge` ahora muestra, además del acuerdo, **cuántas preguntas aprobadas por el profesor deja pasar el juez y cuántas rechazadas
detecta**, y la referencia "un juez que rechazara todo acertaría X %". El acuerdo solo ENGAÑA cuando las etiquetas no están equilibradas.

Medido ese día sobre las 26 preguntas etiquetadas (5 módulos), con Gemini 3.5 Flash y 3.5 Flash-Lite, 3.8 Flash:
- El juez rechazó **las 11 que el profesor aprobó (0/11 pasaron)** y detectó 14 de las 15 que el profesor rechazó. Su "acuerdo" (50-58 %) es
  prácticamente el porcentaje de rechazos del profesor (15/26 = 57,7 %): **en esta muestra el juez no discrimina**.
- 6 a 8 de esos 11 rechazos de más son por el criterio 1 (anclaje: "el concepto no aparece en el material fuente").
- **No es el recorte del contexto:** subir el material que ve el juez de 6.000 a 16.000 caracteres dio exactamente el mismo resultado.
- **Tampoco mejoró** al juzgar cada pregunta con los fragmentos recuperados para ESA pregunta (`--por-pregunta`): 14/26, mismos 11 rechazos.
- Un modelo más potente (3.5 Flash, 3.8 Flash) dio el mismo resultado que el Flash-Lite.

Lectura: la discrepancia parece ser de CRITERIO, no de potencia del modelo ni de recuperación. El juez exige que cada pregunta se verifique contra el
material subido; el profesor aprueba preguntas correctas de la materia aunque su concepto no esté en lo subido. Decidir cuál de las dos cosas
se quiere es una decisión de producto. La muestra es pequeña (26 preguntas, 5 módulos): hacen falta más etiquetas (30 dan señal, 60 buena).

---

### Criterio del juez: "subject" (correccion) en vez de anclaje al material (2026-10-27)

Decision del dueño (opcion 2): el juez verifica que la pregunta sea **correcta y pertinente al curso**; que un concepto no aparezca literalmente en el
material subido **ya no es motivo de rechazo**. `JUDGE_CRITERION=material` vuelve al criterio anterior. Ademas, las preguntas que PASAN reciben una
**segunda opinion de otra familia de modelo** (`JUDGE_CONSENSUS=0` la apaga); si no coincide o no hay segunda opinion, van a revision humana.

**Lo que se encontro al hacerlo (importa mas que las cifras):** las etiquetas del profesor NO son una verdad confiable sobre correccion.
Leyendo las preguntas, varias APROBADAS por el profesor tienen contenido falso (un "bien de lujo" definido como insensible a la renta; pares
sustituto/complementario cruzados; "los efectos ingreso y sustitucion se anulan en bienes normales"; en `U = x^0,5 y^0,5` duplicar el ingreso SI duplica la
utilidad y la pregunta marca eso como "el impostor"), y alguna RECHAZADA es correcta (el Indice de Lerner mide poder de mercado). El juez nuevo detecto
los errores que el profesor aprobo. Por eso el "acuerdo con el profesor" deja de ser una medida valida de correccion: **hace falta un conjunto de oro
verificado por un experto** (no por la IA, que es quien genera y juzga).

Medido (26 preguntas, 5 modulos, perfil paid): criterio anclaje -> 0 pasan; criterio "subject" sin segunda opinion -> 9 pasan (de ellas ~3 discutibles segun
una lectura manual, ninguna con error flagrante); **con segunda opinion -> 4 pasan, 3 a revision humana, 19 fallan**. Con la muestra y el metodo de
arriba esto NO demuestra una tasa de acierto: solo que el juez nuevo es mas exigente con la correccion y que la segunda opinion recorta lo dudoso.
