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
| El estudiante **no avanza** al siguiente módulo sin 100 % | `progress.ts` (`unlockedModules`) |
| **Cada intento cuenta**: la nota del módulo es el promedio (80, 90, 100 → 90) | `progress.ts` (`moduleScore`) |
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
- **`progress.ts`** — `moduleScore`, `hasMastered`, `flattenModules`, `unlockedModules`, `periodResult` / `periodResultOf`, `courseGrade`. Recibe puntajes ya calificados; no califica nada. Ignora (sin moverlos) los datos fuera de 0–100. Usa `Map` porque `__proto__` es un id válido.

  **La nota se va computando.** Cada corte vale 100 puntos: hasta 70 por los módulos (se reparten por igual entre los N módulos del corte; cada módulo intentado aporta `70/N · nota/100`) y hasta 30 por la evaluación. Lo que todavía no se calificó **no cuenta como un cero**: simplemente aún no suma. Por eso hay dos números: `points` (puntos ganados) y `gradedShare` (cuánto del corte ya tiene nota), y el `score` es el promedio sobre lo ya calificado. Ejemplo: 1 de 4 módulos al 100 y sin evaluación → 17,5 puntos de 17,5 calificados (nota 100), no 17,5 sobre 100. El curso suma lo mismo ponderado por el peso de cada corte (`earned`, `completedWeight`, `average`). Los módulos y la evaluación se exponen por separado (`modulesAverage`, `exam`).

## Supuestos que tomé (decídelos tú si no te sirven)

1. **El 100 % se mide por intento**: basta *un* intento con 100 para desbloquear el siguiente módulo (como tu ejemplo 80, 90, 100). El promedio no decide el avance.
2. **Un módulo sin intentos no tiene nota**, y un corte no tiene nota por sus módulos hasta que todos tengan alguno.
3. **Mover un módulo de objetivo lo rehace** (o lo versiona), por prudencia: su contenido estaba atado a las comprensiones del objetivo anterior.
4. Los 70 puntos de los módulos se reparten **por igual** entre los módulos del corte (sin pesos distintos por módulo).
5. Un corte sin módulos no tiene parte de módulos y nunca se considera completo (la validación ya lo impide al publicar).

## Decisiones abiertas (cambian el siguiente PR)

- **¿Se puede repetir la evaluación de corte?** Si sí, ¿cuenta el último intento, el mejor o el promedio como en los módulos? `periodResult` recibe una sola nota de evaluación ya decidida.
- **¿La evaluación final tiene nota propia?** Hoy es solo la cobertura de todas las comprensiones; no pesa aparte. Si debe pesar, hay que decidir si es un corte más o un porcentaje fuera de los cortes.

## Lo que sigue (PRs pequeños)

1. Esquema aditivo en la base (migración sin aplicar hasta tu «aplica la 08x»): plan versionado, evaluaciones de corte, intentos de evaluación calificados en el servidor.
2. Motor "hacia atrás" con la IA: cada paso (comprensiones → evaluación de corte → objetivos → módulos) con su prompt, validado con `parseBlueprint` + `checkBlueprint`, y con reintentos guiados por los errores, como el diseño de laboratorios.
3. Pantalla de borrador del profesor.
4. Preguntas por corte.
5. Vista del estudiante (avance por dominio, notas, intentos).

## Límites

- Nada de esto se ejecuta aún en la app: son funciones y tipos sin consumidores. No hay ningún cambio visible.
- Las reglas de `checkBlueprint` comprueban coherencia **estructural**; no juzgan si una comprensión está bien redactada ni si un objetivo realmente la enseña. Eso será trabajo de la IA y del profesor.
