# Toñito: ficha de arte

Documento de trabajo para producir y conectar el arte de Toñito (poses y clips) con Gemini y Google Flow. Sirve de contrato entre
**producto** (qué momentos necesita), **arte** (qué se genera) e **ingeniería** (cómo se carga y cuánto pesa).

> **Cómo leerlo.** Lo marcado **[medido]** salió del código o de los archivos del proyecto. Lo marcado **[propuesto]** es una
> decisión de diseño que se valida en la prueba de concepto. Lo marcado **[sin verificar]** es una suposición que hay que probar
> antes de apoyarse en ella.

## 1. Alcance

- **Decide:** qué estados y momentos de Toñito necesitan arte, en qué formato, con qué peso máximo y cómo se verifica una entrega.
- **No decide:** la historia del personaje, su voz, ni si habrá sincronía labial (ver el último paso de §10).
- **Qué NO se hace:** no se copian personajes, recursos ni código de otras apps. La referencia técnica de Duolingo es solo lo que
  ellos publicaron: personajes como máquinas de estados (un estado por pose, bocas aparte), no como videos pregrabados de cada
  reacción ([blog de Duolingo](https://blog.duolingo.com/world-character-visemes),
  [caso de Rive](https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life)).

## 2. Estado actual [medido]

**Arte.** 6 PNG con transparencia en `public/tonito/`, **820 KB en total**:

| Archivo | Tamaño (px) | Peso |
|---|---|---|
| `happy.png` | **367×325** | 147 KB |
| `excited.png` | 361×283 | 132 KB |
| `encouraging.png` | 361×283 | 134 KB |
| `thinking.png` | 361×283 | 134 KB |
| `sad.png` | 361×283 | 143 KB |
| `surprised.png` | 361×283 | 130 KB |

**Hallazgos.**
1. **Encuadres distintos:** `happy` mide 367×325 y las demás 361×283. Al cambiar de emoción, el personaje cambia de escala o de posición.
2. **Faltan dos poses y se reutilizan mal:** `celebrating` usa `excited.png`, y `sleeping` usa **`sad.png`** (Toñito se duerme con cara triste).
3. **`onStreak` no lo llama nadie.** Está en el store, pero la racha se celebra con la cinemática `streak`, no con el widget.
4. **Todo el movimiento es CSS** sobre una imagen fija: 8 animaciones simples y 12 de cinemática (`globals.css`).

**Lógica.** El store (`useTonitoStore`) ya es una máquina de estados correcta: 8 emociones (`mood`), 8 animaciones, mensajes y
reacciones de juego. **No hay que reescribirla; falta el arte y las transiciones.**

## 3. Eventos del producto → estado [medido]

Frecuencia estimada: **alta** = varias veces por lección; **media** = una vez por lección; **baja** = una vez por sesión o menos.

| # | Momento del producto | Dónde se dispara | Emoción / animación de hoy | Frecuencia |
|---|---|---|---|---|
| E1 | Respuesta correcta (lección, repaso, 8 minijuegos) | `onCorrectAnswer` | `excited` + `jump` | **alta** |
| E2 | Respuesta incorrecta | `onWrongAnswer` | `encouraging` + `shake` | **alta** |
| E3 | 3 o más fallos seguidos | `onConsecutiveFails` | `encouraging` + `shake`, mensaje compasivo | media |
| E4 | Espera a la IA: el chat responde o la lección prepara sus preguntas | `setMood('thinking')` | `thinking` | media |
| E5 | Llega la respuesta del chat o la lección queda lista («¡Listo! Vamos a aprender») | `setMood('happy')` | `happy` | media |
| E6 | Falla la IA: el chat da error (2,5 s) o **no se pudo preparar la lección** (queda triste hasta reintentar) | `setMood('sad')` | `sad` | baja |
| E7 | Empieza un refuerzo («reforcemos esto juntos») | `setMood('encouraging')` | `encouraging` | baja |
| E12 | Toca un módulo bloqueado en el mapa | `setMood('thinking')` | `thinking` | media |
| E8 | 2 min sin actividad | `setInactive(true)` | `sleeping` + `sleep` | baja |
| E9 | Vuelve el estudiante | `setInactive(false)` | `surprised` + `bounce`, luego `happy` | baja |
| E10 | Módulo completo, ≥ 70 % | `onModuleComplete` | `celebrating` + `supersaiyan` | media |
| E11 | Módulo completo, < 70 % | `onModuleComplete` | `thinking` (sin regañar) | media |
| C1 | Bienvenida (primera vez) | Cinemática `welcome` | `excited` + `enterEpic` | **baja** |
| C2 | Empieza una lección | Cinemática `lesson_start` | `excited` + `danceFull` | media |
| C3 | Módulo bueno | Cinemática `module_complete_good` | `celebrating` + `celebrationFull` + confeti | media |
| C4 | Módulo con puntaje bajo | Cinemática `module_complete_low` | `encouraging` + `reflection` (tono calmado) | media |
| C5 | Hito de racha (3, 5, 10…) | Cinemática `streak` | `celebrating` + `victoryJumpFull` + confeti | baja |

**Consecuencia de diseño.** E1 y E2 ocurren en **cada pregunta**: tienen que ser **poses fijas más animación en código**, livianas.
Los clips de video solo se justifican en las cinemáticas (C1 a C5), que son raras y a pantalla completa.

## 4. Biblia del personaje [propuesto]

Basada en **un solo cuadro de referencia** (480×270, 60 KB, sin transparencia): hay que confirmarla con quien creó el personaje.

- **Estilo:** muñeco tipo amigurumi (crochet) renderizado en 3D, con textura de lana visible, proporciones de cabeza grande.
- **Elementos fijos (nunca cambian entre poses ni clips):** casco de safari beige con banda; gafas redondas grandes de montura oscura;
  moño; bata blanca de laboratorio sobre chaleco marrón; pantalón escocés beige y marrón; botas marrones.
- **Puede variar:** expresión, pose, posición de brazos, efectos de energía (anillo ciano de energía a los pies en la referencia).
- **Fondo de la referencia:** azul aguamarina claro, plano. **No** forma parte del personaje.
- **Prohibido:** texto incrustado en la imagen, marcas de terceros, cambiar la ropa, expresiones que asusten o regañen.

## 5. Entregables de arte [propuesto]

### 5.1 Poses fijas (alta frecuencia: base de la experiencia)

Lienzo **único** para todas (512×512 px, personaje centrado, **pies siempre en la misma línea base**) para que cambiar de emoción no
"salte". Fondo transparente.

| ID | Pose | Estado | Prioridad | Nota |
|---|---|---|---|---|
| P1 | Reposo | `happy` | P0 | Base de todo; la más usada |
| P2 | Alegre / acierto | `excited` | P0 | E1 |
| P3 | Ánimo | `encouraging` | P0 | E2, E3, E7. Tono compasivo, **nunca** de reproche |
| P4 | Pensando | `thinking` | P0 | E4, E11, E12 |
| P5 | Triste suave | `sad` | P1 | E6. La falla es del sistema, no del estudiante: tono tierno, no dramático |
| P6 | Sorpresa | `surprised` | P1 | E9 |
| P7 | **Celebrando (nueva)** | `celebrating` | P1 | Hoy reutiliza `excited` |
| P8 | **Durmiendo (nueva)** | `sleeping` | P1 | Hoy reutiliza `sad` (error de arte) |

### 5.2 Clips (baja frecuencia: solo cinemáticas)

> **Actualización tras la [prueba de concepto](TONITO_PRUEBA_DE_CONCEPTO.md) [medido]:** los clips son **opacos**. Traen su
> **propio fondo**, generado con el color de la escena, y se reproducen como **H.264 en MP4** (un clip de 4 s pesó 214 KB, 19 veces menos
> que el GIF original). **No llevan transparencia**: dos recortes automáticos del fondo fallaron y el HEVC con alfa no se puede producir.

| ID | Clip | Escena | Tipo | Duración | Prioridad |
|---|---|---|---|---|---|
| V1 | Entrada épica | `welcome` | una vez, termina en P1 | 2–3 s | P1 |
| V2 | Celebración grande | `module_complete_good` | bucle | 2–3 s | P1 |
| V3 | Hito de racha | `streak` | bucle | 2–3 s | P2 |
| V4 | Baile de inicio | `lesson_start` | bucle | 2 s | P2 |
| V5 | Reflexión calmada | `module_complete_low` | bucle | 3 s | P2 |

Capa de efecto opcional: el **anillo de energía** de la referencia, como activo aparte (o CSS), para usarlo en E10 sin generar un clip.

## 6. Presupuesto de peso y rendimiento [propuesto, sin medir]

| Elemento | Meta | Hoy |
|---|---|---|
| Una pose | ≤ 60 KB (WebP con alfa, 512×512) | 130–147 KB (PNG) |
| 8 poses | ≤ 500 KB en total; se precargan solo P1, P2 y P3 | 820 KB (6 poses) |
| Un clip | ≤ 400 KB | no existe |
| Todos los clips | ≤ 2 MB; **carga perezosa** (solo al ir a mostrar la cinemática) | no existe |

- **Un solo clip a la vez**, y se pausa si sale de pantalla.
- **`prefers-reduced-motion`:** se muestra la pose fija, sin clip ni animación.
- **Respaldo:** si el clip no carga o el formato no se soporta, se usa la pose fija.
- **Dato real de referencia:** un **cuadro fijo** 480×270 pesa 60 KB. El peso de un clip de 3 s **no está medido**; la prueba de
  concepto lo midió: **214 KB en H.264 para 4 s** [medido, con un GIF; un MP4 original de Flow debería pesar menos].

## 7. Especificación de entrega [propuesto]

**Poses.** WebP con alfa (y PNG de respaldo), 512×512, mismo encuadre y línea de pies. Nombre: `public/tonito/{estado}.webp`.

**Clips (decidido en la prueba de concepto).** **MP4 con H.264, sin transparencia**, con su propio fondo del color de la escena
(`module_complete_good` hoy es ámbar/naranja, `welcome` violeta, `module_complete_low` azul, `streak` rojo/naranja). Resolución
de partida 480×270 (o proporción 16:9); un 75 % de resolución pesó 78 KB. Descartado: WebM con alfa y HEVC con alfa (§ del informe).
Los comandos exactos están en el informe.

**Requisitos que salieron de probar un MP4 original de Flow [medido]** (detalle en el [informe](TONITO_PRUEBA_DE_CONCEPTO.md#10-segundo-clip-el-mp4-original-de-flow)):
1. **Vertical 9:16, con Toñito centrado.** Un video 16:9 en un celular vertical, con `object-cover`, **solo muestra el ~26 % central del ancho**
   (390×844 px): se cortó la cara y el texto del clip de prueba. Los estudiantes usan sobre todo el celular.
2. **Sin texto, botones ni interfaz dibujados en el video.** La escena ya pone su diálogo, su puntaje y su botón «Continuar» (editables,
   traducibles y accesibles); un botón pintado en el video parece pulsable y no lo es.
3. **Fondo del color de la escena**, no blanco: el texto de las escenas es blanco y sobre un fondo blanco no se lee.
4. **Sin pista de audio** (Flow la genera; se quita al codificar). Cámara fija, Toñito sin salir del encuadre.

**Poses con transparencia.** Sí la necesitan. Al generarlas, usar un **fondo plano de un solo color** que el personaje no tenga
(propuesta: **magenta** `#FF00FF`; el verde choca con el anillo ciano de energía y con la bata blanca) y recortar **una sola vez por
imagen**, revisando el resultado a mano. **[Sin verificar]: probar con una pose real.**

Otros requisitos de los clips: 24 fps, **sin audio** (el sonido ya lo pone el código con `useSoundFx`), primer y último cuadro
iguales en los bucles, misma cámara fija y misma línea de pies que las poses.

## 8. Guía de prompts por estado [propuesto]

**Bloque base (siempre igual, pegado antes de cada variación).** Subir además la imagen de referencia como "ingrediente" en Flow,
o como imagen de entrada en Gemini, para sostener la identidad:

> Un muñeco amigurumi de crochet renderizado en 3D, textura de lana visible, cabeza grande. Lleva casco de safari beige con banda,
> gafas redondas grandes de montura oscura, moño, bata blanca de laboratorio sobre chaleco marrón, pantalón escocés beige y marrón,
> botas marrones. Encuadre completo de cuerpo, centrado, cámara fija, iluminación suave. Fondo plano de un solo color magenta.
> Sin texto, sin marcas, sin otros personajes. Expresión amable, apta para niños.

**Para los clips (V1 a V5)**, en el bloque base cambiar la línea del fondo por: «Fondo degradado suave de color {color de la escena},
sin elementos que compitan con el personaje». Los clips no llevan transparencia.

**Variaciones** (se añaden al bloque base):

| ID | Añadir |
|---|---|
| P1 | "De pie, relajado, sonrisa tranquila, manos al frente" |
| P2 | "Alegre, brazos arriba, ojos muy abiertos, saltando levemente" |
| P3 | "Gesto de ánimo: una mano hacia adelante, mirada cálida, sonrisa pequeña. Sin gesto de reproche" |
| P4 | "Una mano en la barbilla, mirando hacia arriba, ceja levantada" |
| P5 | "Mirada baja, hombros caídos, expresión suave y tierna, no dramática" |
| P6 | "Ojos y boca muy abiertos, manos levantadas por la sorpresa" |
| P7 | "Celebrando con ambos brazos en alto, boca abierta de alegría, destellos alrededor" |
| P8 | "Dormido de pie o sentado, ojos cerrados, respiración tranquila, burbuja de sueño" |
| V1 | "Entra desde el borde de la cámara con un salto épico y se detiene en pose de saludo; un anillo de energía ciano en el suelo" |
| V2 | "Salta de alegría con los brazos en alto, bucle suave" |
| V5 | "Se ajusta las gafas y asiente con calma, tono reflexivo y cálido" |

## 9. Criterios de aceptación (checklist por entrega)

- [ ] **Identidad:** casco, gafas, moño, bata y pantalón idénticos a la referencia.
- [ ] **Encuadre:** mismo lienzo, escala y línea de pies que P1.
- [ ] **Alfa limpio:** sin halo del color de fondo, bordes de la lana sin cortar.
- [ ] **Peso** dentro del presupuesto (§6).
- [ ] **Bucle** sin salto visible (solo clips).
- [ ] **Tono:** apto para niños; los fallos nunca regañan (E2, E3, E6, C4).
- [ ] **Sin texto** incrustado ni marcas.
- [ ] **Vertical 9:16** y Toñito **centrado** (visible con el recorte de un celular).
- [ ] **Sin botones ni interfaz** dibujados en el video.
- [ ] **Se ve bien a 72 px** (el widget flotante) y a 380 px (cinemática).

## 10. Plan de integración [propuesto]

1. **Ficha de arte** (este documento).
2. **Prueba de concepto técnica (hecha: [informe](TONITO_PRUEBA_DE_CONCEPTO.md)):** un reproductor de clips con **un** clip real, el procesado (transparencia, bucle, compresión) y
   la medición de peso y rendimiento en móvil. Con esos números se decide el formato de §7.
3. **Poses P1 a P8** y cambio de `TonitoCharacter` a un lienzo único, con respaldo al PNG actual.
4. **Clips** y su conexión a `CinematicScene`, con `prefers-reduced-motion` y respaldo a pose fija.
5. **Más adelante:** Rive solo si se necesita interacción fina, habla o labios. Exige rehacer a Toñito en capas vectoriales.

**Qué no cambia:** el store, los eventos y los mensajes. Cambia solo qué imagen o clip se muestra para cada estado.

## 11. Decisiones abiertas

1. ¿Quién confirma la biblia del personaje (§4)?
2. ¿Todo manual con el plan de Google del equipo, o hay un tope en USD para generar por API?
3. **Términos de uso comercial** de lo generado con Flow y Gemini para un producto escolar: confirmar antes de publicar.
4. ¿Se corrige `onStreak` (hoy sin uso) o se retira?
5. ¿Los archivos fuente pesados (videos originales) se guardan fuera del repositorio, que es público?
