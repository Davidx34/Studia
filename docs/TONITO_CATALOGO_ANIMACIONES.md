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

## 5. Celular y computador: cómo pedirle a Flow cada formato

> **Los prompts ya vienen armados y listos para pegar:** [`TONITO_FLOW_PROMPTS.md`](TONITO_FLOW_PROMPTS.md) (los 13 clips y las 8 poses), o uno solo con
> `npm run flow:prompts -- A1 vertical` / `npm run flow:prompts -- P2`. `npm run flow:prompts -- --lista` muestra qué falta. Los bloques de abajo explican **cómo
> están construidos** (`{IDENTIDAD}`, `{ORIENTACION}`, `{FONDO}`, `{REGLAS}` son marcadores del catálogo, no texto que haya que reemplazar a mano). La fuente es
> `src/lib/tonito/flowPrompts.ts`: si cambia un prompt, se cambia ahí y se regenera con `npm run flow:prompts -- --escribir`.

Flow ofrece **dos proporciones: 9:16 (vertical) y 16:9 (horizontal)** **[verificar en Flow]**. Cada cinemática se genera **dos veces**, con los mismos ingredientes y la
misma acción.

| | **Celular — vertical 9:16** | **Computador — horizontal 16:9** |
|---|---|---|
| Entrega | 720×1280 | 1280×720 |
| Toñito | ~55–60 % de la **altura**, centrado | ~60 % de la **altura**, **ancho ≤ 30 % del cuadro**, centrado |
| Pies | al 60–65 % de la altura | al 65–70 % de la altura |
| Lados | no hay (el ancho es todo el cuadro) | **mucho fondo libre a izquierda y derecha**, del mismo degradado; **nada importante a menos del 20 % de los bordes** (por si el navegador recorta a 4:3) |
| Suelo | 30 % inferior vacío (texto) | 25–30 % inferior vacío (texto) |
| Efectos (destellos, confeti) | dentro del encuadre, cerca de Toñito | pueden **repartirse a lo ancho**; es donde el horizontal se siente "pantalla completa" |

**Bloque de identidad (igual en todos los prompts, en inglés porque Flow responde mejor):**

```
Amigurumi crochet 3D doll character with a large head and visible yarn texture. He wears a beige safari pith helmet with a band, large round dark-framed
glasses, a bow tie, a white lab coat over a brown knitted vest, beige-and-brown tartan trousers and brown boots. Use the attached reference image for the exact
design; do not change the outfit or the face. Friendly, child-safe.
```

**Reglas que se pegan al final de TODOS los prompts de clip:**

```
Fixed camera, no cuts, no zoom, no camera movement. No text, no letters, no numbers, no buttons, no interface, no logos, no other characters. No audio, no
music, no speech. Smooth plain gradient background only: no objects, no horizon, no floor texture, no shadows on the background.
```

En cada prompt, **`{ORIENTACION}`** se reemplaza por una de estas dos líneas:

```
VERTICAL — Vertical 9:16 frame. The character is centered horizontally, about 55-60% of the frame height, with his feet at about 62% of the frame height. The
bottom 30% of the frame is empty background.
```
```
HORIZONTAL — Horizontal 16:9 frame. The character is centered, about 60% of the frame height and no wider than 30% of the frame width, with his feet at about 67%
of the frame height. Keep the left and right sides as wide empty background of the same gradient; nothing important within 20% of the left and right edges. The
bottom 28% of the frame is empty background.
```

Y **`{FONDO}`** por la línea de color de la escena, por ejemplo para la celebración:
`Background: smooth diagonal gradient from #D97706 (top-left) through #EA580C to #E11D48 (bottom-right).`

## 6. Cinemáticas a pantalla completa (A1 a A5)

Duración **4 s** cada una (2–6 s). Terminan en una **pose estable** (sonrisa tranquila) porque la escena se queda ahí hasta que el estudiante pulsa «Continuar».
Cada una: pegar **Identidad + {ORIENTACION} + {FONDO} + Acción + Reglas**.

### A1 · `welcome` — Entrada épica (primera vez que entra)
Estado: ☐ vertical · ☐ horizontal. Fondo: violeta → índigo.

```
{IDENTIDAD}
{ORIENTACION}
Background: smooth diagonal gradient from #6D28D9 (top-left) through #7E22CE to #3730A3 (bottom-right).
Action, 4 seconds: the character enters the frame with an energetic hop from just outside the frame, lands in the center with a small bounce, and finishes in a
friendly welcoming pose: one hand raised in a wave, a big warm smile. A soft cyan ring of energy glows briefly on the ground around his feet as he lands, then
fades. A few tiny golden sparkles float around him. He ends still in the welcoming pose.
{REGLAS}
```

### A2 · `lesson_start` — Inicio de lección (concentración y entusiasmo)
Estado: ☐ vertical · ☐ horizontal. Fondo: azul noche (oscuro: el texto blanco se lee mejor).

```
{IDENTIDAD}
{ORIENTACION}
Background: smooth diagonal gradient from #0F172A (top-left) through #1E1B4B to #0F172A (bottom-right), very dark night blue.
Action, 3 to 4 seconds: the character stands relaxed, pushes his glasses up with one finger with a confident smile, then rubs his hands together eagerly and gives
a small excited hop, ready to start. A few soft pale-blue sparkles drift upward behind him. He ends in a ready, smiling pose looking toward the viewer.
{REGLAS}
```

### A3 · `module_complete_good` — Celebración (≥ 70 %)
Estado: ☑ vertical (publicado) · ☐ **horizontal** (prioridad P1: completa el único clip que ya existe).

Vertical: ya hecho. **Horizontal**:

```
{IDENTIDAD}
{ORIENTACION — HORIZONTAL}
Background: smooth diagonal gradient from #D97706 (top-left) through #EA580C to #E11D48 (bottom-right).
Action, 4 seconds: the character jumps for joy with both arms raised high, lands, then jumps again with a happy spin, mouth open in a joyful smile. Golden stars
and soft warm sparkles burst and spread across the whole width of the frame. He lands in a stable proud pose with a big smile, and the sparkles slowly settle.
{REGLAS}
```

### A4 · `module_complete_low` — Reflexión cálida (< 70 %)
Estado: ☐ vertical · ☐ horizontal. Fondo: azul → pizarra. **Tono: nunca de reproche** (criterio de la ficha).

```
{IDENTIDAD}
{ORIENTACION}
Background: smooth diagonal gradient from #075985 (top-left) through #155E75 to #1E293B (bottom-right), calm blue.
Action, 4 seconds, calm and warm: the character adjusts his glasses thoughtfully, gives a slow, gentle nod, then opens one hand toward the viewer in an
encouraging, supportive gesture with a small kind smile. Very slow, soft movement. No sadness, no disappointment, no scolding. He ends in a calm, warm,
encouraging pose.
{REGLAS}
```

### A5 · `streak` — Hito de racha (3, 5, 10… días)
Estado: ☐ vertical · ☐ horizontal. Fondo: rojo → naranja → ámbar.

```
{IDENTIDAD}
{ORIENTACION}
Background: smooth diagonal gradient from #B91C1C (top-left) through #EA580C to #F59E0B (bottom-right), warm fiery colors.
Action, 4 seconds: the character raises one fist in triumph and does an energetic victory jump, a ring of warm orange energy pulses on the ground and soft glowing
ember-like sparkles rise around him (stylized and gentle, not real fire, nothing scary). He lands in a powerful, proud pose with a confident grin.
{REGLAS}
```

## 7. Clips cortos en bucle (B1 a B3): esperas y estados

Son para ~100 px dentro de una **tarjeta con su propio fondo** (no hay transparencia). **1 sola proporción**: **vertical 9:16 con Toñito dentro del cuadrado central**
(la tarjeta recorta al centro). Duración **2–3 s**, bucle. Entrega **360×640**, ≤ 150 KB **[propuesto]**. Fondo: `#6C5CE7` → `#00D2D3`.

Para **B** el bloque `{ORIENTACION}` es otro:

```
Vertical 9:16 frame. The character is centered and fills the central square of the frame (about 60% of the frame width), full body visible. Keep the top and
bottom of the frame as plain empty background.
```

### B1 · Pensando / esperando (la IA prepara las preguntas, refuerzo, chat)
Estado: ☐. Bucle.

```
{IDENTIDAD}
{ORIENTACION B}
Background: smooth diagonal gradient from #6C5CE7 (top-left) to #00D2D3 (bottom-right).
Action, 3 seconds seamless loop: the character stands thoughtfully with one hand on his chin, glances up and to the side, then back, with a slow gentle sway and a
slow blink. Calm and curious, no stress. The first and last frames are identical so the loop is seamless.
{REGLAS}
```

### B2 · Triste suave (no se pudo preparar la lección)
Estado: ☐. **La falla es del sistema, no del estudiante: tono tierno, no dramático.**

```
{IDENTIDAD}
{ORIENTACION B}
Background: smooth diagonal gradient from #6C5CE7 (top-left) to #00D2D3 (bottom-right).
Action, 3 seconds: the character lowers his gaze with a soft, tender, slightly apologetic expression, shrugs his shoulders gently, then looks up at the viewer with a
small hopeful smile as if saying "let's try again". Gentle and cute, never dramatic, no tears. He ends in a soft, hopeful pose.
{REGLAS}
```

### B3 · Refuerzo completado
Estado: ☐.

```
{IDENTIDAD}
{ORIENTACION B}
Background: smooth diagonal gradient from #6C5CE7 (top-left) to #00D2D3 (bottom-right).
Action, 3 seconds: the character gives a happy fist pump and a small proud hop, golden sparkles pop around him, and he ends in a satisfied, smiling pose.
{REGLAS}
```

### Opcionales
- **B4 · Durmiendo** (inactividad 2 min), bucle de 3 s: «the character sits or stands asleep with closed eyes, slow breathing, a soft sleep bubble that grows and shrinks».
  Hoy las poses P8 lo cubren; el clip es un lujo.
- **B5 · Sorpresa y saludo al volver**, 1,5 s: «eyes wide, a startled hop, then a happy wave». Lo cubre la pose P6.

## 8. Poses fijas P1–P8 (imágenes, no video)

Son las que reemplazan a los 6 PNG viejos en el widget, el chat, los minijuegos y la lección. Se generan como **imagen** (Flow o Gemini), no como video.

**Lienzo único** para todas: 512×512, personaje centrado y **pies siempre en la misma línea** (si no, al cambiar de emoción "salta").
**Fondo plano magenta `#FF00FF`** (el verde choca con el anillo ciano y con la bata blanca) para recortarlo después. **[Sin verificar]: probar el recorte con una
pose real**; los recortes automáticos del fondo fallaron en la prueba de concepto de los clips.

Prompt (se repite el bloque de identidad y solo cambia la última línea):

```
{IDENTIDAD}
Full body, centered, front view, soft even lighting, 1:1 square image, character about 80% of the image height with his feet on a fixed line near the bottom. Plain
flat solid magenta (#FF00FF) background with nothing else. No text, no logos, no shadows on the background. {POSE}
```

| ID | Estado | `{POSE}` |
|---|---|---|
| **P1** | `happy` (reposo) — **P0** | `Standing relaxed with a calm gentle smile, hands in front.` |
| **P2** | `excited` (acierto) — **P0** | `Joyful, both arms up, eyes wide, lightly leaping.` |
| **P3** | `encouraging` (error, ánimo) — **P0** | `One hand extended forward in a supportive gesture, warm gaze, small smile. Never a gesture of reproach.` |
| **P4** | `thinking` — **P0** | `One hand on his chin, looking up, one eyebrow raised.` |
| P5 | `sad` — P1 | `Eyes lowered, shoulders slightly slumped, soft tender expression, not dramatic.` |
| P6 | `surprised` — P1 | `Eyes and mouth wide open, hands raised in surprise.` |
| P7 | `celebrating` (nueva) — P1 | `Celebrating with both arms high, mouth open with joy, small sparkles around him.` |
| P8 | `sleeping` (nueva) — P1 | `Asleep standing, eyes closed, calm breathing, a small sleep bubble.` |

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
