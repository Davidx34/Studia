# Toñito: prueba de concepto de clips de video

Resultados de la prueba técnica descrita en el paso 2 de la [ficha de arte](TONITO_FICHA_DE_ARTE.md): ¿cuánto pesa un clip real
de Toñito, en qué formato conviene, y se puede quitar el fondo sin pantalla verde?

> **Cómo leerlo.** **[medido]** salió de un archivo o de una prueba. **[sin verificar]** es una suposición que falta probar.
> Todas las pruebas de pesos y recorte usan **un solo clip** (ver §1): son una guía, no una garantía para los demás clips.

## 1. Resumen y decisión

1. **El peso es viable.** El clip de referencia pesaba **4,0 MB** (GIF) y queda en **214 KB** en H.264, **19 veces menos**, dentro del
   presupuesto de 400 KB por clip. **[medido]**
2. **Quitar el fondo automáticamente NO funcionó.** Dos métodos distintos dejaron un recorte que no sirve para producción (§4). **[medido]**
3. **El canal alfa en sí es barato** (+1 % a +2 % de peso con una silueta limpia): el problema no es el peso, es conseguir un recorte
   limpio. **[medido]**
4. **Decisión [propuesto]:** los clips **no llevan transparencia**. Son para las **cinemáticas a pantalla completa**, así que traen su
   **propio fondo**, generado con el color de la escena, y se reproducen como un **H.264 normal en MP4**, que funciona en todos los
   dispositivos. El personaje que acompaña al estudiante dentro de la interfaz sigue siendo una **pose fija con transparencia**.

   Esto elimina del plan el video con transparencia (WebM con alfa, HEVC con alfa), que era la parte más frágil.

## 2. Qué se midió y con qué

- **Fuente:** `Profesor_Toñito_powers_up_celebr…_20261011071809 (1).gif`, **480×270, 64 cuadros, 4,0 s, ~16 fps, 4.032 KB**, bucle
  infinito. Es una secuencia de «power-up»: arranca en posición de combate, salta y termina celebrando con estrellas doradas y rayas de
  energía que ocupan **todo el cuadro**.
- **Limitación importante:** un GIF solo tiene 256 colores y usa **tramado** (ruido) para simularlos. Eso infla el peso al recodificar y
  ensucia cualquier recorte. **Un MP4 original de Flow se comprimirá mejor y se recortará mejor que este GIF**; los pesos de abajo son
  probablemente un **techo**, no un promedio. **[sin verificar: falta probar con el MP4 original]**
- **Herramientas:** `ffmpeg` 6.1 (H.264, H.265, VP9, AV1) y `sharp` 0.35, en una carpeta temporal fuera del proyecto.

## 3. Peso por formato (sin transparencia) [medido]

| Formato | Peso | vs GIF | KB por segundo | ¿≤ 400 KB? |
|---|---|---|---|---|
| **GIF original** | 4.032 KB | 1× | 1.008 | no |
| **H.264 crf 30** | **214 KB** | **19×** | 53 | **sí** |
| AV1 crf 36 | 192 KB | 21× | 48 | sí |
| H.264 crf 26 | 766 KB | 5× | 191 | no |
| VP9 crf 34 | 975 KB | 4× | 244 | no |
| VP9 crf 40 | 466 KB | 9× | 116 | no |
| WebP animado q 70 | 1.878 KB | 2× | 469 | no |
| WebP animado q 50 | 1.372 KB | 3× | 343 | no |
| VP9 crf 34 al 75 % de resolución | 196 KB | 21× | 49 | sí |
| H.264 crf 30 al 75 % de resolución | 78 KB | 52× | 20 | sí |

- **Ganador: H.264 en MP4.** Pesa casi lo mismo que AV1, pero **se reproduce en todos los dispositivos** (AV1 en iPhone solo en chips
  recientes **[sin verificar]**). WebP animado es de 6 a 9 veces más pesado: queda descartado para clips largos.
- Con 5 clips de ~4 s, el total sería **≈ 1 MB** (el presupuesto era 2 MB).

**Calidad.** El PSNR sale ≈ 20–21 dB en **todos** los formatos, incluso H.264 de alta calidad, y **no sirve para comparar aquí**: lo que
mide es el ruido de tramado del GIF, que ningún códec reproduce (y no conviene reproducir). Comparado a ojo con un recorte ampliado
3×, **H.264 y AV1 salen más suaves que el GIF**, con las estrellas y las rayas de energía bien reconocibles; VP9 conserva algo más de
detalle. A tamaño de pantalla de móvil la suavidad es aceptable. **[medido a ojo, un solo cuadro]**

## 4. Transparencia

### 4.1 Recorte automático del fondo [medido]: no sirve

El fondo del clip es un **degradado azul pálido de estudio**, no un color plano. Se probaron dos métodos, sin modelos de IA:

| Intento | Cómo | Resultado |
|---|---|---|
| 1 | Superficie cuadrática ajustada al fondo; transparencia por distancia de color | Fondo solo parcialmente quitado, **motas por el tramado**, y la **bata blanca queda semitransparente con manchas** (su blanco sombreado se parece al azul del fondo) |
| 2 | Fondo tomado de los propios cuadros (moda temporal), suavizado, relleno de huecos, limpieza de motas | La bata queda sólida y los bordes mejoran, pero **queda una mancha azul claro detrás del personaje**: como siempre está en el centro, nunca se ve el fondo limpio allí |

**Causas, y no se arreglan con más ajustes:** (1) el degradado y el ruido de tramado, (2) el personaje ocupa siempre el centro, (3) los
efectos de energía blancos y cian son casi del color del fondo, (4) la bata blanca. Un modelo de recorte con IA podría resolverlo, pero
cuadro a cuadro tiende a **parpadear** y necesita modelos y GPU. **[sin verificar]**

### 4.2 El canal alfa en sí [medido]: barato

Con una **silueta limpia** sintética (elipse suave), VP9 con alfa pesa solo **+1 %** (máscara fija) y **+2 %** (silueta en movimiento)
más que sin alfa. Los pesos que dio el recorte automático (3,4 y 7,2 MB) son un **artefacto del recorte sucio**, no del alfa. Un
recorte limpio además eliminaría píxeles de fondo, lo que podría **reducir** el peso **[sin medir]**.

### 4.3 HEVC con alfa (Safari)

**No se puede producir aquí:** `x265` no codifica alfa; solo el codificador de hardware de Apple lo hace. Es la opción de la ficha que
queda descartada por herramientas.

### 4.4 Conclusión

La transparencia por video exige **un recorte limpio en origen**: generar sobre un fondo plano de un color que el personaje no tenga, o
usar IA de recorte. Es costoso y frágil, y **no hace falta** si los clips son de pantalla completa con su propio fondo (§1, punto 4).

## 5. Prueba en un navegador real [medido, con límites]

Se reprodujo el MP4 de 214 KB en el navegador integrado (Chromium), servido con soporte de rangos como lo haría un CDN:

| Medida | Resultado |
|---|---|
| Soporte declarado | H.264, AV1 y VP9: «probably» |
| Autoplay con el video en silencio | permitido |
| Cuadros reproducidos / perdidos | **64 / 1** |
| Duración real | 4,06 s (el clip dura 4,00 s) |
| Bytes transferidos | **219.071** (214 KB + cabeceras) |
| Carga hasta poder reproducir | 56 ms (en `localhost`) |

**Límites:** es un navegador de **escritorio**, en `localhost`, sin latencia de red. **No se probó en iPhone ni en Android**, ni consumo
de batería o CPU. Eso sigue siendo **[sin verificar]** y es lo primero que conviene probar con un móvil real.

## 6. Hallazgo lateral

El middleware redirige a `/login` **incluso los archivos estáticos** (`/manifest.json`, `/icons/*`, `/tonito/*`) cuando no hay sesión,
**también en producción**. No afecta a las cinemáticas (se ven con sesión iniciada), pero puede impedir instalar la PWA desde la pantalla
de acceso **[sin verificar en un navegador real]**. Se dejó como tarea aparte.

## 7. Qué se construyó

| Pieza | Para qué |
|---|---|
| `src/lib/tonito/clips.ts` | Registro de clips (**vacío a propósito**) y reglas puras para decidir si se carga el video |
| `src/components/tonito/TonitoClip.tsx` | Reproductor: decorativo, en silencio, con poster debajo, se pausa si la pestaña se oculta o sale de pantalla, y avisa si falla |
| `CinematicScene` | Usa el clip **solo si** hay uno registrado, el dispositivo lo permite y no falló; si no, **exactamente lo de siempre** |

**No hay ningún clip publicado todavía:** el registro está vacío y las cinemáticas se comportan igual que antes. Se carga el video solo
cuando **no** hay: movimiento reducido, ahorro de datos, conexión 2G, falta de soporte H.264, o un fallo de carga o reproducción.

**Guardas que vigilan el futuro** (hoy se cumplen en vacío): cada clip registrado debe existir en `public/tonito/clips/`, no puede haber
MP4 sin registrar, y se respetan los topes de la ficha (clip ≤ 400 KB, poster ≤ 60 KB, todos ≤ 2 MB).

## 8. Cómo añadir un clip (cuando se apruebe)

```bash
# 1. Video: H.264, sin audio, 480 px de ancho (o la resolución que se acuerde), compatible con todos los dispositivos
ffmpeg -i original.mp4 -vf "scale=480:-2" -an -c:v libx264 -preset slow -crf 30 -profile:v main -pix_fmt yuv420p -movflags +faststart celebracion.mp4

# 2. Poster: un cuadro representativo
ffmpeg -ss 1.5 -i celebracion.mp4 -frames:v 1 -q:v 5 celebracion.jpg
```

3. Copiar ambos a `public/tonito/clips/`.
4. Registrarlo en `TONITO_CLIPS` (`src/lib/tonito/clips.ts`) con su `id`, `src`, `poster`, tamaño y `loop`.
5. La escena `module_complete_good` ya apunta al `id` `celebracion`.

Los archivos fuente pesados (videos originales) **no** deben subirse al repositorio, que es público.

## 9. Próximos pasos y decisiones

1. **Probar en un móvil real** (iPhone y Android): reproducción, batería y fluidez.
2. **Un MP4 original de Flow** (no el GIF): mejor peso y mejor calidad. Confirmar si Flow lo permite en el plan del equipo.
3. **¿Se aprueba publicar `celebracion`?** Requiere confirmar los **términos de uso comercial** de Flow/Gemini (pendiente de la ficha).
4. **Color de fondo por escena.** Para cada clip hay que pedir a Flow un fondo del color de su escena (hoy: ámbar/naranja para
   `module_complete_good`, violeta para `welcome`, etc.). El clip de prueba trae fondo azul: habría que **regenerarlo** o cambiar el
   color de la escena a juego.
5. **Poses con transparencia** (P1–P8): sí necesitan fondo transparente, pero es un trabajo **de una sola vez por imagen** y revisable a
   mano, no un recorte cuadro a cuadro como el de un clip.

## 10. Segundo clip: el MP4 original de Flow

Se probó `Character_jumping_and_celebratin…_20261024140246.mp4` (el original que se pidió, en lugar del GIF).

**Qué es [medido]:** H.264 (High), **1280×720, 24 fps, 4,01 s**, 2.811 kb/s de video más una pista de **audio AAC** estéreo; **1,44 MB**.
Toñito sobre un **fondo blanco liso** salta y celebra con estrellas doradas.

**Peso codificado, sin audio, H.264 con `faststart` [medido]:**

| Versión | Peso |
|---|---|
| 480 px de ancho, crf 30 | **82 KB** |
| 480 px, crf 26 | 129 KB |
| 640 px, crf 30 | 120 KB |
| 640 px, crf 26 | **189 KB** |
| Solo los primeros 1,4 s, 480 px, crf 30 | 34 KB |

A 480 px, 4 s pesan 82 KB frente a los 214 KB del clip anterior (el GIF), pero **no son comparables**: son clips distintos, con otro
movimiento y un **fondo blanco liso sin tramado**, que se comprime mucho mejor. Un clip regenerado con fondo de color y degradado pesará
**más** que este. Aun así hay **holgura** frente al tope de 400 KB: se puede subir la resolución o la calidad. **[Dato de un solo clip.]**

**Por qué este clip NO se puede publicar tal cual [medido]:**

1. **Trae texto y un botón dibujados**: «¡Buen trabajo! ¡Pulsa el botón para continuar!» y un botón naranja de *play*. El botón empieza a
   crecer en 1,5 s y el texto aparece desde **1,75 s**, así que solo el tramo **0 a ~1,4 s** está limpio. La escena ya pone su propio diálogo y
   su botón «Continuar»: habría dos textos distintos y un botón que parece pulsable y no lo es.
2. **Es horizontal (16:9)**. En un celular de 390×844 con `object-cover` solo se ve el **26 % central del ancho**: se corta la cara en un
   cuadro y en otro quedan a medias Toñito, el texto y el botón.
3. **Fondo blanco**: el texto de las escenas es blanco y no se leería. Un fondo blanco liso tampoco permite recortar a Toñito, porque su
   bata es blanca (mismo problema del §4).

**Qué sí sirve:** la calidad del personaje y del movimiento, y las cifras de peso para un clip regenerado. **Qué hay que regenerar:** vertical
9:16 con Toñito centrado, **sin texto ni botones**, con un fondo degradado del color de la escena y sin pista de audio (ver la ficha de arte, §7).

## 11. Tercer clip (vertical, sin texto) y verificación en pantalla real

Se probó `Amigurumi_doll_jumping_for_joy_20261024141554.mp4`, generado con el prompt de la ficha.

**Cumple el pedido [medido]:** vertical **720×1280 (9:16)**, 24 fps, 4,01 s; **sin texto, botones ni íconos** en los 20 cuadros revisados (uno
cada 0,2 s); cámara fija, sin cortes; Toñito centrado y siempre dentro del encuadre; **termina en una pose estable**. Trae audio (se quita al codificar).

**No cumple del todo:** los **pies quedan al ~80 % de la altura**, donde va el texto de la escena (la primera línea cae sobre las botas; se lee bien
sobre el velo, pero está recargado). Y el degradado es **más pálido** que el pedido: arriba `#EEBC73` (pedido `#D97706`), centro `#E7A96C`
(`#EA580C`), abajo `#CC535D` (`#E11D48`). El texto blanco **solo** sobre ese fondo daría 1,7 a 4,2:1 de contraste; sobre el velo oscuro de la escena
se lee bien a simple vista (**no medido numéricamente con el velo real**).

**Codificado, sin audio, H.264 `faststart` [medido]:** 360×640 crf 28: 130 KB · 432×768 crf 28: 169 KB · 540×960 crf 28: 237 KB · **720×1280 crf 30: 303 KB**
(elegido: resolución nativa; a 3× de ampliación es el más parecido al original). Póster = primer cuadro, JPEG de **44 KB**. Ambos pasan
`media:upload --dry-run`. **Candidato listo; no se ha subido** (falta el visto bueno y los términos de uso comercial).

### Verificación con el componente real en un navegador (Chromium emulando un celular de 390×844) [medido]

Se hizo con una página y un registro **temporales** (ya revertidos). Encontró **dos errores de mi integración del PR #123**, que las pruebas de marcado
no podían ver:

1. **El video no cubría la pantalla** (`position: relative`, 612 px = **73 %** de la altura) y **tapaba el botón «Saltar ✕»**: el contenedor llevaba
   `relative` fijo y, sumado el `absolute` de la escena, en Tailwind gana `relative`; además lo posicionado se pinta encima de lo que no lo está.
   **Arreglo:** el reproductor deja de imponer su posición (la decide quien lo usa) y «Saltar», el texto y el botón llevan `z-20`/`z-10`.
2. **Un clip vertical en una pantalla horizontal muestra solo una franja** (1280×720: torso y puños, **sin cabeza**). **Arreglo:** el clip solo se usa
   si se ve al menos el **70 %** de su proporción (`visibleFraction`); celulares (82 %, 80 %, 100 %) e iPad vertical (75 %) sí; pantalla cuadrada (56 %),
   iPad horizontal (42 %) y computadores (32 %) usan la pose de siempre.

**Tras el arreglo:** en vertical, el video mide 390×844 (cubre), termina en 4,00 s, y «Saltar», «Continuar» y las 3 líneas están encima; en horizontal no
se carga video y se ve la pose de siempre. **No verificado:** iPhone y Android reales, batería, red lenta, `prefers-reduced-motion` en el navegador (solo
con pruebas unitarias) y el respaldo cuando el archivo no existe (solo con pruebas unitarias).
