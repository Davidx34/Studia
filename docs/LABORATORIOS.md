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

## Lo que falta (siguientes PR)

1. **Motor declarativo** y **generación desde la memoria** (arriba, PR2 y PR3 de esta dirección). Las 2 plantillas actuales pasan a ser ejemplos/familias de dibujo.
2. **Guardar y revisar:** tabla `lab_attempts` (migración + RLS), el estudiante abre el laboratorio publicado y su informe se guarda; el profesor lo revisa.
3. Límite de uso por profesor en `/api/lab/propose` y `/api/memory/build`.
