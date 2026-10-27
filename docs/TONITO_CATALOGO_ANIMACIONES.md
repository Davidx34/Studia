# Toñito: catálogo de animaciones a producir

Plan para reemplazar **todas** las animaciones antiguas (PNG + movimiento CSS) por arte nuevo hecho con Flow/Gemini, con una versión para **celular** y otra para
**computador**. Complementa la [ficha de arte](TONITO_FICHA_DE_ARTE.md) (identidad del personaje, pesos, criterios) y la
[guía de clips](TONITO_CINEMATICAS.md) (cómo se publican). Aquí está **qué falta hacer, en qué orden y qué prompt pegar en Flow**.

> Lo marcado **[medido]** salió del código o de pruebas de este proyecto; **[propuesto]** es una decisión por validar; **[verificar en Flow]** depende de la
> interfaz de Flow, que cambia: confírmalo antes de gastar créditos.

## 1. Por qué en el computador se ve "cortado" [medido]

El clip de celebración es **vertical (9:16)**. En un celular llena la pantalla; en un computador (pantalla horizontal) solo puede verse **entero y centrado**, como una
columna estrecha en medio de la pantalla. Se difuminan los bordes, pero hay dos costuras:
1. **El ancho:** una columna vertical en una pantalla horizontal siempre se siente "recortada", por mucho que se difumine.
2. **El color:** el fondo del clip es **más pálido** que el degradado de la escena (medido: arriba `#EEBC73` frente a `#D97706` pedido), y la columna se distingue de los lados.

**Cómo lo resolvemos, en dos tiempos:**

| | Qué | Costo | Resultado |
|---|---|---|---|
| **A. Ya, sin generar nada** | La escena pinta, detrás del clip, **los mismos colores que tiene el clip en sus bordes** (se miden al publicar). La columna deja de distinguirse | solo código | Sin costura de color; sigue siendo una columna |
| **B. Versión horizontal de cada clip** | Un clip **16:9** hecho para computador, con Toñito en el centro y **el fondo ocupando todo el ancho** | 1 generación más por clip | Pantalla completa de verdad, sin columna |

Recomendación: **A primero** (rápido y mejora lo que ya existe) y **B** para las escenas que más se ven.

**Lo que hay que construir para B** (hoy el sistema guarda **un solo clip por escena**):
1. Tabla `tonito_scene_clips`: columna `orientation` (`portrait` | `landscape`) y clave `(scene, orientation)`.
2. La escena elige `landscape` si la ventana es más ancha que alta y existe; si no, `portrait` (como hoy). Si falta una, usa la otra.
3. `npm run clip:publish -- --scene welcome --orientation landscape`.
4. La conversión hoy limita el **ancho** a 720 px: un clip horizontal quedaría en 720×405 y se vería borroso en un computador. Hay que limitar el **lado largo** a 1280
   (vertical 720×1280, horizontal 1280×720: mismos píxeles, mismo peso ≈ 300 KB).

## 2. Qué reemplaza a qué (inventario del código) [medido]

Hoy todo se hace con **6 PNG** (`happy`, `excited`, `encouraging`, `thinking`, `sad`, `surprised`) y animaciones CSS. Aparecen así:

| Dónde | Qué muestra hoy | Tamaño | Reemplazo |
|---|---|---|---|
| Cinemática `welcome` (primera vez) | `excited` + entrada épica | pantalla completa | **A1** clip |
| Cinemática `lesson_start` | `excited` + baile | pantalla completa | **A2** clip |
| Cinemática `module_complete_good` (≥ 70 %) | `celebrating` (usa `excited`) | pantalla completa | **A3** clip (vertical **hecho**) |
| Cinemática `module_complete_low` (< 70 %) | `encouraging` + reflexión | pantalla completa | **A4** clip |
| Cinemática `streak` (3, 5, 10… días) | `celebrating` + salto | pantalla completa | **A5** clip |
| Lección: "preparando tus preguntas" (espera de la IA) | `thinking` | 110 px | **B1** bucle |
| Lección: "no se pudo preparar" | `sad` + temblor | 110 / 90 px | **B2** clip |
| Repaso: pensando / refuerzo completado | `thinking` / `celebrating` + supersaiyan | 90 / 110 px | **B1** / **B3** |
| Aviso de refuerzo (`RemediationPrompt`) | `thinking` | 100 px | **B1** |
| Widget flotante, cabecera y panel del chat | `mood` del store (8 emociones) | 42–72 px | **Poses P1–P8** (imágenes) |
| Reacción a cada respuesta (acierto/error), minijuegos, mapa | `excited`/`encouraging`/`thinking` + CSS | 72 px | **Poses P2, P3, P4** (imágenes) |
| Inactividad (2 min) / regreso | `sad` (¡usado como "durmiendo"!) / `surprised` | 72 px | **P8 / P6** (poses), o **B4 / B5** si se quiere clip |

Hay un error de arte que ya estaba: `celebrating` reutiliza `excited` y `sleeping` reutiliza **`sad`** (Toñito se duerme con cara triste).

**Criterio de formato [propuesto]:**
- **Lo que ocurre en cada pregunta** (acierto, error) → **poses fijas + movimiento en código**. Un video en cada pregunta es demasiado peso.
- **Lo que ocurre pocas veces y a pantalla completa** → **clip** (A).
- **Esperas y pantallas de estado de ~100 px** → **clip corto en bucle** (B), dentro de una tarjeta con su propio fondo (los clips **no tienen transparencia**).
- **Widget y chat (≤ 72 px)** → **poses**.

## 3. Lista de producción y orden

**Total:** 8 poses + 5 clips a pantalla completa × 2 formatos (9 por hacer) + 3 clips cortos (B1 a B3) = **20 generaciones**, más 2 opcionales (B4, B5).

| Prioridad | Qué | Por qué |
|---|---|---|
| **P0** | **Poses P1–P4** (reposo, acierto, ánimo, pensando) | Son lo más visto: salen en cada pregunta |
| **P0** | **Arreglo A** (colores del borde) — *código* | Mejora ya el clip existente en computador |
| **P1** | **A3 horizontal** (celebración) | Es el único clip que ya existe: completa su par |
| **P1** | **A1, A4, A2, A5** (vertical + horizontal) | Las 4 cinemáticas que siguen con PNG |
| **P1** | **B1, B2** | La espera de la IA y el error son lo más visible de lo pequeño |
| **P1** | **Poses P5–P8** | Cierra el set; corrige "durmiendo con cara triste" |
| **P2** | **B3**; opcionales B4, B5 | Poco frecuentes |

Estado: ☑ A3 vertical (publicado) · ☐ todo lo demás.

## 4. Reglas comunes a todo lo que se genera

**Formato.** Los clips son **MP4 H.264 sin audio, sin transparencia, con su propio fondo**, 24 fps, ≤ 400 KB y póster ≤ 60 KB (lo convierte `npm run clip:publish`).

**Qué pedirle a Flow siempre:**
- **Sin texto, botones ni interfaz** dibujados en el video (la escena pone su propio texto y su botón «Continuar»).
- **Cámara fija**, sin cortes ni zoom. **Sin audio.** Sin otros personajes ni marcas.
- **Fondo liso** (degradado del color de la escena): sin objetos, horizonte ni suelo con textura.
- **Toñito igual que la referencia:** adjunta siempre la **imagen de referencia aprobada** como "ingrediente" **[verificar en Flow]**. Casco, gafas, moño, bata, chaleco, pantalón y botas **no cambian**.

**Composición para que el texto de la escena se lea** [medido: en el primer clip los pies cayeron al 80 % de la altura, justo donde va el texto]:
- El texto de la escena ocupa **el tercio inferior**. Los **pies de Toñito deben quedar sobre el 60 – 65 % de la altura**, con **el suelo vacío debajo**.
- **Toñito centrado** horizontalmente y **siempre dentro del encuadre**.

**Bucles.** Primer y último cuadro **iguales**. En Flow, usa **"Frames to Video" con la misma imagen como primer y último cuadro** para que cierre solo **[verificar en Flow]**.

**Colores del fondo** (los de `CinematicScene.tsx`; el degradado de la escena va **en diagonal**, de arriba-izquierda a abajo-derecha). Flow no clava el color exacto
(salió más pálido): **no importa**, porque el arreglo A mide el clip real. Pide el color igualmente, para quedar cerca.

| Escena | Estos 3 colores (de arriba-izquierda a abajo-derecha) |
|---|---|
| `welcome` | `#6D28D9` · `#7E22CE` · `#3730A3` (violeta → púrpura → índigo) |
| `lesson_start` | `#0F172A` · `#1E1B4B` · `#0F172A` (azul noche) |
| `module_complete_good` | `#D97706` · `#EA580C` · `#E11D48` (ámbar → naranja → rosa) |
| `module_complete_low` | `#075985` · `#155E75` · `#1E293B` (azul → cian → pizarra) |
| `streak` | `#B91C1C` · `#EA580C` · `#F59E0B` (rojo → naranja → ámbar) |
| Clips cortos B | `#6C5CE7` → `#00D2D3` (los colores de la piel de Toñito en el código) |

## 5. Cómo pedirle a Flow cada cosa (celular y computador)

> **Los prompts ya vienen armados y listos para pegar:** [`TONITO_FLOW_PROMPTS.md`](TONITO_FLOW_PROMPTS.md) (los 13 clips y las 8 poses), o uno solo con
> `npm run flow:prompts -- A1 vertical` / `npm run flow:prompts -- P2`. `npm run flow:prompts -- --lista` muestra qué falta. La fuente es `src/lib/tonito/flowPrompts.ts`: si
> cambia un prompt, se cambia ahí y se regenera con `npm run flow:prompts -- --escribir`.

### Lo que enseñó el primer intento [medido]
Una primera versión de los prompts, **en inglés y con un bloque de identidad genérico** ("Amigurumi crochet 3D doll..."), produjo un personaje **distinto a Toñito** (rostro envejecido, cabello
gris) y con los pies al ~75 % de la altura. El prompt de la **celebración**, que sí salió perfecto, tiene cinco cosas que el otro no tenía; los prompts de ahora las copian todas:

1. **Empieza nombrando al personaje y a la imagen:** «Mismo personaje de la imagen de referencia: Toñito, ...».
2. **«No cambies su diseño ni su ropa en ningún momento.»**
3. **La acción por tiempos** (0 a 0,5 s: ...; 0,5 a 2,5 s: ...; 2,5 a 4 s: ...) que **termina en una pose estable**.
4. **Español y por secciones:** Acción, Encuadre, Fondo, Efectos, «Muy importante, evita».
5. **Nada que se contradiga:** sin suelo, sin entradas desde fuera del cuadro, sin anillos «en el suelo» (el tercio inferior es del texto de la escena).

Además, ahora la identidad describe el rostro («joven y redondo, de lana color durazno con mejillas rosadas, sin cabello gris ni arrugas»).
**Es un caso de éxito contra un fallo:** la causa exacta es una hipótesis. Por eso la regla es **generar UNA, compararla con la referencia y recién entonces hacer las demás**.
Una prueba (`flowPrompts.test.ts`) comprueba que el prompt de la celebración probado siga apareciendo **tal cual** dentro de lo que genera la herramienta.

### Celular y computador

Flow ofrece **dos proporciones: 9:16 (vertical) y 16:9 (horizontal)** **[verificar en Flow]**. Cada cinemática se genera **dos veces**, con la misma acción.

| | **Celular — vertical 9:16** | **Computador — horizontal 16:9** |
|---|---|---|
| Entrega | 720×1280 | 1280×720 |
| Toñito | ~55–60 % de la **altura**, dentro del 60 % central del ancho | ~60 % de la **altura**, **ancho ≤ 30 % del cuadro**, centrado |
| Pies | a la altura del 62 % del cuadro | a la altura del 67 % |
| Lados | no hay (el ancho es todo el cuadro) | **fondo amplio y vacío** a izquierda y derecha, del mismo degradado; **nada importante a menos del 20 % de los bordes** (por si el navegador recorta a 4:3) |
| Suelo | tercio inferior **completamente libre** (texto) | tercio inferior **libre** (texto) |

**Colores del fondo** (los de `CinematicScene.tsx`; el degradado va **en diagonal**, de arriba-izquierda a abajo-derecha). Flow no clava el hex exacto: **no importa**, porque al publicar se mide el clip
real (ver la [guía](TONITO_CINEMATICAS.md#fondo-a-juego-que-el-clip-no-se-distinga-de-los-lados-en-el-computador)).

| Escena | Estos colores (de arriba-izquierda a abajo-derecha) |
|---|---|
| `welcome` | violeta `#6D28D9` · púrpura `#7E22CE` · índigo `#3730A3` |
| `lesson_start` | azul noche `#0F172A` · índigo muy oscuro `#1E1B4B` · azul noche `#0F172A` |
| `module_complete_good` | ámbar `#D97706` · naranja `#EA580C` · rosa frambuesa `#E11D48` |
| `module_complete_low` | azul `#075985` · cian `#155E75` · pizarra `#1E293B` |
| `streak` | rojo `#B91C1C` · naranja `#EA580C` · ámbar `#F59E0B` |
| Clips cortos B | violeta azulado `#6C5CE7` → turquesa `#00D2D3` (los colores de la piel de Toñito en el código) |

## 6. Cinemáticas a pantalla completa (A1 a A5)

Duración **4 s**, con la acción por tiempos y terminando en una **pose estable** (la escena se queda ahí hasta que el estudiante pulsa «Continuar»). Prompts: `TONITO_FLOW_PROMPTS.md`.

| ID | Escena | Qué pasa | Celular | Computador |
|---|---|---|---|---|
| **A1** | `welcome` | Aparece con un salto enérgico, aterriza, saluda con una mano. Anillo de energía ciano alrededor de sus pies | ☐ | ☐ |
| **A2** | `lesson_start` | Se sube las gafas, se frota las manos, pequeño salto emocionado. Fondo muy oscuro (el texto blanco se lee mejor) | ☐ | ☐ |
| **A3** | `module_complete_good` | Salta de alegría con los brazos en alto; puños cerrados al final | ☑ | ☐ **(P1: completa el único clip que ya existe)** |
| **A4** | `module_complete_low` | Se ajusta las gafas, asiente, abre una mano en gesto de apoyo. **Nunca regaña ni dramatiza** | ☐ | ☐ |
| **A5** | `streak` | Puño en alto y salto de victoria; anillo de energía naranja y destellos tipo brasas (no fuego real) | ☐ | ☐ |

## 7. Clips cortos en bucle (B1 a B3): esperas y estados

Para ~100 px dentro de una **tarjeta con su propio fondo** (no hay transparencia). **Una sola proporción:** vertical 9:16 con Toñito dentro del cuadrado central (la tarjeta recorta al centro).
Duración **3 s**; entrega **360×640**, ≤ 150 KB **[propuesto]**. Fondo `#6C5CE7` → `#00D2D3`.

| ID | Cuándo se usa | Qué pasa |
|---|---|---|
| **B1** | La IA prepara las preguntas, refuerzo, chat | Bucle: mano en la barbilla, mira arriba y al lado, parpadeo lento. **Primer y último cuadro idénticos** |
| **B2** | No se pudo preparar la lección | Mirada baja y apenada, se encoge de hombros, vuelve a mirar con una sonrisa esperanzada. **Tierno, nunca dramático** (la falla es del sistema) |
| **B3** | Refuerzo completado | Puño cerrado y pequeño salto orgulloso |

Opcionales, hoy cubiertos por poses: **B4** durmiendo (inactividad 2 min, bucle) y **B5** sorpresa y saludo al volver (1,5 s).

## 8. Poses fijas P1–P8 (imágenes, no video)

Reemplazan a los 6 PNG viejos en el widget, el chat, los minijuegos y la lección. Se generan como **imagen** (Flow o Gemini).

**Lienzo único** para todas: 512×512, personaje centrado y **pies siempre en la misma línea** (si no, al cambiar de emoción "salta"). **Fondo plano magenta `#FF00FF`** (el verde choca
con el anillo ciano y con la bata blanca) para recortarlo después. **[Sin verificar]:** probar el recorte con una pose real; los recortes automáticos del fondo fallaron en la prueba de concepto
de los clips.

| ID | Estado | Prioridad | Pose |
|---|---|---|---|
| **P1** | `happy` (reposo) | **P0** | De pie, relajado, sonrisa tranquila, manos al frente |
| **P2** | `excited` (acierto) | **P0** | Alegre, brazos en alto, ojos muy abiertos, saltito |
| **P3** | `encouraging` (error, ánimo) | **P0** | Una mano extendida en gesto de apoyo, mirada cálida. **Nunca un gesto de reproche** |
| **P4** | `thinking` | **P0** | Mano en la barbilla, mirando hacia arriba |
| P5 | `sad` | P1 | Mirada baja, hombros caídos, suave y tierno, nada dramático |
| P6 | `surprised` | P1 | Ojos y boca muy abiertos, manos levantadas |
| P7 | `celebrating` (nueva) | P1 | Brazos en alto, boca abierta de alegría, destellos |
| P8 | `sleeping` (nueva) | P1 | Dormido de pie, ojos cerrados, burbuja de sueño |

## 9. Cómo revisar cada entrega (antes de publicar)

Además de los criterios de la [ficha §9](TONITO_FICHA_DE_ARTE.md):

- [ ] **Identidad:** casco, gafas, moño, bata, chaleco, pantalón y botas idénticos a la referencia.
- [ ] **Sin texto ni interfaz** en ningún cuadro (mira uno cada 0,2 s: el primer clip traía texto escondido desde el segundo 1,75).
- [ ] **Pies y suelo:** pies donde dice la tabla de §5; el tercio inferior vacío.
- [ ] **Horizontal:** Toñito ocupa ≤ 30 % del ancho; nada importante cerca de los bordes; los efectos se reparten a lo ancho.
- [ ] **Bucles (B):** el primer y el último cuadro son iguales; sin salto.
- [ ] **Termina en una pose estable** (las cinemáticas se quedan ahí).
- [ ] **Tono:** los fallos (A4, B2, P3, P5) **nunca regañan** ni dramatizan.
- [ ] **Sin audio** (si trae, se quita al convertir).
- [ ] Pasa `npm run clip:prepare` dentro de **400 KB** (poster ≤ 60 KB).

## 10. Cómo se publica cada cosa

1. **Clips:** `npm run clip:publish -- --video ./archivo.mp4 --scene <escena>` (con el formato horizontal, además `--orientation landscape` cuando esté construido §1.B).
   Los clips cortos B necesitan su escena/estado en el sistema (hoy solo existen las 5 cinemáticas).
2. **Poses:** se recortan, se unifica el lienzo y se cambian en `public/tonito/` (y `TonitoCharacter` pasa a usar el lienzo único, con respaldo al PNG actual).
3. Mientras algo no esté publicado, **la app sigue usando la animación antigua**: nada se rompe ni hay que esperar a tenerlo todo.

## 11. Decisiones abiertas

1. ¿Hacemos primero **A (arreglo de color)** y luego **B (clips horizontales)**, o directamente B?
2. ¿Quién **confirma la biblia del personaje** con la imagen de referencia? (Ver ficha §4: sale de un solo cuadro.)
3. ¿B4 y B5 (opcionales) se hacen como clip o se quedan en pose?
4. ¿Hay un tope de generaciones/créditos de Flow? Son **20 generaciones** mínimo, más repeticiones por las que salgan mal.
5. Ideas futuras que **hoy no tienen evento en el código** (solo si se quieren): logro desbloqueado, módulo nuevo desbloqueado en el mapa, racha de aciertos dentro de
   una lección ("¡3 seguidas!"), "te extrañé" tras muchos días sin entrar.
