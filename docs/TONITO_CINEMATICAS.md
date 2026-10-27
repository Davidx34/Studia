# Cinemáticas de Toñito: cómo agregar una

**Resumen:** tienes un video → un comando → la cinemática aparece en la app en pocos minutos. Sin PR y sin redesplegar.

## Las 5 escenas

| Escena | Cuándo sale |
|---|---|
| `welcome` | La primera vez que el estudiante entra al dashboard |
| `lesson_start` | Al empezar un módulo |
| `module_complete_good` | Al terminar un módulo con buen puntaje |
| `module_complete_low` | Al terminar un módulo con puntaje bajo |
| `streak` | Racha |

Cada escena tiene **un** clip a la vez. Publicar uno nuevo en la misma escena reemplaza al anterior.

## Agregar o cambiar una cinemática (3 pasos)

**1. Prepara el video.** Vertical 9:16, de 2 a 6 segundos, sin texto dentro del video (el texto lo pone la app), sin audio y con el fondo
del color de la escena. Más detalle del arte: `docs/TONITO_FICHA_DE_ARTE.md`.

**2. Publícalo con un comando:**

```bash
npm run clip:publish -- --video ./mi-video.mp4 --scene welcome
```

El comando hace todo solo: lo convierte (H.264, sin audio, hasta 400 KB), saca el poster, lo sube al bucket, comprueba que se sirve bien
y recién entonces apunta la escena al clip nuevo. Si algo falla antes de ese último paso, **no cambia nada** en la app.

**3. Míralo.** En `/dev/cinematicas` (panel de desarrollo) ves qué usa cada escena y puedes reproducirla. Para verlo en el celular, entra
con una cuenta de estudiante y provoca la escena. Los estudiantes lo reciben en unos 5 minutos (cache); quien ya tenía la app abierta lo
ve al recargar.

## Otros comandos

| Quiero… | Comando |
|---|---|
| Ver qué usa cada escena ahora | `npm run clip:list` |
| Apagar el clip de una escena (vuelve a la pose animada) | `npm run clip:off -- --scene welcome` |
| Encenderlo otra vez | `npm run clip:on -- --scene welcome` |
| Solo convertir, sin publicar (revisar el resultado) | `npm run clip:prepare -- --video ./x.mp4 --id nombre` |

Opciones de `clip:publish`: `--poster-at <segundos>` (qué cuadro es el poster), `--loop` (repetir el video), `--id <nombre>` (nombre
del clip; por defecto sale de la escena).

## Qué necesitas en tu máquina (una sola vez)

- **ffmpeg**: en Windows, `winget install Gyan.FFmpeg`. Si lo tienes en otra ruta, ponla en la variable `FFMPEG_PATH`.
- **`.env.local`** con `SUPABASE_SERVICE_ROLE_KEY` (ya la tienes; el comando nunca la imprime).
- **La migración 073** aplicada (crea la tabla `tonito_scene_clips`).

## Qué te protege

- **Nunca queda una escena rota.** Si la base no responde, la tabla no existe o la fila es inválida, la escena usa el respaldo (el clip que
  trae el código, si hay, o la pose animada de siempre). El estudiante, como mucho, ve un fondo de color 1,2 s mientras la app lo averigua.
- **Se comprueba antes de publicar:** nombre versionado, peso, tipo real del archivo y que el bucket lo sirva con caché y rangos.
- **Los archivos no se sobrescriben.** Un video nuevo para la misma escena crea `…v2.mp4`; los viejos quedan en el bucket y se pueden reponer.
- **Interruptor inmediato:** `clip:off` apaga una escena sin tocar código.
- El video **no se usa** (se ve la pose) con movimiento reducido ("Mostrar animaciones" desactivado en el sistema), ahorro de datos, 2G o sin
  soporte H.264. Es a propósito.
- **La forma de la pantalla ya no lo descarta.** En un celular el clip llena la pantalla; en una pantalla ancha (computador) se muestra **entero,
  centrado y a toda la altura**, con los bordes difuminados contra el color de la escena. Antes, un clip vertical en un computador caía a la pose,
  y quien probaba en un computador creía que la animación "no cargaba".

## Dónde vive cada cosa

- **Qué clip usa cada escena:** tabla `tonito_scene_clips` en Supabase (una fila por escena). Lectura pública, escritura solo con la clave de servicio.
- **Los archivos:** bucket público `tonito-media` del mismo proyecto de Supabase (`docs/TONITO_MEDIOS_Y_ALMACENAMIENTO.md`).
- **Respaldo en el código:** `SCENE_DEFAULT_CLIP` en `src/lib/tonito/scenes.ts` (hoy, `celebracion` para `module_complete_good`) y su
  definición en `TONITO_CLIPS` (`src/lib/tonito/clips.ts`). Solo se usa si la base falla o no tiene fila.

## Agregar una escena nueva (no un clip)

Eso sí es código: se añade a `CINEMATIC_TYPES` (`src/lib/tonito/scenes.ts`) y a `SCENES` (`CinematicScene.tsx`) con sus textos y colores,
y se dispara desde donde corresponda. Después sus clips se publican con el mismo comando.

## Fondo a juego: que el clip no se distinga de los lados en el computador

Un clip vertical en una pantalla ancha se muestra **entero y centrado**. Flow no clava el color de fondo que se le pide (el clip de celebración salió más pálido: arriba
`#EDBB74` en vez de `#D97706`), así que la columna se distinguía de los lados. Ahora **se mide el clip** y la escena pinta de fondo lo que el clip trae en sus bordes.

- **Al publicar** (`npm run clip:publish`) se miden 6 colores del primer cuadro: borde izquierdo y borde derecho, cada uno arriba, medio y abajo (el fondo suele ser un degradado
  diagonal, por eso son dos lados), y se guardan en `tonito_scene_clips.bg_colors`. Se necesita ffmpeg, igual que para convertir.
- **Para un clip ya publicado:** `npm run clip:colors -- --scene <escena>` los mide y los muestra; con `--aplicar` los guarda.
- La escena usa esos colores solo cuando el clip está activo. Sin colores (clips anteriores, o la migración 074 sin aplicar) usa su degradado de siempre: **nada se rompe**.
- Los colores se validan (6 valores `#rrggbb` en minúsculas) en la base y en la app: nunca se pinta CSS suelto.
- En el celular el clip llena la pantalla y el fondo no se ve; la mejora es para el computador.
