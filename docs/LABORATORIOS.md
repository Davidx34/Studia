# Laboratorios

Un **laboratorio** es un experimento en un **ambiente controlado**: el estudiante mueve **una variable a la vez**, mide lo que pasa, registra ensayos, grafica, y entrega un informe (hipótesis, datos, preguntas y conclusión). Sirve para materias donde las variables y los entornos controlados son esenciales: física, química, biología, macroeconomía, matemáticas, estadística.

## Idea central: la IA no escribe código

| Pieza | Quién la hace | Qué es |
|---|---|---|
| **Plantilla** (`public/labs/<id>.html` + `models/<id>.js`) | nosotros, revisada y probada | el modelo matemático y el dibujo (física, economía…) |
| **Ficha del experimento** (`LabSpec`) | el profesor o la IA | título, objetivo, qué variable se mueve, rangos, constantes (la Luna, otro mercado), preguntas guía |
| **Laboratorio** | la app | plantilla + ficha **validada y recortada** a los límites de la plantilla |

Por eso la IA **no puede** meter código en el navegador de un estudiante, ni inventar una fórmula equivocada: solo da datos que se validan, y las fórmulas son las nuestras.

## Seguridad (lo que las pruebas vigilan)

- **Aislamiento:** el laboratorio corre en un `<iframe sandbox="allow-scripts allow-downloads">` **sin** `allow-same-origin`. Tiene origen opaco: no lee la sesión, las cookies, el almacenamiento ni el DOM de la app, ni llama a la API con las credenciales del estudiante.
- **Solo `postMessage`**, y la app **valida todo** lo que llega (`protocol.ts`): forma, tamaños, números finitos y acotados, llaves con formato.
- **Sin `innerHTML`, `eval`, red ni almacenamiento** en el runtime ni en los modelos (una prueba lo exige, ignorando comentarios).
- **Texto limpio:** la ficha pasa por `sanitizeText` (sin etiquetas ni caracteres de control) y el runtime escribe todo con `textContent`.
- `/labs/` es público (sin sesión) a propósito: un iframe aislado no manda cookies. Son solo archivos estáticos de código, sin datos de nadie.

## Archivos

```
src/lib/lab/
  types.ts          tipos (plantilla, ficha, laboratorio resuelto, ensayo, informe)
  labTemplates.ts   CATÁLOGO: fuente única de variables, límites, constantes, salidas y preguntas
  labSpec.ts        validateLabSpec / resolveLab / buildLab (la barrera entre la IA y el estudiante)
  protocol.ts       mensajes app ⇄ laboratorio y su validación
  labTheme.ts       los colores de la app (claro/oscuro) pasados al laboratorio
src/components/lab/LabFrame.tsx   el iframe aislado + la conversación
src/app/dev/laboratorios/         visor del panel de desarrollo (cada plantilla funcionando)
public/labs/
  runtime.js / runtime.css        construye TODA la interfaz a partir del catálogo
  <id>.html                       la plantilla (carga runtime + modelo)
  models/<id>.js                  el modelo y el dibujo (UMD: navegador y pruebas)
```

## El recorrido del estudiante

1. **Hipótesis** (antes de tocar nada). 2. **Experimenta:** una variable independiente se mueve, las **controladas** quedan fijas (con candado); resultados en vivo y escena. 3. **Datos:** cada ensayo a una tabla; el primero es el **ensayo de control** (línea base). 4. **Gráfica** de cualquier variable contra cualquier resultado (la curva teórica del modelo solo se muestra si el profesor lo pide: el estudiante la descubre con sus datos). 5. **Informe:** preguntas guía y conclusión. No se entrega sin los ensayos mínimos, un ensayo de control, hipótesis y conclusión.

Modo **controlado** (por defecto): solo la independiente se mueve. Modo **libre**: se mueven todas.

## Plantillas hechas

| Plantilla | Área | Concepto |
|---|---|---|
| `trayectoria` | Física | lanzamiento de proyectiles: alcance, altura, tiempo; gravedad de la Tierra, la Luna, Marte |
| `multiplicador` | Economía | multiplicador keynesiano: cruz keynesiana, gasto, impuestos, propensión a consumir |

## Agregar una plantilla

1. **Catálogo** (`labTemplates.ts`): `id`, nombre, área, concepto, variables (con `min`, `max`, `step`, `default`), constantes con rango, salidas, variable independiente y gráfica por defecto, preguntas por defecto.
2. **Modelo** (`public/labs/models/<id>.js`, UMD): `model(v, c)` devuelve **exactamente** las salidas del catálogo; `draw(ctx, W, H, d)` dibuja la escena con `window.Lab.draw.axes`; `describe(v, c, out)` da el texto para lectores de pantalla. Opcional: `animated`, `animateLabel`, `duration`.
3. **HTML** (`public/labs/<id>.html`): copia de una existente cambiando el id y el nombre del modelo.
4. **Pruebas:** las del catálogo, del HTML y de finitud en las esquinas de los límites se aplican solas. **Agrega las pruebas numéricas del modelo** contra fórmulas conocidas (ver `lab.test.ts`): es lo que garantiza que la ciencia está bien.

**Regla de oro:** si el modelo puede dar `NaN` o infinito dentro de los límites del catálogo, ajusta los límites (por ejemplo, el multiplicador acota `c ≤ 0,95` para que no explote).

## Pestaña Laboratorio del profesor (PR2)

`/teacher/classrooms/[id]/lab`. Dos caminos para crear: **con IA** (una idea y/o un material de la clase; la IA elige la plantilla o se le fija una) o **desde una plantilla**. En ambos casos se abre el editor: título, pregunta de investigación, escenario, hipótesis, modo, variable independiente, rango y valor de cada variable, constantes del ambiente, ensayos mínimos, curva teórica y preguntas guía, con la **vista previa real** (el laboratorio en su iframe aislado) a un lado. Se guarda como **borrador** o se **publica**; también se puede despublicar, editar y eliminar (con confirmación).

- **La IA no escribe código.** `POST /api/lab/propose` devuelve solo la ficha (`LabSpec`), ya validada y recortada a los límites de la plantilla (`propose.ts`). Si el tema no se presta a ninguna plantilla, responde 422 con el motivo. El material se envía como dato entre delimitadores. Solo el dueño de la clase (y del material) puede llamarla.
- **Lo guardado se revalida al leer** (`labRows.ts`): una plantilla retirada o un dato corrupto no rompe la lista.
- **Migración 078** (`labs`): el profesor gestiona solo lo suyo; el estudiante solo **lee** los publicados de sus clases; un laboratorio solo puede vincularse a un material propio. Sin la migración, la pestaña lo explica en vez de romperse.
- Los números se confirman al salir del campo y el campo muestra el valor ya recortado.

## Nueva dirección: memoria de la clase + modelo declarativo

El PR2 (pestaña del profesor) solo llenaba números de 2 plantillas cerradas: un tema como microeconomía (utilidad máxima con restricción presupuestal) no encajaba en ninguna y casi nada cambiaba. Las plantillas eran **ejemplos** para que la IA adaptara, no un catálogo. El plan, en tres PR:

1. **Memoria de la clase (este PR).** `src/lib/memory/`. La IA lee cada material y extrae conceptos, variables, fórmulas, leyes y objetivos con sus relaciones; todo se fusiona en un **grafo por clase**.
2. **Motor declarativo.** La IA escribe ecuaciones, variables y gráficas en un lenguaje seguro que interpreta nuestro motor (sin JavaScript de la IA); se valida numéricamente antes de mostrarse.
3. **Generación desde la memoria.** La IA diseña el laboratorio apoyándose en la memoria, cita en qué se basa y **se niega si lo cargado no alcanza** (dice qué falta).

### Memoria de la clase: cómo funciona

- **Extracción** (`extract.ts`): por bloques de texto, con el material como DATO entre delimitadores. Cada concepto debe **apoyarse en el texto** (las palabras de su nombre deben estar en el bloque): lo que la IA inventa se descarta y se cuenta.
- **Estructuras y algoritmos** (`graph.ts`, `merge.ts`, `text.ts`):
  - Grafo con relaciones `requiere` / `se_calcula_con` / `parte_de` / `relacionado`.
  - Orden de estudio por **Kahn** (estable), **rotura de ciclos** quitando la arista más débil, cierre transitivo de prerrequisitos.
  - **Índice invertido con idf** para buscar conceptos (el nombre pesa más que la definición).
  - **Fusión con union-find**: el mismo concepto en dos materiales es un nodo con las fuentes de ambos. La similitud es **palabra por palabra** (tolera un error de tipeo, pero "primera ley" ≠ "segunda ley" y "tema 1" ≠ "tema 2").
- **Incremental** (`build.ts`): cada material guarda el **hash** de su contenido; si no cambió, no se vuelve a llamar a la IA. Borrar un material solo obliga a fusionar de nuevo. La memoria tiene **versión**, reclamo atómico (dos peticiones no construyen a la vez) y presupuesto de tiempo.
- **Prueba de suficiencia** (`sufficiency.ts`): dados los requisitos de lo que se quiere crear (esenciales o deseables, con o sin fórmula), da `sufficient | partial | insufficient`, lo que falta y lo débil (nombrado pero sin definición, prerrequisitos sin explicar). Se usará en el PR3.
- **Migración 079**: `class_memory` (grafo + estado) y `class_memory_material` (extracción + hash). Solo el profesor dueño **lee**; nadie escribe desde el navegador (lo escribe el servidor con la llave de servicio tras comprobar al dueño); los estudiantes no tienen acceso.
- Ruta `POST /api/memory/build` y panel **Memoria de la clase** en la pestaña Laboratorio.

## Motor declarativo (laboratorios a la medida)

Una plantilla fija solo sirve para el tema para el que se escribió. Con el motor declarativo, la IA (o el profesor) **describe el modelo como datos** y el laboratorio se adapta a cualquier materia numérica. La IA **sigue sin escribir código**.

**El modelo** (`LabModel`, `src/lib/lab/types.ts`): variables (con rango y paso), constantes (con rango), **pasos intermedios**, **salidas** y una **escena**; todos los cálculos son fórmulas de texto (`x^a * y^(1-a)`). La ficha usa `template: "modelo"` y lleva el modelo dentro (`spec.model`). Ejemplos: `src/lib/lab/modelExamples.ts` (consumidor con restricción presupuestal, impuesto en un mercado, crecimiento logístico).

**El evaluador** (`public/labs/expr.js`): un parser recursivo propio que convierte la fórmula en funciones ya escritas ahí. **No hay `eval` ni `new Function`.** Solo números, nombres declarados, operadores (`+ - * / ^ %`, comparaciones, `&& || !`) y una lista cerrada de funciones (`sqrt, abs, exp, ln, log10, sin, cos, min, max, pow, clamp, if…`). Sin bucles ni acceso a objetos o a la página. Topes: 240 caracteres, 150 elementos, 24 niveles de anidación. Los nombres se buscan en tablas sin prototipo (un nombre como `constructor` no existe). La multiplicación implícita (`2x`) y la coma decimal son errores con mensaje claro. Es **el mismo archivo** en el servidor (valida) y en el iframe (calcula).

**Validación numérica** (`model.ts`, `validateModel`): además de revisar sintaxis y nombres, evalúa el modelo en una rejilla (extremos y medio de cada rango, constantes en su valor y en sus extremos, y 60 puntos pseudoaleatorios fijos). Si **cualquier salida** da NaN, infinito o pasa de mil millones, el modelo se rechaza **diciendo en qué punto falla** (por ejemplo: «la salida "y" no es un número razonable (Infinity) cuando x = 0 … protege la fórmula con max(...) o if(...)»). Así el estudiante nunca ve un NaN, y en el PR de generación ese mensaje se le devuelve a la IA para que se corrija.

**Escena**: curvas `sweep` (una salida contra la variable independiente) y `param` (curvas paramétricas `x(param), y(param)` con `from`/`to`: recta presupuestal, curva de indiferencia, oferta y demanda…), y puntos marcados. El marco lo definen la primera curva y las marcas.

**Runtime**: `public/labs/modelo.html` + `models/modelo.js` (implementa `prepare(lab)`, un gancho nuevo de `runtime.js`). Mismo iframe aislado, mismo protocolo.

**No requiere migración**: el modelo va dentro de `labs.spec` (jsonb). El panel del profesor ya permite partir de un ejemplo y ajustarlo.

## Diseño desde la memoria de la clase (PR 3)

Pestaña Laboratorio → **Diseñar un laboratorio con IA**. El profesor escribe qué quiere que investiguen; `POST /api/lab/design` (`src/lib/lab/design.ts`) hace:

1. **Requisitos.** La IA ve la lista de conceptos de la memoria y dice **qué conceptos hacen falta** (esenciales o deseables, con o sin fórmula). Si hace falta algo que la lista no tiene, lo escribe igual: así se detecta.
2. **Prueba de suficiencia** (`memory/sufficiency.ts`). `suficiente` sigue; **`insuficiente`** (un concepto esencial que no está en los materiales) **no crea nada** y dice qué falta (HTTP 422, una sola llamada a la IA); **`parcial`** (todo lo esencial aparece, pero flojo: sin definición o sin fórmula) pregunta, y con «Crear de todos modos» sigue dejando un aviso. «Forzar» nunca salta lo insuficiente.
3. **Diseño.** El prompt lleva los conceptos relevantes de la memoria **con sus fórmulas** (y sus prerrequisitos), el formato del modelo, 2 ejemplos y las reglas. Hasta 3 intentos: si el modelo no pasa la validación, **el error exacto vuelve a la IA** (con la fórmula y el punto donde falla).
4. **Ajuste mecánico** (`repair.ts`). Si el fallo está solo en el borde de un rango (dividir por 0 con `x` desde 0), se acorta ese extremo un paso y se avisa; no gasta un reintento.
5. **Coherencia** (`model.ts`, `lint`). Un modelo puede ser numéricamente válido y aun así no representar la materia (lo vimos con un modelo real: el presupuesto aparecía pero ninguna salida lo usaba). Por eso todo lo declarado debe **influir en alguna salida** (si una restricción no se impone, falla con una pista) y la salida de la gráfica debe **responder a la variable independiente**.
6. **Evidencia.** Se registra en qué conceptos de la memoria se apoya (las citas de la IA se reemplazan por los nombres canónicos de la memoria; las inventadas se descartan). El editor los muestra junto con las **fórmulas del modelo** para compararlas con los apuntes antes de publicar.

**Mejora de la memoria (descubierta al probar con un modelo real):** la extracción a veces olvidaba copiar una fórmula que el texto sí trae. Ahora un buscador **determinista** (`memory/equations.ts`) toma la ecuación literal del texto si pertenece a la propia frase del concepto (una fórmula equivocada es peor que ninguna), y el prompt de extracción lo pide explícitamente.

Lo que **no** resuelve: que la fórmula que escribió la IA sea la que traen los apuntes (se muestra al profesor para que la compare) ni que el modelo sea pedagógicamente óptimo.

`/api/lab/propose` (plantillas fijas) quedó sin uso en la interfaz.

## Lo que falta (siguientes PR)

1. **Guardar y revisar:** tabla `lab_attempts` (migración + RLS), el estudiante abre el laboratorio publicado y su informe se guarda; el profesor lo revisa.
2. Límite de uso por profesor en `/api/lab/design`, `/api/lab/propose` y `/api/memory/build`.
3. Borrar `/api/lab/propose` y `src/lib/lab/propose.ts` si no se vuelven a usar.
