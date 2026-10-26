# Cinemáticas de Toñito: cómo añadir una nueva

Esta guía es el flujo completo para que un video nuevo (por ejemplo de Flow) termine siendo la cinemática de una escena. Requisitos
del arte: `docs/TONITO_FICHA_DE_ARTE.md`. Dónde viven los archivos: `docs/TONITO_MEDIOS_Y_ALMACENAMIENTO.md`.

## Estado de partida

- Los clips se sirven por defecto desde el bucket público `tonito-media` **del mismo proyecto de Supabase de la app**. La URL se deduce de
  `NEXT_PUBLIC_SUPABASE_URL`: **no hay que configurar nada en Vercel**.
- Para usar otro bucket (Supabase o Cloudflare R2): `NEXT_PUBLIC_TONITO_MEDIA_BASE_URL=<https://…>` y redesplegar. Con el valor `local`
  se desactivan los clips remotos (se usa la carpeta `public/tonito`, que no tiene clips, y la cinemática usa la pose de siempre).
- Si un clip no se puede cargar o el dispositivo no lo permite (movimiento reducido, ahorro de datos, 2G, sin H.264, pantalla muy
  distinta de la del clip), la escena se ve **como siempre**, con la pose animada. El video nunca es imprescindible.

## Las 5 escenas

| Escena (`CinematicType`) | Cuándo sale | Clip |
|---|---|---|
| `welcome` | Primera vez del estudiante | — |
| `lesson_start` | Al empezar un módulo | — |
| `module_complete_good` | Módulo con buen puntaje | `celebracion` |
| `module_complete_low` | Módulo con puntaje bajo | — |
| `streak` | Racha | — |

## Pasos para una cinemática nueva

**1. Genera el video** siguiendo la ficha de arte: vertical 9:16, 2 a 6 s, sin texto en el video (el texto lo pone la app), sin audio y
con el fondo en el color de la escena (los colores están en `SCENES[...].bg` de `CinematicScene.tsx`).

**2. Conviértelo** (necesita `ffmpeg`; en Windows `winget install Gyan.FFmpeg`, o pon su ruta en `FFMPEG_PATH`):

```bash
npm run clip:prepare -- --video ./mi-video.mp4 --id exito-total --scene streak
```

El script convierte a H.264 sin audio con la mejor calidad que entre en **400 KB**, saca el poster (**≤ 60 KB**), deja ambos en
`clips-out/` (ignorada por git) y te imprime las dos líneas de código que hay que pegar. Si el `id` ya existe en el registro, prepara la
versión siguiente (`.v2`): los archivos son inmutables y nunca se sobrescriben. Opciones: `--poster-at <segundos>`, `--loop`.

**3. Revisa** `clips-out/<id>.v1.jpg` y el MP4: el script comprueba las reglas técnicas, no si se ve bien.

**4. Súbelo** (con tu `.env.local`, que tiene la clave de servicio; nunca se imprime):

```bash
npm run clip:prepare -- --video ./mi-video.mp4 --id exito-total --scene streak --upload
# o, si ya lo preparaste:
npm run media:upload -- --file clips-out/exito-total.v1.mp4 --path clips/exito-total.v1.mp4 --file clips-out/exito-total.v1.jpg --path clips/exito-total.v1.jpg
npm run media:check -- --probe clips/exito-total.v1.mp4
```

**5. Regístralo** pegando lo que imprimió el script:
- en `src/lib/tonito/clips.ts`, dentro de `TONITO_CLIPS`;
- en `src/components/cinematics/CinematicScene.tsx`, `clipId: '<id>'` dentro de la escena que corresponda.

**6. Míralo** en el panel de desarrollo: `/dev/cinematicas` lista las escenas, dice cuál usa video y las reproduce con datos de ejemplo.
Pruébalo también en un celular real (iPhone y Android: **sigue sin verificarse**).

**7. PR** como siempre. Los videos originales pesados no se suben al repositorio (es público): solo el clip final va al bucket.

## Qué te protege

- Pruebas: cada clip registrado debe tener id válido, rutas versionadas y estar bajo su propia clave (`clipPipeline.test.ts`).
- `media:upload` rechaza lo que no cumpla nombre, peso, tipo real del archivo y `faststart` **antes** de subir nada.
- Un clip con `clipId` sin registrar, o con archivos que no existen, no rompe la escena: cae a la pose. Pero `/dev/cinematicas` lo marca.

## Para quitar un clip

Quita su `clipId` de la escena (y, si quieres, su entrada del registro) y despliega. El archivo del bucket puede quedarse: no estorba.
Borrarlo tarda unos minutos en dejar de servirse desde el CDN.
