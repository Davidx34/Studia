# Memoria de la clase: verificación de fórmulas, objetivos y contexto del tutor (iteración 3)

Complementa `docs/LABORATORIOS.md`. Todo lo de aquí es **determinista, sin red y sin IA**.

## 1. ¿Las fórmulas del modelo son las de los apuntes? (`src/lib/lab/formulaMatch.ts`)

La IA lee las ecuaciones de los materiales (la memoria de la clase) y escribe un modelo declarativo. Antes, nada comprobaba que lo que escribió coincidiera con los apuntes. Ahora, al diseñar un laboratorio, cada fórmula del modelo (pasos y salidas) se **compara con números** contra las ecuaciones **literales** de los conceptos en los que dice apoyarse (`basis`).

**Cómo:** no se comparan textos. Cada ecuación `L = R` de los apuntes se evalúa sobre 25 estados reales del modelo (el primero son los valores iniciales; el resto, valores deterministas dentro de los rangos de las variables y constantes) con el evaluador seguro propio (`public/labs/expr.js`, sin `eval`). Una ecuación se *cumple* si `L` y `R` dan lo mismo en todos los estados. Así se cubren por igual las formas explícitas (`F = m·a`) y las implícitas (`P·V = n·R·T`), sin despejar nada.

| Etiqueta | Significa |
|---|---|
| `exact_match` | una ecuación de los apuntes se cumple en todos los puntos (también si solo difiere por un redondeo de menos de 1 %) |
| `scaled_match` | se cumple salvo un factor constante distinto de 1 (cambio de unidades: kPa/atm, ×100…); se informa el factor |
| `divergent` | los símbolos se alinean **por nombre** y la ecuación **no** se cumple (o solo en parte de la rejilla: p. ej. el modelo pone un tope que los apuntes no mencionan) |
| `unverified` | no hay con qué compararla (los apuntes no traen una ecuación que la incluya, no se pudo leer, o no se pudieron alinear los símbolos). **No es un error.** |

- Se entiende la notación de los apuntes: `·`, `×`, `÷`, `−`, `√x`, `x²`, letras griegas (`σ`→`sigma`), subíndices (`p_x`), concentraciones (`[S]`), multiplicación implícita (`2x`, `a(b+c)`) y la notación de función a la izquierda (`U(x,y) = …`). Lo que no se sabe leer (porcentajes, valores absolutos, `log` ambiguo, desigualdades) queda **sin verificar**: nunca se adivina.
- **Alineación de símbolos:** primero por nombre (igual, o igual sin mayúsculas ni signos: `p_x` ~ `px`). Si algún símbolo no tiene homónimo, se prueban las asignaciones posibles (hasta 3 símbolos y 12 candidatos) y **solo se conservan las que confirman**. Un renombrado **nunca acusa**: ante la duda, «sin verificar» y no una falsa alarma. `P = I²·R` es cierta leyendo `R` como la carga o como la resistencia interna: las dos lecturas verifican fórmulas distintas.
- **Varias ecuaciones para una misma fórmula:** una divergencia clara (de una ecuación que solo habla de esa fórmula) manda sobre un acierto en otra; si no, vale el mejor resultado.
- **Dónde se ve:** `designLab` devuelve `formulaChecks` y avisa en `warnings` de lo divergente; `/api/lab/design` lo envía y el editor del profesor muestra la tarjeta «¿Las fórmulas coinciden con tus apuntes?» (cada fórmula con su etiqueta **en texto**, no solo en color, la ecuación y el concepto con que se comparó).
- **Límites:** es una *ayuda* para el profesor, no una prueba matemática (la rejilla es finita). Solo se verifica el modelo tal como lo diseñó la IA; si el profesor edita las fórmulas después, no se vuelve a verificar.

## 2. Cobertura de objetivos (`src/lib/memory/objectivesCoverage.ts`)

`assessObjectives(objetivos, grafo)` cruza los objetivos de aprendizaje de la clase (`classroom_learning_objectives`) con la memoria y dice, por objetivo, si está **cubierto** (`sufficient`), **a medias** (`partial`) o **huérfano** (`insufficient`), con los términos que faltan en palabras para el profesor. También lista los **temas centrales** (importancia ≥ 4) que ningún objetivo menciona.

- `objectiveTerms`: del título quita el verbo inicial («Comprender…», «El estudiante será capaz de…») y los artículos, parte en «a, b y c» (términos *esenciales*) y suma como *deseables* los de la primera frase de la descripción. Conserva tildes y mayúsculas.
- Cada término se mide con la prueba de suficiencia (`sufficiency.ts`). Cubierto = todo lo esencial aparece (con definición) y el peso alcanza el 75 %; a medias = algo aparece o está flojo; huérfano = nada esencial aparece.
- **Estado:** función pura probada. **Aún no está conectada a una pantalla ni a una ruta** (a propósito: no se agrega una ruta sin consumidor).

## 3. Contexto anclado para el tutor (`src/lib/memory/tutorContext.ts`)

`buildTutorContext(grafo, consulta)` extrae el subgrafo relevante para **una** pregunta: el concepto consultado, **todo lo que hay que saber antes** (cierre transitivo de prerrequisitos en orden de estudio, por el orden topológico de Kahn), las **fórmulas literales** de los materiales y los prerrequisitos que los materiales nombran pero **no explican**. Si el tema no está en los materiales, lo dice (el tutor no debe inventarlo).

`renderTutorContext` lo entrega como **dato** entre `<<<CONTEXTO … CONTEXTO>>>`, en una sola línea por concepto y sin rachas de `<`/`>` (el material no puede cerrar el bloque). Acepta un `sanitize` inyectado: al integrarlo en un prompt hay que pasar `sanitizeForPrompt` (de `src/lib/security/promptSanitizer.ts`, PR #167) porque el contenido viene de los materiales.

- **Estado:** función pura probada. **Aún no hay un tutor conversacional que la use.**

## 4. Cuatro modelos nuevos (`src/lib/lab/modelExamples.ts`)

| id | Área | Qué enseña |
|---|---|---|
| `gases` | Química | Gases ideales `P·V = n·R·T`: isoterma (P·V constante) |
| `enzima` | Biología | Michaelis-Menten `v = Vmax·[S]/(Km + [S])`: saturación, Km = [S] a media velocidad, 1/v lineal en 1/[S] |
| `muestreo` | Estadística | Error estándar `SE = σ/√n`: cuadruplicar la muestra reduce el error a la mitad; intervalo `μ ± z·SE` |
| `circuito` | Física | Fuente con resistencia interna y dos resistencias en paralelo: ley de Ohm, potencia en la carga y perdida, máxima transferencia cuando la carga iguala a la fuente |

Todos validan con el motor (`validateModel`: rejilla numérica, escena, límites) sin avisos, y sus pruebas comparan contra las fórmulas cerradas (p. ej. `Pcarga + Pinterna = ε·I`; potencia máxima `ε²/4r`). Aparecen solos en la lista de ejemplos del profesor y como ejemplos de formato para la IA.
