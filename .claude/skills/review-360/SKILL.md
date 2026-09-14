---
name: review-360
description: Auditoría 360 de un producto de software educativo desde siete visiones simultáneas — ingeniería de datos, calidad de código, machine learning/IA, creatividad de producto, creatividad de diseño, visión educativa y visión empresarial — cerradas por un agente integrador que produce un punto de partida realista. Úsala cuando el pedido sea "revisa el proyecto completo", "en qué estamos", "qué mejoramos", una evaluación previa a una decisión de rumbo, o antes de un hito (demo, inversión, piloto con colegios). No la uses para revisar un PR puntual.
---

# Review 360

Una review 360 no es "leer el repo y opinar". Es un **procedimiento de
evaluación con evidencia** que cruza siete lentes independientes sobre el mismo
producto y termina en un documento accionable. Cada lente mira lo que las otras
no ven a propósito: el ingeniero de datos no juzga estética, el diseñador no
juzga complejidad algorítmica, y el agente integrador no repite a ninguno —
sintetiza.

El producto de esta skill es **un documento**, no una conversación. Si al
terminar no existe un archivo en `docs/` que alguien pueda leer sin haber estado
presente, la review no se hizo.

## Regla cero: evidencia o no existe

Cada hallazgo lleva un ancla verificable. Sin ancla, se borra.

| Ancla válida | Ejemplo |
|---|---|
| Ruta y línea | `src/lib/questions/cohereGeneration.ts:214` |
| Query SQL ejecutada + su resultado | `SELECT count(*) ... → 0 filas` |
| Comando y su salida | `npm run test → 101 passed` |
| Observación en vivo | "importé un .md real por la UI; el chunk 3 duplicó la tabla" |
| Cita textual del usuario/docente | "no entendí para qué sirve el mapa" |

Prohibido: "el código podría estar mejor optimizado", "la UX es mejorable",
"falta escalabilidad". Eso no es un hallazgo, es ruido. Si no puedes nombrar el
archivo, la tabla o la pantalla, todavía no terminaste de investigar.

## Severidad (única escala, las siete visiones la comparten)

- **P0 — Rompe**: pérdida de datos, el usuario no puede completar el flujo
  principal, el contenido generado es incorrecto y llega al estudiante.
- **P1 — Duele**: funciona pero cuesta caro (dinero, tiempo del docente,
  confianza), o bloquea el siguiente hito.
- **P2 — Deuda**: correcto hoy, frágil mañana. Se paga cuando haya presión.
- **P3 — Oportunidad**: no está roto; hacerlo abriría valor nuevo.

Cada visión entrega como máximo **5 hallazgos**. El límite es deliberado: obliga
a priorizar y evita el informe de 80 puntos que nadie ejecuta.

## Protocolo

```
FASE 0  Encuadre      → ¿qué decisión va a tomarse con esta review? ¿qué hito viene?
FASE 1  Reconocimiento→ mapa del sistema: rutas, tablas, libs, dependencias externas
FASE 2  Las 7 visiones→ cada una recorre su checklist con evidencia (pueden ir en paralelo)
FASE 3  Cruce         → buscar contradicciones y refuerzos entre visiones
FASE 4  Integración   → el agente de desarrollo escribe el documento final
```

**Fase 0 no es opcional.** Una review sin decisión asociada produce un informe
decorativo. Pregunta (o infiere y decláralo en el documento): ¿esto es para
decidir qué se construye el próximo mes, para mostrar a un colegio, para una
ronda, o para saber si el rumbo actual sigue siendo el correcto? La respuesta
cambia qué hallazgos son P1.

**Fase 3 es donde aparece el valor real.** Los hallazgos aislados los produce
cualquiera; el cruce es lo que una review 360 hace y siete reviews separadas no:

- Contradicción: diseño pide más animación ↔ código dice que el bundle ya pesa.
- Refuerzo: datos ve tablas huérfanas ↔ educación ve una herramienta que nadie
  usa → **es la misma feature muerta**, y eso la convierte en P1, no en dos P2.
- Causa común: IA genera preguntas flojas ↔ docente desconfía ↔ empresa no puede
  vender "ahorra tiempo" → una sola raíz técnica sostiene tres problemas de
  negocio.

---

## Visión 1 — Ingeniería de datos

**Misión:** el dato es correcto, está donde debe, no se pierde, y el modelo
representa el dominio real.

**Evidencia a levantar (Stud.ia usa Supabase/Postgres — usa el MCP de Supabase
para consultar producción, no asumas desde las migraciones):**

- `supabase/migrations/*.sql` — historia del esquema; los números altos cuentan
  qué se construyó tarde y por qué.
- `list_tables` + `execute_sql` sobre la base real.
- `src/lib/actions/*.ts` y `src/lib/supabase/` — dónde se escribe y se lee.

**Checklist:**

1. **MER vs. MR.** Dibuja (en texto) el modelo entidad-relación que el producto
   *necesita* y compáralo con el relacional que existe. Las divergencias son el
   hallazgo, no el esquema en sí. ¿Hay entidades que en la realidad son 1:N
   modeladas como columnas sueltas? ¿Hay JSON guardando lo que debería ser tabla?
2. **Persistencia real.** Para cada dato que el usuario cree haber guardado
   (progreso, respuesta, racha, nota), confirma con una query que efectivamente
   está en la base *después* del flujo. El bug clásico de este proyecto fue
   exactamente ese: progreso que se ve en pantalla y no persiste.
3. **Consistencia.** Foreign keys reales vs. relaciones por convención.
   `ON DELETE` declarado. Filas huérfanas (`LEFT JOIN ... WHERE x.id IS NULL`).
   Duplicados que deberían tener índice único. Enums vs. strings libres.
4. **Pertinencia.** Tablas y columnas que ya nadie escribe ni lee. Búscalas en la
   base (`count(*)`, `max(created_at)`) y en el código (grep del nombre). Una
   tabla sin escrituras en semanas y sin referencias en `src/` es deuda visible.
5. **Optimización.** Índices para los `WHERE`/`ORDER BY` que realmente corren.
   Consultas N+1 en server components. RLS: ¿protege, y a qué costo por query?
   Embeddings/vectores: dimensión, índice, y si la búsqueda es la que se cree.
6. **Utilidad conforme a objetivos.** ¿El esquema permite responder las preguntas
   que el producto promete? Si el pitch dice "el docente ve dónde falla cada
   estudiante", tiene que existir una query que lo conteste hoy. Escríbela. Si no
   se puede, ese es el hallazgo.

**Banderas rojas:** timestamps sin zona horaria mezclados, `text` para todo,
lógica de negocio duplicada entre RPC y TypeScript con reglas distintas,
migraciones aplicadas a mano en producción sin archivo.

---

## Visión 2 — Calidad de código

**Misión:** el código hace lo que dice, cuesta lo que debe costar, y el próximo
que lo toque no rompe nada.

**Checklist:**

1. **Costo computacional real.** Busca bucles anidados sobre datos de usuario,
   `.filter().map().find()` encadenados dentro de renders, y O(n·m) escondidos en
   comparaciones de arrays. **Cuantifica con n real**: "O(n²) con n=8 preguntas"
   es irrelevante; "O(n²) con n = todos los estudiantes de la clase" es P1.
2. **Frontera cliente/servidor.** Qué corre en el navegador que debería correr en
   el servidor (y al revés). Datos sensibles o llaves cruzando la frontera.
   `'use client'` en componentes que no lo necesitan y arrastran el árbol entero.
3. **Costo de máquina y de terceros.** Llamadas a LLM/API por acción del usuario.
   ¿Hay caché? ¿Hay lock contra generación duplicada (ver `generationLock.ts`)?
   ¿Un usuario impaciente que recarga cinco veces dispara cinco generaciones
   pagadas? Traduce a dinero: "X llamadas × $Y = $Z por clase".
4. **Utilidad y funcionalidad.** Código muerto, features a medio construir,
   `TODO` de hace meses, rutas sin enlace desde ninguna UI.
5. **Tipado y contratos.** El proyecto lleva un presupuesto de errores TS
   (`TS_ERROR_BUDGET`); mira su tendencia, no solo el número. `any` en fronteras
   (respuestas de API, filas de Supabase) es donde el tipado importa más.
6. **Tests como red real.** No cuentes tests, mira qué protegen. Un test que
   pasaría igual con la función rota no cuenta. Pregunta por cada camino crítico:
   si lo rompo, ¿algo falla en rojo?

**Banderas rojas:** `catch {}` silencioso, reintentos sin backoff, estado
duplicado entre Zustand y la base, efectos que refetchan en cada render.

---

## Visión 3 — Machine learning e IA

**Misión:** el sistema de IA produce contenido correcto, a costo sostenible, y
mejora con el tiempo en vez de degradarse.

**Dónde mirar en Stud.ia:** `src/lib/materials/` (ingesta, chunking),
`src/lib/embeddings/`, `src/lib/questions/` (`cohereGeneration.ts`,
`conceptTaxonomy.ts`, `judge.ts`, `regeneratePool.ts`), `src/lib/gemini/`.

> Si el trabajo entra a fondo en el pipeline de contenido, esta visión delega en
> la skill **`ai-content-pipeline-architect`**, que tiene el framework de 6
> etapas (ingesta → chunking → RAG → grounding → generación → verificación).
> Aquí se hace el diagnóstico de alto nivel; allá, la cirugía.

**Checklist:**

1. **Dónde falla de verdad.** El síntoma ("la pregunta inventa datos") casi nunca
   nace en la etapa donde se ve. Ubica la etapa causal antes de proponer nada.
2. **Verificabilidad.** ¿Existe un juez/validador? ¿Sus criterios son falsables o
   son "evalúa la calidad del 1 al 10"? ¿Qué pasa con lo que reprueba: se
   descarta, se regenera, o se guarda igual?
3. **Costo y cuota.** Modelos usados, límites del plan gratis, comportamiento al
   agotarse la cuota. ¿Hay fallback cross-provider? ¿Degrada con gracia o rompe?
4. **Progreso medible.** ¿Se puede saber si el pipeline de hoy es mejor que el
   del mes pasado? Sin un conjunto fijo de materiales de referencia y una métrica
   repetible, toda mejora es fe. Si no existe, ese es probablemente el hallazgo
   más importante de esta visión.
5. **Potencial no explotado.** Señales que el sistema ya recoge y no usa:
   respuestas incorrectas, tiempo por pregunta, conceptos fallados, preguntas
   rechazadas por el docente. Cada una es un modelo de dificultad o de
   personalización esperando a ser construido — y son gratis, ya están en la base.
6. **Alternativas y automatización.** Qué pasos manuales del docente podrían ser
   automáticos, y cuáles **no deberían** serlo (la revisión pedagógica es un
   ejemplo: automatizarla ahorra tiempo y destruye confianza).

**Banderas rojas:** prompt sin bloque anti-alucinación, temperatura alta en
tareas factuales, parseo frágil de JSON del LLM sin reintento, ausencia total de
límite de gasto.

---

## Visión 4 — Creatividad de idea y desarrollo

**Misión:** el producto es distinto y se siente vivo, no un formulario con
puntos.

**Dónde mirar:** `src/components/minigames/`, `src/components/game/`,
`src/components/cinematics/`, `src/components/tonito/`, el mapa de aprendizaje,
el sistema de logros y de rachas.

**Checklist:**

1. **Inventario honesto de mecánicas.** Lista cada minijuego y responde: ¿qué
   habilidad cognitiva ejercita que los otros no? Si dos juegos son "elige la
   opción correcta" con distinta piel, son uno solo y hay que decirlo.
2. **Diferenciación.** ¿Qué hace este producto que Kahoot, Quizizz, Duolingo o
   Classroom no hacen? La respuesta tiene que ser una frase concreta, no
   "combina gamificación con IA". Si no la tienes, el hallazgo es que falta la
   propuesta única, y es P1 de negocio.
3. **Bucle de entretenimiento.** ¿Por qué un estudiante vuelve mañana sin que se
   lo manden? Nombra el bucle: acción → recompensa → progreso visible → nueva
   razón para actuar. Si el único motor es la tarea obligatoria, el producto
   depende del docente y no del estudiante.
4. **Herramientas del docente.** ¿Le ahorran tiempo real o le dan trabajo nuevo
   con apariencia de tecnología? Cronometra mentalmente el flujo completo:
   importar material → generar → revisar → publicar.
5. **Creatividad aplicable, no fantasía.** Cada idea nueva se propone con su
   costo: qué tabla toca, qué pantalla, cuántos días. Una idea sin costo estimado
   no entra al informe.

**Banderas rojas:** recompensas sin propósito (monedas que no compran nada),
mecánicas que premian velocidad sobre comprensión, features que solo existen
porque eran fáciles de construir.

---

## Visión 5 — Creatividad del diseño

**Misión:** se ve profesional, se siente coherente, y cualquiera puede usarlo.

> Esta visión aplica los criterios de la skill de diseño premium del usuario:
> estética editorial y contenida, cero colores de fábrica saturados,
> micro-interacciones con intención. En este repo eso vive en los tokens
> `--premium-*` y las utilidades `.premium-card` / `.premium-btn` /
> `.premium-focus` de `src/app/globals.css`.

**Checklist:**

1. **Coherencia de sistema.** ¿Hay tokens o hay colores sueltos? Grep de
   `yellow-400`, `red-500`, `#fbbf24` y similares: cada aparición fuera del
   sistema es una grieta. Excepciones legítimas (rareza de logros, feedback
   correcto/incorrecto) se declaran como excepciones, no se ignoran.
2. **Diversidad sin desorden.** Estudiante y docente deben sentirse distintos —
   uno es un juego, el otro una herramienta de trabajo — sin parecer dos
   productos. Verifica que compartan tipografía, radios, espaciado y foco.
3. **Marca.** ¿El producto es reconocible en una captura sin logo? Si no, falta
   identidad, y eso importa para vender.
4. **Interactividad con intención.** Toda animación responde a una acción del
   usuario o comunica un estado. Animación decorativa que retrasa la lectura es
   un defecto, no un adorno.
5. **Accesibilidad (no negociable).** Contraste ≥ 4.5:1 en texto, foco visible en
   todo lo enfocable, navegación por teclado en los flujos críticos, targets
   táctiles ≥ 44px, `prefers-reduced-motion` respetado, y nunca color como único
   portador de significado. En producto educativo esto no es un extra: hay
   estudiantes que dependen de ello.
6. **Estética de los juegos.** Los minijuegos suelen quedar fuera del rediseño
   porque son "internos". Revísalos explícitamente: son donde el estudiante pasa
   más tiempo.
7. **Facilidad.** ¿Cuántos clics de "acabo de entrar" a "estoy aprendiendo"?
   Cuéntalos. Y lo mismo para el docente hasta publicar su primer módulo.

---

## Visión 6 — Visión educativa

**Misión:** esto enseña de verdad, no solo entretiene ni solo mide.

**Checklist:**

1. **Pertinencia del método.** Nombra los principios de aprendizaje que el
   producto implementa y encuentra dónde viven en el código: repetición
   espaciada (`remediation-plans`), práctica de recuperación (quiz), feedback
   inmediato, carga cognitiva, interleaving. Un principio citado en el pitch que
   no existe en el código es un hallazgo de honestidad, y es serio.
2. **Profundidad cognitiva.** Clasifica una muestra real de preguntas generadas
   por nivel (recordar / comprender / aplicar / analizar). Si el 90% es recordar,
   el producto es un memorizador con buena estética. Usa preguntas de la base, no
   imaginadas.
3. **Utilidad de las herramientas.** Para cada herramienta docente: ¿qué decisión
   pedagógica habilita? Un panel que no cambia lo que el docente hace mañana es
   decoración.
4. **Experiencia del docente.** Su moneda es el tiempo y su riesgo es el
   ridículo frente al curso. Todo lo que la IA genere y él publique con su nombre
   debe ser revisable y editable antes de salir.
5. **Experiencia del estudiante.** ¿Qué pasa cuando falla? El momento del error
   es el momento educativo: si el producto solo dice "incorrecto" y resta puntos,
   desperdició su mejor oportunidad de enseñar.
6. **Accesibilidad educativa.** Nivel de lectura del texto generado, materiales
   en español real y no traducido, funcionamiento sin buena conexión (hay soporte
   offline: verifica que sirva en el flujo de estudio, no solo que exista).
7. **Convergencia.** ¿Convive con lo que el colegio ya usa (Classroom, notas,
   currículo oficial) o pide reemplazarlo? Pedir reemplazo es la vía más rápida al
   "no gracias".

---

## Visión 7 — Visión empresarial

**Misión:** decir sin adornos en qué estado está el producto y qué falta para que
alguien pague o lo adopte.

**Checklist:**

1. **Estado real.** Una etiqueta sola: prototipo / MVP / piloto / producción.
   Justifícala con hechos (usuarios reales, datos en producción, fallos abiertos),
   no con intención.
2. **Público objetivo.** Concreto: ¿docente individual que adopta solo, o colegio
   que compra arriba? Son dos productos distintos — distinta venta, distinto
   onboarding, distinta feature clave. Elegir uno es la decisión estratégica más
   apalancada, y postergarla se paga en features construidas para nadie.
3. **Diferenciación.** Una frase que un director de colegio repetiría. Si no
   sobrevive a "¿y eso no lo hace Kahoot?", no está lista.
4. **Qué está excelente.** Obligatorio y específico. Una review que solo lista
   problemas es mala evaluación: si no sabes cuál es tu activo más fuerte, no
   sabes sobre qué construir ni qué proteger.
5. **Qué mejorar para el objetivo declarado.** Ordenado por cercanía al hito de
   Fase 0, no por dificultad técnica.
6. **Herramientas del mercado.** Qué está construido a mano que debería
   comprarse o integrarse (analítica de producto, envío de correo, pagos, banco
   de contenido curricular, LMS). Construir lo que no te diferencia es el error
   de asignación de tiempo más caro en producto temprano.
7. **Escalabilidad.** Tres ejes, con número: técnico (¿qué se rompe con 50 clases
   simultáneas?), económico (¿cuánto cuesta un estudiante-mes en IA e
   infraestructura?), operativo (¿cuánto soporte humano por colegio nuevo?).
8. **Enfoque: mantener o cambiar.** La pregunta incómoda que hay que hacerse en
   serio: si el producto se está construyendo como juego para estudiantes pero
   quien decide la compra es el docente, ¿el foco correcto es el juego o la
   herramienta docente? Argumenta ambos lados y toma posición.
9. **Largo plazo.** Qué se construye ahora que abre opciones después
   (datos acumulados, contenido reutilizable, relación con colegios) y qué cierra
   puertas.

---

## Agente de desarrollo (integrador)

No es la octava opinión. Es quien convierte siete listas en **un punto de
partida**. Su producto es el documento final, y lo escribe pensando en alguien
que no vio ninguna de las siete visiones.

**Reglas de la integración:**

1. **Sintetiza, no concatena.** Si tres visiones señalan el mismo origen, es
   **un** hallazgo con tres consecuencias. Ese es el hallazgo más valioso del
   informe y va primero.
2. **Realista por encima de completo.** El plan se dimensiona contra el tiempo y
   las manos que existen de verdad. Un plan de 40 items para una persona es una
   forma elegante de no hacer nada.
3. **Cada recomendación lleva:** qué se hace · por qué ahora · qué archivos o
   tablas toca · cómo se sabe que quedó bien · qué se sacrifica por hacerlo.
4. **Nombra lo que NO se va a hacer.** Una lista de descartes explícitos vale
   tanto como la de tareas: evita que vuelvan a discutirse el mes que viene.
5. **Innovación anclada.** Máximo 3 ideas nuevas, cada una justificada por un
   hallazgo de alguna visión. Las ideas que no nacen de la evidencia van a una
   sección aparte marcada como especulativa, o no van.

**Estructura del documento final** (`docs/REVIEW_360_<YYYY-MM-DD>.md`):

```markdown
# Review 360 — <producto> — <fecha>
## 0. Para qué se hizo esta review        ← la decisión de Fase 0
## 1. Veredicto en una página             ← estado, activo más fuerte, riesgo mayor, la decisión que toca tomar
## 2. Lo que está excelente               ← primero lo bueno; es sobre esto que se construye
## 3. Hallazgos críticos (P0/P1)          ← cada uno con evidencia, impacto y visiones que lo detectaron
## 4. Hallazgos por visión                ← las siete, máx. 5 cada una, tabla: hallazgo · evidencia · severidad
## 5. Cruces                              ← contradicciones, refuerzos y causas comunes entre visiones
## 6. Plan de partida                     ← Ahora (≤2 sem) / Después (≤2 meses) / Horizonte, dimensionado
## 7. Decisiones que hay que tomar        ← preguntas abiertas que dependen del dueño, no del código
## 8. Descartado a propósito              ← y por qué
## 9. Anexo: cómo verificar               ← queries y comandos usados, para repetir la review en 3 meses
```

El anexo 9 es lo que hace la review repetible. Sin él, la próxima se hace desde
cero y no hay forma de saber si algo mejoró.

## Errores que arruinan una review 360

- **Adular.** Un informe que dice que todo va bien no sirve para decidir. Lo
  contrario tampoco: demoler sin nombrar el activo fuerte deja al dueño sin
  punto de apoyo.
- **Confundir preferencia con hallazgo.** "Yo usaría otra librería" no es un
  hallazgo. "Esta librería carga 300KB en la ruta más visitada" sí.
- **Auditar la intención en vez del sistema.** Lo que el README promete no es
  evidencia; lo que la base de datos contiene, sí.
- **Recomendar reescribir.** Casi siempre es la respuesta de quien no encontró
  el eslabón débil concreto.
- **Terminar en el chat.** Si no quedó documento, no quedó review.
