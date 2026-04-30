# Checklist final pre-launch · Stud.ia

Esta es la lista de cosas a verificar antes de mostrar Stud.ia a usuarios reales. Está organizada por **prioridad** (qué bloquea el launch vs qué puede esperar) y por **categoría** (técnica, contenido, legal, etc.).

Marca cada item con `[x]` cuando lo completes. La meta es llegar a 100% de los items 🟥 antes de invitar al primer usuario externo.

---

## 🟥 BLOQUEANTES — Sin esto no puedes lanzar

### Backend e infraestructura

- [ ] Las 3 migraciones SQL están aplicadas en el proyecto de **producción** (no solo en dev)
- [ ] Las 2 Edge Functions (`gemini-tutor` y `tonito-chat`) están desplegadas con `STATUS: ACTIVE`
- [ ] El secreto `GEMINI_API_KEY` está configurado en Supabase (verificar con `supabase secrets list`)
- [ ] Realtime está habilitado para `profiles`, `user_achievements` y `student_progress`
- [ ] Las RLS policies existen en TODAS las tablas (verificar en SQL Editor: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` — todas deben estar en `true`)
- [ ] Site URL y Redirect URLs de Supabase Auth apuntan al dominio de producción

### Frontend desplegado

- [ ] El proyecto está desplegado en Vercel con variables `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` configuradas
- [ ] El build de producción pasa sin errores TypeScript
- [ ] El Service Worker se registra correctamente (verificar en DevTools → Application → Service Workers)
- [ ] El manifest.json se sirve correctamente y el ícono se ve bien al instalar la PWA

### Smoke tests funcionales

- [ ] Login con email + password funciona en producción (probar con Luza)
- [ ] Logout funciona y limpia la sesión
- [ ] El middleware redirige correctamente: estudiantes → `/dashboard`, profesores → `/teacher/dashboard`
- [ ] Una lección completa de 5 preguntas funciona end-to-end (carga preguntas, evalúa respuestas, suma XP, persiste progreso)
- [ ] Gemini responde preguntas reales (no errores 500 en `gemini-tutor`)
- [ ] Toñito chat responde con streaming visible (no de golpe)
- [ ] Realtime sync funciona: actualizar `profiles` desde SQL editor refleja cambio en cliente sin reload

### Seguridad

- [ ] `.env.local` está en `.gitignore` y NO está commiteado al repo
- [ ] La service_role key de Supabase NUNCA se usa en código del cliente
- [ ] Verificar que un estudiante NO puede leer el progreso de otros estudiantes (intentar SELECT manual desde el SQL Editor con un JWT distinto)
- [ ] Verificar que un estudiante NO puede ver módulos de clases en las que no está inscrito
- [ ] La página de profesor `/teacher/*` rechaza acceso de usuarios con rol `student`

### Datos y contenido

- [ ] Hay al menos UNA clase real creada (no solo la de testing de Ana)
- [ ] Hay al menos 5-10 módulos de contenido reales (no los de seed)
- [ ] Cada módulo tiene un `gemini_prompt_template` que produce preguntas de calidad (validar con tests reales)
- [ ] El profesor real está creado y tiene `role = 'teacher'` en la DB

---

## 🟨 IMPORTANTES — Lánzalo, pero documenta y arregla pronto

### Experiencia del usuario

- [ ] La página `/forgot-password` existe (o documenta cómo recuperar contraseña manualmente)
- [ ] Los mensajes de error son amigables, no técnicos ("No pudimos conectarnos" en lugar de "fetch failed")
- [ ] Los loading states existen en todas las páginas que esperan datos
- [ ] La página `/offline` se ve cuando el usuario está sin conexión sin haber visitado nada cacheable
- [ ] El skin de Toñito por defecto se ve bien para usuarios nuevos sin compras
- [ ] Los textos de Toñito (saludos, mensajes de error) están en español neutro, no en español de España ni mexicano marcado

### Contenido educativo

- [ ] Los `gemini_prompt_template` de los módulos producen preguntas apropiadas para la edad objetivo
- [ ] Los nombres de las categorías y módulos están bien escritos (sin typos)
- [ ] Las descripciones de los logros están traducidas y son claras
- [ ] Los nombres de los items de la tienda son apropiados para niños

### Mobile

- [ ] La app se ve bien en iPhone SE (la pantalla más pequeña común, 375px)
- [ ] La app se ve bien en iPhone Pro Max (414px)
- [ ] La app se ve bien en Android promedio (360-412px)
- [ ] El widget de Toñito no tapa contenido importante en pantallas pequeñas
- [ ] El teclado virtual no rompe el layout cuando aparece (especialmente en chat de Toñito)
- [ ] La barra inferior del navegador móvil no tapa botones importantes (`viewport-fit: cover` ya está)

### Performance

- [ ] El primer render del dashboard es < 2.5 segundos en 3G simulada (verificar en Lighthouse)
- [ ] El bundle de JS principal es < 300KB gzipped
- [ ] No hay imágenes sin optimizar > 100KB
- [ ] Las fuentes de Google Fonts se cargan con `display=swap`
- [ ] Lighthouse score > 80 en Performance, Accessibility, Best Practices, SEO

---

## 🟩 NICE TO HAVE — Mejora pero no detiene el launch

### Onboarding

- [ ] Hay un flujo de onboarding para nuevos usuarios (las 6 pantallas que documenté en el spec original)
- [ ] El primer login de un estudiante muestra un tour de 3-4 tooltips
- [ ] El primer login de un profesor explica el wizard de creación

### Polish visual

- [ ] El favicon se ve bien (ahora es el ícono PNG, podría ser más cuidado)
- [ ] Las screenshots del manifest.json existen para que el install prompt en Android se vea pro
- [ ] Las páginas tienen Open Graph tags para que los enlaces compartidos se vean bien
- [ ] Las animaciones tienen `prefers-reduced-motion` para usuarios con esa preferencia activa

### Analytics y observabilidad

- [ ] Hay un setup de analytics (Vercel Analytics, Plausible, o similar)
- [ ] Los errores de cliente se reportan a algún servicio (Sentry recomendado)
- [ ] Hay alertas configuradas para errores 5xx en las Edge Functions
- [ ] Hay un dashboard de métricas de uso (logins/día, lecciones completadas/día)

### Testing

- [ ] Hay tests E2E con Playwright para los flujos críticos (login + completar una lección)
- [ ] Hay tests unitarios para las funciones SQL críticas (`calculate_xp`, `evaluate_achievements`)
- [ ] Hay un CI configurado en GitHub Actions que corre los tests en cada PR

### Documentación interna

- [ ] El README está actualizado con instrucciones de setup
- [ ] La guía de despliegue está actualizada con cualquier paso específico de tu hosting
- [ ] Hay documentación para los profesores sobre cómo usar el panel
- [ ] Hay un changelog que registra cada release

---

## 📋 LEGAL Y CUMPLIMIENTO — Crítico si tienes usuarios menores de edad

Esta sección es **especialmente importante para Stud.ia** porque la audiencia primaria son menores. No es opcional desde un punto de vista legal en la mayoría de jurisdicciones de Latinoamérica.

- [ ] Hay una página de **Términos y Condiciones** accesible desde el footer
- [ ] Hay una **Política de Privacidad** que cumple con leyes locales (LFPDPPP en México, Ley 1581 en Colombia, etc.)
- [ ] La política explica qué datos se recolectan (email, nombre, progreso académico)
- [ ] La política explica que se usa Gemini API y que el contenido del chat se envía a Google
- [ ] Si usuarios son menores de 13 años, hay un mecanismo de consentimiento parental (COPPA en US, equivalentes locales)
- [ ] Hay un email de contacto para solicitudes de eliminación de datos (GDPR-style "right to be forgotten")
- [ ] Los datos almacenados pueden ser exportados por el usuario (idealmente desde la UI, mínimo bajo solicitud)
- [ ] Los logs de Edge Functions NO almacenan PII (revisar `tonito-chat` que ahora guarda mensajes en `tonito_conversations` — esto SÍ es PII)

### Específico para escuelas/instituciones

- [ ] Si vas a vender a escuelas, hay un acuerdo de procesamiento de datos (DPA) que pueden firmar
- [ ] Hay claridad sobre quién es el "data controller" (la escuela) vs el "data processor" (Stud.ia)
- [ ] Los logs/backups tienen un período de retención claro y documentado

---

## 🔧 OPERACIONAL — Después del launch

Cosas que necesitas tener listas para los primeros días post-launch:

- [ ] Tienes un canal de soporte (email, formulario, WhatsApp, lo que sea apropiado)
- [ ] Tienes un proceso para crear usuarios profesor manualmente (porque NO hay UI pública de signup de profesores)
- [ ] Tienes un proceso para resetear contraseñas manualmente si un estudiante la pierde
- [ ] Sabes cómo ver los logs de las Edge Functions cuando un usuario reporta un problema
- [ ] Tienes los backups de Supabase activos (`Database → Backups` en el dashboard)
- [ ] Tienes documentado quién tiene acceso de admin al proyecto de Supabase
- [ ] Tienes documentado quién tiene acceso al proyecto de Vercel
- [ ] Tienes un plan de comunicación si necesitas tirar el sitio para un mantenimiento (página de status, anuncio en Twitter, etc.)

---

## 🚀 Day-1 metrics — Qué medir las primeras 24 horas

Cuando lances, observa estos números para detectar problemas temprano:

1. **Tasa de signup completado** — ¿cuántos usuarios pasan del formulario al dashboard?
2. **Tasa de primera lección** — ¿cuántos llegan a empezar una lección?
3. **Tasa de primera lección completada** — ¿cuántos llegan a las 5 preguntas?
4. **Errores de Gemini** — el dashboard de Edge Functions debería mostrar < 5% de errores
5. **Latencia de Gemini** — el TTFT promedio debería ser < 1s
6. **Crashes de cliente** — Sentry o similar debería mostrar 0 crashes en los primeros 30 minutos
7. **Lighthouse score en producción** — sin variación significativa vs lo que medías en local

Si algo de esto sale mal, **prepárate para hacer hotfix rápido o tirar features problemáticas con feature flags**.

---

## ✅ Completado: estás listo para lanzar

Cuando todos los items 🟥 estén marcados y al menos 80% de los 🟨, puedes invitar a tus primeros usuarios con confianza.

Consejos finales para el día del launch:

1. **Lanza un viernes a las 10am**, no a las 5pm. Si algo rompe quieres tener todo el día para arreglarlo, no salir corriendo del trabajo.
2. **Empieza con un grupo pequeño y controlado** (10-30 usuarios). Aprende qué rompen antes de escalar.
3. **Ten un canal directo abierto** con esos primeros usuarios. Su feedback en las primeras 48 horas vale más que un mes de iteración a ciegas.
4. **Documenta cada bug y cada confusión**. Si dos usuarios reportan lo mismo, es un problema sistémico, no puntual.
5. **Celebra el lanzamiento**. Construir esto fue mucho trabajo. 🎉

---

¡Adelante, Luza! Stud.ia está casi listo para conocer al mundo. 💜
