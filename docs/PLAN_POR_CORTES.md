# Plan del curso "hacia atrás" (por cortes): dominio puro

Primer PR del hito. Solo **código puro** en `src/lib/blueprint/`: sin base de datos, sin IA, sin pantallas. Fija en código y en pruebas las decisiones del dueño antes de construir nada encima.

## La idea

El profesor escribe un **borrador** del curso y la IA lo desarrolla **de adelante hacia atrás**: primero qué debe comprender el estudiante al final, luego la evaluación de cada corte, luego los objetivos, los módulos y las preguntas. La cadena es trazable:

```
comprensión final → evaluación de corte → objetivo → módulo → (preguntas del módulo)
```

La **evaluación final no se guarda aparte**: es, por construcción, *todas* las comprensiones finales.

## Decisiones del dueño (ya codificadas)

| Decisión | Dónde |
|---|---|
| Las evaluaciones las toma el estudiante dentro de la app (por eso se calificaron en el servidor antes) | — |
| Cantidad de cortes libre (1 a 12) y cada corte **pondera**; la suma es 100 | `validate.ts` (`weightSum`, `weightRange`) |
| Si el profesor edita una comprensión final, **se regenera** lo de abajo | `regenerate.ts` |
| Regenerar **no destruye intentos**: lo ya intentado se *versiona* | `regenerate.ts` |
| El estudiante **no avanza** al siguiente módulo sin 100 % | `progress.ts` (`courseProgress`) |
| **Cada intento cuenta**: la nota del módulo es el promedio (80, 90, 100 → 90) | `progress.ts` (`moduleScore`) |
| **Recorrido:** módulos del corte → **evaluación del corte** → siguiente corte → … → **evaluación final**. Sin dominar (100 % en un intento) la evaluación de un corte no se pasa al siguiente corte; la final se desbloquea **al terminar todos los cortes**; los intentos son **ilimitados** hasta llegar al 100 % | `progress.ts` (`courseProgress`) |
| **Las evaluaciones (de corte y final) se pueden repetir** y su nota es el **promedio de todos los intentos hasta llegar al 100 %**, igual que un módulo (60, 80, 100 → 80); con un 100 ya no se repite | `progress.ts` (`examScore`, `canRetakeExam`) |
| **Evaluación final: nota propia, vale medio corte.** Con 3 cortes y la final son 3,5 cortes que se promedian para la nota del curso | `progress.ts` (`finalExamResult`, `finalExamWeight`, `courseGrade`) |
| **Nota de un corte = 70 % módulos + 30 % evaluación de corte.** La nota de la evaluación va **aparte** de la de los módulos y las dos se van sumando a la nota del curso a medida que existen | `progress.ts` (`periodResult`, `courseGrade`) |

## Piezas

- **`parse.ts`** — lector estricto de un borrador (del profesor o de la IA). Reporta todo lo que está mal **con su ruta** (`periods[1].objectives[0].title`), no lo arregla en silencio. Límites: 20 comprensiones, 12 cortes, 12 objetivos por corte, 12 módulos por objetivo; ids `[A-Za-z0-9_-]{1,40}`; textos limpios de caracteres de control.
- **`validate.ts`** — `checkBlueprint` devuelve **todos** los problemas (no solo el primero), cada uno con el id afectado. `error` impide publicar; `warning` solo avisa:
  1. los cortes suman 100 (tolerancia de una centésima: 33,33 + 33,33 + 33,33 = 99,99 se acepta) y cada uno pesa entre 0 (exclusivo) y 100;
  2. toda comprensión la evalúa al menos un corte;
  3. todo corte evalúa algo, y **no se evalúa lo que no se enseña** (cada comprensión evaluada tiene un objetivo del corte que la enseña);
  4. todo objetivo apunta a comprensiones que **su** corte evalúa y tiene módulos;
  5. el orden de cortes, y de módulos dentro de un objetivo, no se repite.
- **`regenerate.ts`** — `planRegeneration(viejo, nuevo, intentos)` **solo planea** (no toca nada) y dice qué acción corresponde a cada elemento:

  | Acción | Cuándo |
  |---|---|
  | `keep` | no cambió nada de lo que lo sostiene |
  | `regenerate` | cambió y **nadie lo intentó**: se rehace en su lugar |
  | `version` | cambió y **alguien lo intentó**: se archiva lo viejo para quienes ya lo hicieron y se crea una versión nueva |
  | `create` | es nuevo |
  | `delete` | ya no está y nadie lo intentó |
  | `archive` | ya no está pero alguien lo intentó: se conserva |

  Qué cuenta como cambio: una comprensión cambia si cambia su texto (sin importar mayúsculas ni espacios), se agrega o se quita; una evaluación de corte, si cambia el *conjunto* de comprensiones que evalúa o alguna de ellas cambió; un objetivo, igual (cambiar solo su título **no** obliga a regenerar); un módulo, si su objetivo se regenera o cambia de objetivo. Una prueba de propiedades (400 casos aleatorios) comprueba que **jamás** se borra ni se regenera en su lugar algo que un estudiante ya intentó.
- **`progress.ts`** — `moduleScore`, `hasMastered`, `flattenModules`, `courseProgress`, `examScore`, `canRetakeExam`, `periodResult` / `periodResultOf`, `finalExamResult`, `finalExamWeight`, `courseGrade`. Recibe los **intentos** ya calificados (0–100) de cada módulo y de cada evaluación; no califica nada. Ignora (sin moverlos) los datos fuera de 0–100. Usa `Map` porque `__proto__` es un id válido.

  **La nota se va computando.** Cada corte vale 100 puntos: hasta 70 por los módulos (se reparten por igual entre los N módulos del corte; cada módulo intentado aporta `70/N · nota/100`) y hasta 30 por la evaluación (la nota de cada módulo y de la evaluación es el promedio de sus intentos). Lo que todavía no se calificó **no cuenta como un cero**: simplemente aún no suma. Por eso hay dos números: `points` (puntos ganados) y `gradedShare` (cuánto del corte ya tiene nota), y el `score` es el promedio sobre lo ya calificado. Ejemplo: 1 de 4 módulos al 100 y sin evaluación → 17,5 puntos de 17,5 calificados (nota 100), no 17,5 sobre 100. El curso suma lo mismo ponderado por el peso de cada corte (`earned`, `completedWeight`, `average`). Los módulos y la evaluación se exponen por separado (`modulesAverage`, `exam`).

  **Dos banderas distintas:** `graded` = todo tiene nota (todos los módulos intentados y la evaluación tomada; la nota todavía puede subir si algo se repite) y `closed` = no queda nada por hacer (todos los módulos y la evaluación llegaron al 100 % en algún intento).

  **Evaluación final = medio corte.** Su peso es la **mitad del peso promedio de un corte**, y la nota del curso es la suma ponderada de los cortes y la final dividida entre el peso total (cortes + final). Con 3 cortes iguales eso es exactamente 1/3,5 del curso: cortes en 100 y final en 0 → 85,71; cortes en 0 y final en 100 → 14,29. La final cuenta en el peso total aunque aún no se haya tomado (la nota es «sobre el curso completo»), pero no en lo ya calificado.

## Supuestos que tomé (decídelos tú si no te sirven)

1. **El 100 % se mide por intento**: basta *un* intento con 100 para desbloquear el siguiente módulo (como tu ejemplo 80, 90, 100). El promedio no decide el avance.
2. **Un módulo sin intentos no tiene nota**, y un corte no tiene nota por sus módulos hasta que todos tengan alguno.
3. **Mover un módulo de objetivo lo rehace** (o lo versiona), por prudencia: su contenido estaba atado a las comprensiones del objetivo anterior.
4. Los 70 puntos de los módulos se reparten **por igual** entre los módulos del corte (sin pesos distintos por módulo).
   Como los cortes llevan ponderación (no son todos iguales), «medio corte» lo interpreté como **la mitad del peso promedio** de un corte. Con cortes iguales coincide con tu ejemplo de 3,5 cortes; con cortes de pesos distintos es una generalización mía.
5. Un corte sin módulos no tiene parte de módulos y nunca se considera completo (la validación ya lo impide al publicar).

## Decisiones abiertas (cambian el siguiente PR)

- **¿Cuándo se desbloquea la evaluación de un corte?** Supuesto mío: al dominar **todos los módulos de ese corte**. (Si debe poder tomarse antes, cambia solo `courseProgress`.)

## Esquema en la base (migración 085, sin aplicar hasta el «aplica la 085»)

Dos tablas, cada una con el modelo que le corresponde (ver `docs/ESCALABILIDAD_DE_DATOS.md`):

- **`course_blueprints`** — el plan como **documento `jsonb`**, una fila por versión (`draft` → `published` → `archived`). Un plan publicado es **inmutable**: cambiarlo crea una versión nueva, así los intentos de los estudiantes siguen apuntando a la versión con la que se hicieron. Un solo borrador y un solo plan publicado por clase; el número de versión de la fila y el del documento coinciden; el documento pesa menos de 400 KB (cubre el máximo teórico de `parseBlueprint`).
- **`exam_attempts`** — los intentos de las evaluaciones de corte y final, **relacionales**. La base asigna el número de intento bajo un candado por (plan, estudiante, evaluación), exige plan publicado, estudiante matriculado y corte existente, y **rechaza un intento nuevo si la evaluación ya se dominó (100 %)**. Es un historial: un `UPDATE` se rechaza.

**Seguridad:** nadie escribe desde el navegador (`anon` y `authenticated` solo tienen `SELECT`, y no hay políticas de escritura). El servidor escribe el plan tras validarlo (`parseBlueprint` + `checkBlueprint` + la guardia `jsonb`) y los intentos tras calificar. El profesor dueño ve todo lo de su clase; el estudiante ve solo los planes **publicados** de sus clases y solo **sus** intentos. Sin `SECURITY DEFINER`; las funciones fijan su `search_path`; la migración es aditiva (no toca ninguna tabla existente).

**Lo que la base NO impone** (lo impone la aplicación, `courseProgress`): el orden del recorrido (la evaluación de un corte se desbloquea al dominar sus módulos; la final, al terminar todos los cortes). Tampoco vincula todavía los módulos del plan con las lecciones reales (`content_modules`); eso es un PR posterior.

**Verificación previa a aplicarla:** la migración se ejecutó contra la base de producción dentro de una transacción que se revierte (sin dejar rastro) con 57 comprobaciones: restricciones del documento, transiciones de estado, numeración y dominio de intentos, matrícula, y qué ve cada rol (estudiante matriculado, no matriculado, otro estudiante de la clase, profesor dueño y `anon`), incluido el borrado en cascada.

## Lo que sigue (PRs pequeños)

1. ~~Esquema aditivo en la base~~ (migración 085, ver arriba).
2. Motor "hacia atrás" con la IA: cada paso (comprensiones → evaluación de corte → objetivos → módulos) con su prompt, validado con `parseBlueprint` + `checkBlueprint`, y con reintentos guiados por los errores, como el diseño de laboratorios.
3. Pantalla de borrador del profesor.
4. Preguntas por corte.
5. Vista del estudiante (avance por dominio, notas, intentos).

## Límites

- Nada de esto se ejecuta aún en la app: son funciones y tipos sin consumidores. No hay ningún cambio visible.
- Las reglas de `checkBlueprint` comprueban coherencia **estructural**; no juzgan si una comprensión está bien redactada ni si un objetivo realmente la enseña. Eso será trabajo de la IA y del profesor.

## Ruta del servidor: guardar y publicar (`POST /api/blueprint`)

El plan se **lee** desde el navegador con la sesión y la RLS de la migración 085 (el profesor ve sus versiones; el estudiante, solo el publicado de sus clases). Se **escribe** solo por esta ruta, que comprueba sesión y que quien pide es el **profesor dueño** (cualquier otro recibe 404) y escribe con la llave de servicio.

- `{ action: 'save', classroomId, blueprint }` — pasa el documento por `guardJsonb('courseBlueprint')` (tamaño, profundidad, claves peligrosas), `parseBlueprint` (forma, 400 con la ruta de cada error) y `checkBlueprint` (reglas). **Un borrador a medias sí se guarda**; la respuesta trae `issues` y `publishable`. La versión la decide la fila, no el navegador: si ya hay borrador se actualiza ese; si no, se crea la versión siguiente (contando también las archivadas).
- `{ action: 'publish', classroomId }` — vuelve a leer y revisar lo **guardado**; si tiene errores de reglas responde 422 con `issues` y no toca nada. Si pasa, **archiva el publicado anterior y luego publica** el borrador.
- Archivar y publicar son dos escrituras (supabase-js no tiene transacciones y la base admite un solo publicado por clase). Si la segunda falla, la clase queda un momento sin plan publicado; **reintentar publica sin problema** (ya no hay publicado que archivar) y el borrador no se pierde. Si esto importa más adelante, se resuelve con una función SQL (migración nueva) que haga las dos en una transacción.
- Código: `src/lib/blueprint/store.ts` (lógica con la base inyectada), `storeDb.ts` (adaptador de Supabase), `src/app/api/blueprint/route.ts`.

## Motor "hacia atrás" con IA (`generate` en `POST /api/blueprint`)

`{ action: 'generate', classroomId, brief }` desarrolla el **borrador del profesor** en un plan completo, de adelante hacia atrás. **No guarda nada**: devuelve `blueprint`, `issues` y `publishable` para que el profesor lo revise, lo edite y lo guarde con `save` (así no pisa un borrador que ya editó).

`brief`: `{ title, description?, periods (1–12), weights?, outcomes?, topics? }`.

**Lo que decide el código, no la IA:** cuántos cortes; cuánto pesa cada uno (si el profesor no da pesos se reparten por igual sumando exactamente 100: 3 cortes → 33,34 / 33,33 / 33,33); las comprensiones finales si el profesor las escribió (la IA no puede cambiarlas); los ids (la IA habla de posiciones). Además el código garantiza que toda comprensión la evalúe algún corte y que ningún corte quede sin evaluar nada.

**Lo que propone la IA** (dos pasos, cada uno con un reintento guiado por el error exacto):
1. las comprensiones (si no vienen) y qué comprensión evalúa cada corte;
2. por corte, los objetivos (1–5) y sus módulos (1–6), cada objetivo ligado a las comprensiones que ese corte evalúa.

El resultado pasa por `parseBlueprint` + `checkBlueprint` como cualquier plan. Si la IA deja un corte sin cubrir algo, **se devuelve el borrador con el aviso** (por ejemplo `assessedWithoutObjective`): no se inventa contenido ni se arregla en silencio. Un corte que la IA no logra desarrollar queda sin objetivos y se señala; si ninguno sale, responde 503.

**Seguridad y costo:** lo que escribe el profesor entra a la IA saneado (`sanitizeForPrompt`, aplanado a una línea) y declarado como dato; la salida de la IA se trata como dato (se lee, se recorta a los límites, se valida). Cupo por profesor (`blueprintGenerate`: 2/min, 12/h, 40/día; usa el contador de la migración 080, sin migración nueva), consumido **después** de validar el borrador y **antes** de llamar a la IA; cada generación son 1 + N llamadas (N = cortes).

Código: `src/lib/blueprint/generate.ts` (puro, el modelo se inyecta).
