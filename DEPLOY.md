# Guía de despliegue · Stud.ia

Esta guía te lleva paso a paso desde "tengo el código en mi máquina" hasta "Stud.ia está en producción y mis usuarios pueden acceder". Asume que ya tienes el código funcionando localmente con `npm run dev`.

**Tiempo estimado: 45-60 minutos** (la mayoría es esperar deploys).

---

## Pre-requisitos

Antes de empezar, asegúrate de tener:

- ✅ Cuenta de GitHub con el repo de Stud.ia subido
- ✅ Cuenta de Vercel (gratuita está bien para empezar)
- ✅ Cuenta de Supabase con un proyecto creado
- ✅ Cuenta de Google Cloud / AI Studio para la API de Gemini
- ✅ Las migraciones aplicadas en Supabase (`001`, `002`, `003`)
- ✅ Las Edge Functions desplegadas (`gemini-tutor`, `tonito-chat`)
- ✅ El secreto `GEMINI_API_KEY` configurado en Supabase

Si te falta cualquiera de los últimos cuatro, ve al [README](./README.md#setup-local) y completa la sección "Setup local" primero.

---

## Parte 1: Configurar Supabase para producción

### 1.1 Verificar las URLs autorizadas

Vas a desplegar en `https://tu-app.vercel.app` (o un dominio custom). Supabase necesita saber que esa URL puede hacer auth.

1. Ve a `https://app.supabase.com/project/<tu-ref>/auth/url-configuration`
2. En **Site URL** pon el dominio de producción: `https://studia.tu-dominio.com`
3. En **Redirect URLs** agrega:
   ```
   https://studia.tu-dominio.com/**
   https://studia-*.vercel.app/**
   http://localhost:3000/**
   ```
   El segundo cubre los preview deployments de Vercel automáticos. El tercero permite seguir desarrollando en local.

### 1.2 Verificar políticas de email (opcional pero recomendado)

Si estás usando email + password, ve a `Authentication → Email Templates` y revisa el template de "Confirm signup" — está en inglés por defecto. Tradúcelo al español para tus usuarios. Lo mismo con "Reset password".

> **Nota importante**: en la fase 2 le dijimos al middleware que no requiriera confirmación de email para simplificar testing. Si en producción quieres requerir confirmación, ve a `Authentication → Sign In/Up → Email confirmation` y actívalo.

### 1.3 Confirmar que las Edge Functions están desplegadas

```bash
supabase functions list
```

Deberías ver:
```
NAME              VERSION   STATUS
gemini-tutor      v1        ACTIVE
tonito-chat       v1        ACTIVE
```

Si no están, despliégalas:
```bash
supabase functions deploy gemini-tutor
supabase functions deploy tonito-chat
```

### 1.4 Verificar el secreto de Gemini

```bash
supabase secrets list
```

Debería aparecer `GEMINI_API_KEY`. Si no:
```bash
supabase secrets set GEMINI_API_KEY=tu_key_aqui
```

### 1.5 Habilitar Realtime en las tablas que lo necesitan

Las notificaciones de logros y la sincronización de perfil dependen de Realtime. Verifica que esté habilitado:

1. Ve a `Database → Replication`
2. En la lista de tablas, asegúrate de que estas tengan Realtime activo:
   - `profiles`
   - `user_achievements`
   - `student_progress`
3. Si no lo están, click en el toggle de cada una.

Sin esto, los modales de level-up y achievement no aparecerán automáticamente.

---

## Parte 2: Subir el código a GitHub

Si aún no lo has hecho:

```bash
cd studia
git init
git add .
git commit -m "Initial Stud.ia release"
git branch -M main
git remote add origin https://github.com/tu-usuario/studia.git
git push -u origin main
```

**⚠️ Antes de hacer push, verifica que `.env.local` esté en `.gitignore`.** Nunca subas las claves a GitHub. Tu `.gitignore` debería contener al menos:

```
node_modules/
.next/
.env
.env.local
.env*.local
public/sw.js
public/swe-worker-*.js
*.log
.DS_Store
```

Las dos líneas de `public/sw.js` y `swe-worker` son importantes porque Serwist los genera en cada build y no quieres versionarlos.

---

## Parte 3: Importar a Vercel

### 3.1 Conectar el repo

1. Ve a `https://vercel.com/new`
2. Importa tu repo de GitHub
3. Vercel detectará automáticamente que es Next.js. **No cambies nada** en la configuración del framework.

### 3.2 Configurar variables de entorno

En la pantalla de import, antes de hacer click en "Deploy", expande **Environment Variables** y agrega:

| Nombre | Valor | Environments |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<tu-ref>.supabase.co` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...` (la anon key completa) | Production, Preview, Development |

Las consigues en `https://app.supabase.com/project/<tu-ref>/settings/api`.

> **Importante**: ambas variables empiezan con `NEXT_PUBLIC_` porque se usan en el cliente. Esto significa que cualquiera puede leerlas en el bundle de JavaScript — está bien, son las claves públicas. Las claves privadas (`SERVICE_ROLE_KEY`) **nunca** deberían estar en el cliente y aquí no las usamos.

### 3.3 Hacer el primer deploy

Click en **Deploy**. Vercel hará el build (toma 2-4 minutos) y te dará una URL como `https://studia-abc123.vercel.app`.

**Si el build falla:**

- **Error de TypeScript** → revisa el log. Puede ser que falte el archivo `src/types/database.ts` que documenté en la fase 1. Asegúrate de que esté commiteado.
- **Error de Serwist** → verifica que tu `next.config.js` tenga la integración correcta y que `tsconfig.json` incluya `"webworker"` en `lib`.
- **Error con `dynamic = "force-dynamic"`** → algunas páginas server component tienen `cookies()` que requiere render dinámico. Si Vercel se queja, agrega `export const dynamic = 'force-dynamic'` al top del archivo afectado.

---

## Parte 4: Configurar dominio custom (opcional)

Si tienes un dominio propio (recomendado para producción):

1. En Vercel, ve a tu proyecto → **Settings → Domains**
2. Agrega tu dominio (ej: `studia.tudominio.com`)
3. Vercel te dará los registros DNS a configurar. Los típicos son:
   - **CNAME** `studia` → `cname.vercel-dns.com`
4. Espera la propagación DNS (5-30 minutos)
5. Vercel emite certificado SSL automáticamente vía Let's Encrypt

**Después de añadir el dominio**, vuelve al paso 1.1 de esta guía y actualiza el Site URL de Supabase para que coincida.

---

## Parte 5: Smoke test post-deploy

Antes de invitar usuarios reales, verifica que todo funciona end-to-end. Abre tu URL de producción y prueba:

### 5.1 Auth
- [ ] Login con `luza@studia.test` / `studia2026` funciona y redirige al dashboard
- [ ] Logout funciona y vuelve a `/login`
- [ ] Login con `profe@studia.test` redirige al panel docente, no al de estudiante

### 5.2 Estudiante
- [ ] Dashboard muestra los stats correctos (Nivel 4, 850 XP, 7🔥, etc.)
- [ ] Toñito aparece en la esquina con el skin Galaxia (violeta-rosa)
- [ ] El mapa muestra los 5 nodos completos en math/science
- [ ] Click en "Fracciones Básicas" abre la lección
- [ ] La primera pregunta carga (significa que Gemini funciona)
- [ ] Responder correctamente muestra el feedback de Toñito (significa que evaluate_answer funciona)
- [ ] Completar 5 preguntas suma XP y dispara animación de confeti

### 5.3 Toñito chat
- [ ] Click en Toñito abre el chat
- [ ] Escribir "¡Hola!" y enviar funciona
- [ ] La respuesta llega en streaming (palabras apareciendo, no de golpe)
- [ ] Cerrar el chat y reabrirlo carga el historial

### 5.4 Achievements
- [ ] Visitar `/achievements` muestra los 4 logros desbloqueados con sus colores
- [ ] Los logros bloqueados muestran las barras de progreso correctas
- [ ] El badge "¡NUEVO!" del dashboard desaparece al visitar la página

### 5.5 Profesor
- [ ] Login como `profe@studia.test`
- [ ] Dashboard muestra los 5 estudiantes con sus métricas
- [ ] Kevin aparece en la sección "En riesgo" con el badge "5d"
- [ ] Click en cualquier estudiante abre su ficha con heatmap
- [ ] Crear módulo wizard funciona los 3 pasos sin errores

### 5.6 PWA
- [ ] Abrir DevTools → Application → Service Workers → debe estar "activated"
- [ ] DevTools → Network → cambiar a "Offline" → la app sigue funcionando
- [ ] DevTools → Network → "Online" otra vez → debería sincronizarse cualquier acción pendiente
- [ ] En Chrome desktop debería aparecer el ícono de instalar en la barra de URL
- [ ] En móvil real, abrir desde Chrome y verificar "Añadir a pantalla de inicio"

### 5.7 Realtime
Esta es la prueba más interesante. Abre dos ventanas:

- **Ventana A**: logueada como Luza
- **Ventana B**: en Supabase SQL Editor

En la ventana B ejecuta:
```sql
UPDATE public.profiles SET coins = coins + 100 WHERE username = 'luza';
```

En la ventana A las monedas en el StatsBar deberían **subir solas** sin recargar. Eso confirma que Realtime funciona en producción.

Otro test:
```sql
INSERT INTO public.user_achievements (user_id, achievement_id, seen_by_user)
SELECT
  (SELECT id FROM public.profiles WHERE username = 'luza'),
  (SELECT id FROM public.achievements WHERE name = 'Imparable'),
  false;
```

En la ventana A debería **aparecer el modal de logro desbloqueado** con confeti azul.

---

## Parte 6: Monitoreo y mantenimiento

### 6.1 Logs de Supabase

Las Edge Functions tienen logs accesibles en tiempo real:

```bash
supabase functions logs gemini-tutor --tail
supabase functions logs tonito-chat --tail
```

Si Gemini empieza a fallar (rate limits, errores de API), aquí lo verás antes que tus usuarios.

### 6.2 Métricas de Vercel

En `vercel.com/<tu-proyecto>/analytics` tienes:
- Page views por ruta
- Web Vitals (LCP, FID, CLS)
- Errores de runtime

Para empezar el plan gratuito incluye 100k visitantes/mes — más que suficiente para una v1.

### 6.3 Cuotas de Gemini

Gemini 1.5 Flash en el tier gratuito da:
- 15 requests/minuto
- 1500 requests/día
- 1 millón de tokens/mes

Para Stud.ia esto soporta cómodamente unos 100-200 estudiantes activos diarios. Si creces más, necesitarás activar billing en Google Cloud (pay-as-you-go, ~$0.075 por millón de tokens de input).

### 6.4 Cuotas de Supabase

Plan gratuito de Supabase:
- 500MB de base de datos
- 1GB de transferencia de archivos
- 50,000 usuarios activos/mes
- 500,000 invocaciones de Edge Functions/mes

Para una v1 sobra. Cuando crezcas, plan Pro es $25/mes y cubre 8GB de DB + 250GB de bandwidth.

---

## Parte 7: Lo que NO está en producción

Honestidad importante: hay piezas del producto que están scaffoldeadas pero no 100% listas. Este es el inventario:

| Feature | Estado | Qué falta |
|---|---|---|
| **Tienda funcional** | UI no construida | La fase de tienda no se ejecutó. El schema está, los items están. Falta `(student)/shop/page.tsx` |
| **Edición de módulos** | No existe | El profesor crea pero no puede editar. Falta `(teacher)/teacher/content/[id]/edit/page.tsx` |
| **Crear nuevas clases** | No existe | El profesor de prueba ya tiene una clase, pero crear más requiere SQL manual |
| **Notificaciones push** | No existe | Requiere VAPID keys y servicio adicional. Roadmap v0.2 |
| **Eliminar contenido** | No existe | Sin botón de delete en el panel docente |
| **Reset de password vía email** | Schema sí, UI no | Solo está el flujo de signup/login. Falta `/forgot-password` |
| **Rich text en módulos** | No existe | Los módulos solo tienen título + descripción + prompt. No hay editor de contenido enriquecido |
| **Múltiples idiomas** | Solo español | Toda la UI hardcodeada en español, sin i18n |

Ninguna de estas bloquea el lanzamiento de un MVP, pero conviene comunicarlas a tu equipo y a los primeros usuarios para gestionar expectativas.

---

## Troubleshooting común

**"Failed to fetch" en el cliente al llamar a Edge Functions**
→ Probablemente el secreto `GEMINI_API_KEY` no está configurado. Ejecuta `supabase secrets list` y verifica.

**Los modales de logros no aparecen aunque la DB inserta filas**
→ Realtime no está habilitado para `user_achievements`. Ve a `Database → Replication` y actívalo.

**El Service Worker no se registra en producción**
→ Verifica que el dominio sea HTTPS (Vercel lo es por defecto). El SW también necesita que `public/sw.js` exista — debería generarse automáticamente en el build.

**Los caches del SW están sirviendo versiones viejas tras un deploy**
→ Esto es esperado en la primera visita después de un deploy. Serwist maneja `skipWaiting + clientsClaim`, así que en la segunda visita ya tiene la nueva versión. Si quieres forzar refresco para todos los usuarios, incrementa la versión del cache en `sw.ts`.

**Login de Luza dice "Invalid credentials" en producción pero funciona en local**
→ Probablemente confirmaste el email en tu DB de dev pero no en la de producción, o usaste dos proyectos de Supabase distintos. Verifica que estás apuntando al mismo `NEXT_PUBLIC_SUPABASE_URL`.

**Error 401 en cualquier llamada a la API**
→ Site URL en Supabase no coincide con el dominio desde el que estás llamando. Vuelve al paso 1.1.

---

## Backup recomendado

Antes de invitar usuarios reales, configura backups automáticos:

1. Ve a `Database → Backups` en Supabase
2. Plan gratuito tiene backups diarios automáticos por 7 días — suficiente para v1
3. Para producción seria, considera el plan Pro que extiende a 30 días

---

¡Listo! Cuando completes todos los smoke tests, **Stud.ia está oficialmente en producción**. 🚀

Si algo del despliegue te bloquea, abre la sección de troubleshooting o revisa los logs específicos de Vercel/Supabase antes de tirar el código por la ventana. La mayoría de problemas en deploy son configuración, no código.
