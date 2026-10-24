# Medios de Toñito: dónde viven y cómo cambiar de proveedor

Guía del proceso para servir los clips y posters de Toñito desde un **bucket público de Supabase** o desde **Cloudflare R2**,
sin atar el código a ninguno. Complementa la [ficha de arte](TONITO_FICHA_DE_ARTE.md) y la
[prueba de concepto](TONITO_PRUEBA_DE_CONCEPTO.md).

> **Cómo leerlo.** **[medido]** salió del código o de la base. **[documentación]** es lo que dice el proveedor o mi conocimiento de su
> producto y se **confirma al ejecutar el paso**. **[sin verificar]** es una suposición.

## 1. Cómo funciona

La app pide cada archivo por una **ruta relativa** (`clips/celebracion.v1.mp4`). `mediaUrl()` (`src/lib/tonito/media.ts`) la convierte en
URL con una **base** que sale de la variable `NEXT_PUBLIC_TONITO_MEDIA_BASE_URL`:

| Valor de la variable | Dónde se sirve | URL resultante |
|---|---|---|
| *(sin definir)* | Carpeta `public/tonito/` del repo (Vercel) | `/tonito/clips/celebracion.v1.mp4` |
| `https://<ref>.supabase.co/storage/v1/object/public/tonito-media` | Supabase Storage | `…/tonito-media/clips/celebracion.v1.mp4` |
| `https://media.<tu-dominio>` o `https://pub-xxxx.r2.dev` | Cloudflare R2 | `https://media.<tu-dominio>/clips/celebracion.v1.mp4` |

**Cambiar de proveedor = cambiar esa variable en Vercel y volver a desplegar** (Next la inserta al compilar). Una base mal escrita
(http, sin https, con credenciales o parámetros) **se ignora** y se usa la local: nunca deja a las cinemáticas sin archivos.

**Reglas que no se rompen:**
1. **Archivos inmutables con versión en el nombre** (`celebracion.v1.mp4`, `celebracion.v2.mp4`). **Nunca se sobrescribe.** El service
   worker guarda las **imágenes** de cualquier origen 7 días (`CacheFirst`) y el CDN cachea mucho: sobrescribir serviría la versión vieja.
2. Se suben con `Cache-Control: public, max-age=31536000, immutable`.
3. **Solo activos de marca** en buckets públicos: cualquiera con la URL puede descargarlos. Nada de datos de estudiantes ni de profesores.
4. Las claves van en `.env.local` y en Vercel. **Nunca se pegan en el chat.**

## 2. Lo que ya hay en el proyecto [medido]

- **Supabase Storage** es el único almacenamiento de objetos. Dos buckets **privados**: `teaching-materials` (14 archivos, 3,7 MB) y
  `class-media` (0 archivos). Ambos con tope de 10 MB y URLs firmadas de 1 hora: sirven para materiales de profesores, **no** para activos
  de marca.
- **No hay CSP** que bloquee medios de otro dominio: `<img>` y `<video>` cargan desde Supabase o R2 sin tocar seguridad.
- `next.config.js` ya permite `**.supabase.co` para `next/image`. Para R2 hace falta añadir su host **solo si** se usara `next/image`;
  el reproductor usa `<img>` y `<video>` normales.
- El service worker **no** intercepta video (no hay regla para `destination === 'video'`): lo cachea el navegador según `Cache-Control`.
- Los 6 PNG actuales de Toñito viven en `public/tonito/` (820 KB) y **hoy redirigen a `/login` sin sesión** (hallazgo del middleware,
  tarea aparte).

## 3. Comparación

| | **Supabase Storage (bucket público)** | **Cloudflare R2** |
|---|---|---|
| Cuenta nueva | No: ya existe el proyecto | Sí: R2 en tu cuenta de Cloudflare (**¿pide tarjeta para activarlo?** [sin verificar]) |
| URL pública lista | Sí, al crear el bucket público | `r2.dev` (pruebas) o **dominio propio en Cloudflare** |
| CDN | Incluido: todo lo subido se cachea en CDN ([docs](https://supabase.com/docs/guides/storage-cdn)) | Con dominio propio, la caché de Cloudflare |
| Cuota gratuita de salida | **5 GB cacheados + 5 GB sin cachear** al mes; el exceso cacheado cuesta 0,03 USD/GB ([anuncio oficial](https://supabase.com/blog/storage-500gb-uploads-cheaper-egress-pricing); confirmar en la página de precios) | **Salida gratis**; 10 GB de almacenamiento, 1 M de operaciones de escritura y 10 M de lectura al mes (fuentes secundarias, p. ej. [Spendbase](https://www.spendbase.co/es/?p=35561); confirmar en Cloudflare) |
| Lo que tú haces | Nada en paneles: lo hago yo con una migración y un script | Crear bucket, activar acceso público, crear token (pasos en §5) |
| Riesgo principal | La cuota de salida si crece mucho | Que no hay dominio propio: `r2.dev` es para pruebas [documentación; confirmar límites] |

**Estimación de uso [estimación, no medida]:** 1.000 estudiantes × 5 cinemáticas al mes × 215 KB ≈ **1 GB al mes**, muy dentro de la
cuota gratuita de cualquiera de los dos.

**Recomendación:** empezar con **Supabase** (sin cuentas ni dominios nuevos) y dejar **R2** preparado como segundo proveedor. Gracias a
`mediaUrl()`, pasar a R2 después es una variable, no una reescritura.

## 4. Proceso A: bucket público de Supabase

> **Estado:** este PR deja construidas la **capa de URLs** (`mediaUrl`) y la **comprobación** (`media:check`). **A1 y A2 aún no existen**:
> son los siguientes PR, y la migración solo se aplica cuando tú lo apruebes.

| # | Paso | Quién | Verificación |
|---|---|---|---|
| A1 | **Migración** `072`: crea el bucket público `tonito-media` (solo `video/mp4`, `image/jpeg`, `image/webp`; tope 5 MB) **sin** políticas de escritura para `anon` ni `authenticated` | Yo (PR); tú mergeas y yo la aplico | Simulación en transacción revertida: `anon` **no** puede subir ni listar |
| A2 | **Script de subida** `npm run media:upload`: lee la clave de servicio de `.env.local`, sube con `cacheControl: 31536000`, `upsert: false` y nombre versionado | Yo (PR) | Rechaza nombres sin versión y archivos que superan el tope |
| A3 | Subir el clip y el poster | Tú ejecutas el script (la clave es tuya) | `npm run media:check -- --probe clips/<archivo>` debe dar ✔ |
| A4 | En Vercel (Production): `NEXT_PUBLIC_TONITO_MEDIA_BASE_URL=https://roulrdmxsazjkczxkzax.supabase.co/storage/v1/object/public/tonito-media` y **redeploy** | Tú | La URL del video en la cinemática empieza por esa base |
| A5 | Registrar el clip en `TONITO_CLIPS` | Yo (PR) | `npm run media:check` (sin `--probe`) da ✔ para todo lo registrado |

**Reversión:** quitar la variable en Vercel y volver a desplegar: vuelve a `/tonito/` (local).

## 5. Proceso B: Cloudflare R2

| # | Paso | Quién | Verificación |
|---|---|---|---|
| B1 | Cloudflare → **R2 Object Storage** → activar R2 (puede pedir un método de pago [sin verificar]) | Tú | El panel muestra R2 activo |
| B2 | **Crear bucket** `studia-media` | Tú | Aparece en la lista |
| B3 | **Acceso público:** en *Settings* del bucket, o **Custom Domain** (`media.<tu-dominio>`, el dominio debe estar en Cloudflare), o **`r2.dev`** solo para pruebas | Tú | Abrir la URL de un archivo de prueba en el navegador |
| B4 | **Subir** el clip y el poster con `Cache-Control: public, max-age=31536000, immutable` (panel, o `wrangler r2 object put`) [documentación] | Tú, o yo con un token | `npm run media:check -- --base <url> --probe clips/<archivo>` |
| B5 | *(Solo si quieres que yo suba)* **Token de API** de R2 con permiso *Object Read & Write* **limitado al bucket**, y sus claves en `.env.local` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) | Tú (**sin pegarlas en el chat**) | `media:upload` con `--provider r2` [pendiente de implementar si se elige R2] |
| B6 | En Vercel: `NEXT_PUBLIC_TONITO_MEDIA_BASE_URL=<la URL pública>` y **redeploy** | Tú | Igual que A4 |

**Lección del token de Workers AI:** un token puede estar activo y aun así **no tener la cuenta asignada** (`GET /accounts` vacío). En B5,
asignar explícitamente la cuenta y el bucket en *Resources* y probar el token antes de usarlo.

**CORS:** no hace falta para `<img>` y `<video>` normales. Solo si más adelante se leen los archivos con `fetch()` o con el atributo
`crossorigin`.

## 6. Comprobar un proveedor

```bash
npm run media:check                                     # los clips registrados, con la base de .env.local
npm run media:check -- --probe clips/prueba.v1.mp4      # un archivo suelto, antes de registrarlo
npm run media:check -- --base https://media.ejemplo.com --probe clips/prueba.v1.mp4
```

Por archivo comprueba: responde 200, tipo correcto (`video/mp4` o imagen), peso dentro del tope (clip ≤ 400 KB, poster ≤ 60 KB), que
**admite rangos** (una petición con `Range` da 206, para que el video avance y se reanude) y que trae **caché larga**. Sale con
código 1 si algo falla.

## 7. Qué NO está resuelto

- **Límites reales de tu plan de Supabase** y la **activación de R2** (tarjeta, dominio): sin verificar.
- **Dominio propio:** `studia-theta.vercel.app` es un subdominio de Vercel; para R2 con dominio propio hace falta uno en Cloudflare.
- **Términos de uso comercial** de lo generado con Flow y Gemini (pendiente de la ficha de arte).
- Dónde guardar los **videos originales pesados**: fuera del repo, que es público (por ejemplo, Drive privado).
