# Guardia de documentos `jsonb` y `noFit` del laboratorio

Dos piezas de la Iteración 8. Ambas son código puro, sin red.

## 1. Guardia `jsonb` (`src/lib/db/jsonbGuard.ts`)

La parte "documental" de la base son columnas `jsonb`: el grafo de la clase, la ficha de un laboratorio, los intentos de laboratorio. Cada una tiene un `CHECK` de tipo y de tamaño, pero un `CHECK` que falla devuelve un error genérico y deja a medias lo que se estaba haciendo. `guardJsonb(valor, presupuesto)` corre **antes** de escribir y devuelve una **copia limpia** (nunca modifica el original, nunca lanza):

| Qué hace | Por qué |
|---|---|
| Quita el carácter NUL (`\u0000`) de textos y claves | `jsonb` lo rechaza; un solo NUL en un material hacía fallar toda la escritura |
| Reemplaza sustitutos Unicode sueltos por `�` (conserva los pares válidos, como los emojis) | `jsonb` rechaza un sustituto suelto |
| `NaN` / `Infinity` pasan a `null` | no son JSON |
| Quita las claves `__proto__`, `constructor`, `prototype` en cualquier nivel | envenenamiento de prototipos si el documento se mezcla con otro objeto |
| Rechaza ciclos, funciones, símbolos y `bigint` | no son JSON |
| Acota profundidad (12 niveles), nodos (500 000) y tamaño en bytes UTF-8 | los mismos topes que los `CHECK` de las migraciones |
| Exige la raíz que la columna espera (objeto o arreglo) | `jsonb_typeof(...) = 'object' / 'array'` |

Los topes están en `JSONB_BUDGETS` y una prueba **lee las migraciones** (078, 079, 082) y falla si el código se desvía de los `CHECK` reales.

### Dónde se usa
- `src/lib/memory/build.ts`: `graph`, `stats`, `extraction` y las cifras de cada material. Si algo no cabe, la memoria queda en `failed` con un motivo claro (`La memoria es demasiado grande… (el grafo de la clase)`) y **no sube la versión**; antes habría sido un error genérico de la base.
- `LabEditor.tsx` (el navegador del profesor): `labs.spec`, antes de marcar «guardando».
- `POST /api/lab/attempt`: `trials` y `answers`, antes de abrir el cliente de servicio; un informe enorme da 422 con mensaje claro.

### Límites que conviene tener presentes
- La base mide `pg_column_size` (tamaño binario de `jsonb`, comprimido si es grande); la guardia mide los **bytes del texto JSON**. Es una buena estimación, **no una garantía**: un documento lleno de números pequeños puede ocupar más en `jsonb` que en texto. Por eso el `CHECK` de la base se mantiene como respaldo.
- Una clave con nombre `constructor`, `prototype` o `__proto__` se descarta. Hoy ningún documento del sistema las usa como nombre de propiedad.
- No se conectaron otros puntos de escritura `jsonb` (p. ej. `lesson_questions.game_data`, `study_cards.extra`): no estaban en el alcance.

### Índices
Ninguna consulta de la app filtra **dentro** de estos documentos (se leen enteros, por clave primaria o por clase), así que no hace falta ningún índice GIN. Si algún día se filtra por una clave interna (p. ej. `spec->>'template'`), conviene un **índice de expresión** sobre esa clave y no un GIN general: un GIN sobre documentos de hasta ~800 KB encarece cada escritura.

## 2. `noFit` decidido en código (`isNonNumericActivity`)

Una idea como «que escriban un poema sobre el mercado» no es un experimento simulable. El prompt de requisitos ya decía que respondiera `{"requisitos": null}` en ese caso, pero **el modelo real no lo cumplía**: inventaba variables económicas («Salario real», «Oferta del mercado») y la idea terminaba clasificada como `insufficient`.

Se probó endurecer el prompt con el modelo real (`npm run eval:lab-design`, 2 o 3 corridas por variante):

| Variante | `sufficiencyAccuracy` | Resultado |
|---|---|---|
| Prompt original | 0.667 (estable) | `poema-nofit` y `curva-parcial` fallan |
| «PRIMERO decide…» + «NUNCA inventes variables» | 0.5 (3 corridas) | **peor**: 3 casos pasan a `sufficient` |
| Misma idea, sin «NUNCA inventes» | 0.5 y 0.667 | sigue peor |
| Solo ampliar la línea existente con ejemplos | 0.667 y 0.5 | sin mejora; `gases-suficiente` empieza a fallar |
| **Comprobación en código** (prompt original) | **0.833 (2 corridas)** | `poema-nofit` ya no falla |

Retocar el prompt no funcionó y movía otros casos al azar, así que **no se cambió el prompt**. La decisión se toma en `designLab`, antes de gastar IA y antes de mirar la memoria:

- Bloquea solo si la idea nombra una **obra creativa** (poema, cuento, ensayo, dibujo, canción, obra de teatro…) **y** no menciona **nada cuantitativo** (calcular, simular, variable, curva, precio, tasa, datos, fuerza…).
- Es **conservadora a propósito**: ante la duda la idea sigue a la IA (el peor caso es el comportamiento de antes). No se bloquea «que dibujen la curva de oferta y demanda y calculen el equilibrio».
- Respeta límites de palabra (`diversos` no es `versos`; `se amasa` no contiene la pista `masa`) y no distingue tildes ni mayúsculas.
- Límite: es una lista de palabras en español. Una actividad creativa descrita sin ninguna de ellas pasa a la IA y puede seguir clasificándose mal.

El caso `curva-parcial` del conjunto de oro (se clasifica `insufficient` en vez de `partial`) es otro problema, de calibración de suficiencia, y sigue pendiente.
