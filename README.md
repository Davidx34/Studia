# Stud.ia 🎓

> Plataforma educativa hiper-gamificada con tutor IA. Lecciones adaptativas, mascota virtual con personalidad, modo offline real. Pensada para estudiantes de primaria y secundaria en Latinoamérica.

[![Made with Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![Powered by Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ECF8E)](https://supabase.com/)
[![AI by Gemini](https://img.shields.io/badge/AI-Gemini%201.5%20Flash-4285F4)](https://ai.google.dev/)
[![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-5A0FC8)](https://web.dev/progressive-web-apps/)

## ¿Qué es Stud.ia?

Stud.ia es una PWA educativa que combina la **estructura curricular flexible** que necesitan los profesores con la **adicción positiva** de un juego como Duolingo. El núcleo emocional del producto es **Toñito**, una mascota virtual con IA generativa (Google Gemini) que actúa como tutor, evaluador y compañero de estudio.

Cada estudiante avanza por un mapa de aprendizaje personalizado con módulos creados por sus profesores, completa quizzes generados dinámicamente por Toñito según su nivel, gana XP y monedas, mantiene rachas diarias, desbloquea logros y puede personalizar la apariencia de su mascota. Los profesores tienen un panel separado donde crean contenido, monitorean el progreso de su clase y reciben alertas de estudiantes en riesgo.

## Características principales

- **Toñito, mascota IA con personalidad** — 8 estados emocionales animados, conversación en streaming con Gemini, memoria persistente entre sesiones, reacciona a aciertos/errores en tiempo real
- **Lecciones generadas dinámicamente** — Gemini 1.5 Flash genera preguntas adaptadas al nivel del estudiante usando prompts que el profesor configura por módulo
- **Sistema completo de gamificación** — XP con multiplicadores, niveles, corazones con regeneración temporal, monedas, racha diaria con freeze, 13 logros con 4 niveles de rareza
- **Mapa de aprendizaje visual** — 5 islas temáticas con caminos serpenteantes, prerequisitos por nodo, parallax sutil, módulo actual con pulso
- **Panel del profesor profesional** — Dashboard con métricas de clase, alertas de estudiantes inactivos 3+ días, ficha individual con heatmap de actividad, wizard de creación de módulos en 3 pasos
- **PWA con offline real** — Service Worker con 9 estrategias de cache diferenciadas, cola de sincronización en IndexedDB, instalable en Android/iOS, funciona sin conexión
- **Notificaciones gamificadas** — Toasts contextuales, modal de logros con confeti escalado por rareza, modal de level-up con Toñito en modo "Super Saiyan"

## Stack técnico

| Capa | Tecnología |
|---|---|
| **Frontend** | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| **Estado** | Zustand (3 stores: game, tonito, notifications) |
| **Backend** | Supabase (Postgres 15 + Auth + Realtime + Edge Functions) |
| **IA** | Google Gemini 1.5 Flash vía Edge Functions (Deno) |
| **PWA** | Serwist (sucesor de next-pwa) |
| **Iconos** | Lucide React |
| **Deploy** | Vercel (frontend) + Supabase (backend) |

## Arquitectura de alto nivel

```
┌─────────────────────────────────────────────────────────────┐
│                       Cliente (PWA)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ App Student  │  │ App Teacher  │  │ Service Worker   │   │
│  │ + Toñito UI  │  │ + Dashboard  │  │ + Sync Queue     │   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │                 │                   │
          │     Realtime    │     REST API      │
          │     ↕ ↕ ↕       │                   │
┌─────────┼─────────────────┼───────────────────┼─────────────┐
│         │     Supabase    │                   │             │
│  ┌──────▼──────┐  ┌───────▼──────┐  ┌─────────▼──────────┐  │
│  │ PostgreSQL  │  │ Auth (JWT)   │  │ Edge Functions     │  │
│  │ + RLS       │  │ + RLS hooks  │  │ - gemini-tutor     │  │
│  │ + Triggers  │  │              │  │ - tonito-chat (SSE)│  │
│  │ + Funcs SQL │  │              │  └─────────┬──────────┘  │
│  └─────────────┘  └──────────────┘            │             │
└────────────────────────────────────────────────┼─────────────┘
                                                 │
                                                 ▼
                                       ┌─────────────────┐
                                       │ Google Gemini   │
                                       │ 1.5 Flash API   │
                                       └─────────────────┘
```

**Decisiones clave:**

- **RLS en cada tabla** — Cada estudiante solo puede leer/escribir sus propios datos. Los profesores ven a los estudiantes inscritos en sus clases. Todo enforced en la base de datos, no en código de aplicación.
- **Funciones SQL para lógica crítica** — Cálculo de XP con multiplicadores, evaluación de achievements, recuperación de corazones, verificación de streak. Todo atómico en una sola transacción.
- **Edge Functions para IA** — Las llamadas a Gemini nunca pasan por el cliente. La API key vive solo en el secreto del Edge Runtime de Supabase.
- **Cache inteligente de preguntas** — Cada pregunta generada se guarda con un hash del contenido del módulo. Después de 3 preguntas cacheadas, se sirven aleatoriamente para dar variedad sin gastar tokens.
- **Streaming SSE para el chat** — Las respuestas de Toñito aparecen palabra por palabra (TTFT ~400ms) usando Server-Sent Events nativos de Gemini, propagados a través del Edge Function.
- **Offline con dos redes de seguridad** — El Service Worker reintenta requests fallidos con BackgroundSync, mientras una queue local en IndexedDB permite mostrar al usuario qué está pendiente. Funciona en Chrome/Android y degrada elegantemente en Safari iOS.

## Estructura del proyecto

```
studia/
├── public/
│   ├── manifest.json                # Web App Manifest
│   └── icons/                       # Íconos PWA en 8 tamaños
├── src/
│   ├── app/
│   │   ├── (auth)/                  # Login y signup
│   │   ├── (student)/               # Vista del estudiante con Toñito
│   │   │   ├── dashboard/           # Pantalla principal
│   │   │   ├── map/                 # Mapa de aprendizaje
│   │   │   ├── lesson/[id]/         # Lección con quiz
│   │   │   └── achievements/        # Trofeo room
│   │   ├── (teacher)/               # Panel del profesor (dark)
│   │   │   └── teacher/
│   │   │       ├── dashboard/
│   │   │       ├── students/[id]/
│   │   │       └── content/new/     # Wizard crear módulo
│   │   ├── offline/                 # Página fallback PWA
│   │   ├── sw.ts                    # Service Worker (Serwist)
│   │   └── layout.tsx               # Root + PWA metadata
│   ├── components/
│   │   ├── tonito/                  # SVG mascota + chat widget
│   │   ├── game/                    # Stats bar, hearts, XP
│   │   ├── notifications/           # Toasts, modals, level-up
│   │   └── offline/                 # Banner + install prompt
│   ├── lib/
│   │   ├── supabase/                # Clients (browser/server)
│   │   ├── gemini/                  # API + chat streaming
│   │   ├── achievements/            # evaluate() helper
│   │   └── offline/                 # Queue + persist wrappers
│   ├── stores/
│   │   ├── useGameStore.ts          # XP, hearts, coins, level
│   │   ├── useTonitoStore.ts        # Mood, animations, skin
│   │   └── useNotificationStore.ts  # Toasts, modals queue
│   ├── hooks/
│   │   └── useNotificationBridge.ts # Conecta game ↔ notifs ↔ Realtime
│   └── types/database.ts            # Tipos del schema
└── supabase/
    ├── migrations/                  # 3 migraciones SQL
    └── functions/
        ├── gemini-tutor/            # Genera preguntas + evalúa
        └── tonito-chat/             # Chat conversacional (streaming)
```

## Setup local

### 1. Clonar y dependencias

```bash
git clone <tu-repo-url>
cd studia
npm install
```

Las dependencias clave incluyen `@supabase/ssr`, `@supabase/supabase-js`, `zustand`, `framer-motion`, `lucide-react`, `recharts`, `@serwist/next` y `serwist`.

### 2. Variables de entorno

Crea `.env.local` en la raíz:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<tu-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<tu-anon-key>
```

Las dos las encuentras en `https://app.supabase.com/project/_/settings/api`.

### 3. Aplicar migraciones a Supabase

Tres opciones, en orden de preferencia:

**Opción A — Supabase CLI (recomendado):**
```bash
npm install -g supabase
supabase link --project-ref <tu-project-ref>
supabase db push
```

**Opción B — Pegado manual en SQL Editor:**
Abre `https://app.supabase.com/project/_/sql` y ejecuta en orden:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_seed_data.sql`
3. `supabase/migrations/003_achievement_evaluation.sql`

**Opción C — MCP de Supabase desde Claude/Cursor:**
Conecta el connector de Supabase y pídele que ejecute las migraciones.

### 4. Configurar la API key de Gemini

1. Conseguir una key gratuita: https://aistudio.google.com/apikey
2. Configurarla como secreto en Supabase:
   ```bash
   supabase secrets set GEMINI_API_KEY=<tu-key>
   ```

### 5. Desplegar Edge Functions

```bash
supabase functions deploy gemini-tutor
supabase functions deploy tonito-chat
```

### 6. Levantar en desarrollo

```bash
npm run dev
```

> ⚠️ El Service Worker está deshabilitado en `npm run dev` para evitar caches stale. Para probarlo: `npm run build && npm start`.

## Usuarios de prueba

Si aplicaste `002_seed_data.sql`, tienes estos usuarios listos para login:

| Email | Contraseña | Rol | Notas |
|---|---|---|---|
| `luza@studia.test` | `studia2026` | Estudiante | Nivel 4 · 7🔥 · skin Galaxia equipado |
| `diego_m@studia.test` | `studia2026` | Estudiante | Nivel 6 · top de la clase |
| `valeria_g@studia.test` | `studia2026` | Estudiante | Nivel 5 |
| `sofia_r@studia.test` | `studia2026` | Estudiante | Nivel 3 |
| `kevin_l@studia.test` | `studia2026` | Estudiante | Nivel 2 · ⚠ en riesgo (5 días sin actividad) |
| `profe@studia.test` | `studia2026` | Profesor | Ana Profesora · 5to grado Sección A |

## Despliegue a producción

Ver guía completa en [`DEPLOY.md`](./DEPLOY.md). Resumen:

1. Push del repo a GitHub
2. Importar a Vercel, configurar variables de entorno
3. Verificar que las Edge Functions están desplegadas
4. Confirmar el dominio en Supabase Auth (Site URL + Redirect URLs)
5. Smoke test con un usuario real

## Roadmap

**v0.1 — Lanzado** ✅
- Core de gamificación, mapa, lecciones con Gemini, panel docente, PWA, achievements

**v0.2 — Próxima iteración**
- Tienda funcional con preview en tiempo real de skins
- Chat de Toñito con quick-prompts contextuales por módulo
- Sistema de notificaciones push (requiere VAPID keys)
- Analytics: gráfico de XP semanal y radar chart de habilidades
- Ediciónr/borrar módulos desde el panel docente
- Crear/gestionar múltiples clases por profesor

**v1.0 — Producto completo**
- Multi-tenant con organizaciones (escuelas)
- Reportes en PDF para padres
- Modo "examen oficial" con tiempo límite
- Competencias entre clases (leaderboards inter-escolares)
- App nativa iOS/Android (con Capacitor o React Native)

## Filosofía del producto

**Stud.ia no compite con Khan Academy ni con Duolingo.** Compite con TikTok, con los videojuegos, con Roblox. La pregunta no es "¿cuál es la mejor app educativa?" sino **"¿qué app abre el estudiante a las 8pm cuando termina la tarea?"**.

Para ganar esa batalla, necesitamos:

1. **Recompensas variables y frecuentes** — Cada interacción debe sentirse jugable. Por eso XP flota, monedas suenan, Toñito celebra.
2. **Continuidad emocional** — Toñito recuerda al estudiante, lo llama por su nombre, sabe en qué módulo está. Sin esto, es un chatbot más.
3. **Fricción cero para empezar** — Login con email, 30 segundos para ver el dashboard, primera lección en menos de 1 minuto.
4. **Profesores empoderados, no reemplazados** — La IA genera preguntas pero el profesor define el contenido y los prompts. Esto es crítico para la adopción institucional.

## Licencia

Privado · Todos los derechos reservados · 2026

---

Construido con cariño para los estudiantes de Latinoamérica 💙

---

## Fase 11: Clases con IA

> Funcionalidad nueva. Profesor crea una clase, sube material didáctico (PDF/DOCX/XLSX), y la IA arma un mapa de aprendizaje + genera lecciones contextualizadas con RAG sobre el material real.

### Flujo del profesor

1. **Crear clase** en `/teacher/classrooms/new` (nombre, materia, grado).
2. **Inscribir estudiantes** por email (los que ya tienen cuenta entran al toque; los demás quedan pendientes y se inscriben automáticamente al hacer signup, vía un trigger SQL).
3. **Subir material** en la pestaña "Materiales" (drag-drop nativo, máx 10 MB por archivo). La Edge Function `process-material` extrae texto, lo divide en chunks de ~500 tokens y calcula embeddings (Gemini `text-embedding-004`, 768 dims) que se guardan en pgvector con índice HNSW.
4. **Generar mapa** desde la pestaña "Módulos". La Edge Function `generate-classroom-map` llama a Gemini Map Designer con `responseSchema` JSON pidiendo 5–12 nodos con dificultad creciente, prerequisites por índice y posiciones x/y para el mapa visual.
5. **Ver progreso** en la pestaña "Progreso" con tabla sortable, filtros (Todos / Activos / En riesgo), sparkline de actividad semanal y exportación a Excel multi-hoja.

### Flujo del estudiante

1. En su dashboard ve la nueva sección **"📚 Mis clases"** arriba del mapa global.
2. Entra a una clase (`/my-classes/[id]`) y ve el mapa de la clase: lista de estaciones con estados *locked / available / in_progress / completed*.
3. Hace una lección — la Edge Function `generate-lesson-from-material` corre two-stage:
   - **Outliner**: outline cacheado en `lesson_generations` (TTL 7 días) con mezcla de tipos.
   - **Writer**: por cada entrada hace embedding del query + `match_material_chunks` (RAG sobre pgvector) + prompt al modelo con `responseSchema` específico al tipo de pregunta.
4. Soporta **3 tipos de pregunta mezclados**:
   - **Multiple choice** (4 botones)
   - **Verdadero/Falso** (2 botones grandes)
   - **Completar la frase** (input con normalización: minúsculas, sin tildes, sin espacios extra)
5. Cada feedback muestra el **`source_quote`** del material original ("Del material de tu profesor: '…'").
6. XP, achievements y rachas se recalculan igual que con módulos legacy.

### Schema agregado

12 migraciones nuevas (`004_enable_extensions.sql` → `015_profiles_add_email.sql`):

| Tabla nueva | Propósito |
|---|---|
| `teaching_materials` | metadata + estado de procesamiento de cada archivo |
| `material_chunks` | texto + `embedding vector(768)` con HNSW |
| `pending_enrollments` | invitaciones por email a usuarios sin cuenta |
| `lesson_generations` | cache de outlines (TTL 7d), service_role only |

Más columnas aditivas en `content_modules` (`auto_generated`, `topic_keywords`, `source_material_ids`), `classrooms` (`subject_area`, `grade_level`) y `profiles` (`email`).

3 funciones SQL nuevas (todas `SECURITY DEFINER` con `search_path` explícito):
- `match_material_chunks(query_embedding, classroom_id_filter, match_count)` — RAG retrieval por similitud cosine
- `invalidate_lesson_cache(classroom_id)` — limpia outlines + preguntas cuando cambia el material
- `auto_enroll_pending()` (trigger) — promueve `pending_enrollments` a `class_enrollments` al signup

1 bucket de Storage privado (`teaching-materials`, 10 MB max, MIMEs PDF/DOCX/XLSX) con 4 políticas RLS.

### Edge Functions nuevas (3)

| Función | Qué hace |
|---|---|
| `process-material` | Descarga archivo, extrae texto (`unpdf` / `mammoth` / `xlsx`), chunking + embeddings, detección de temas |
| `generate-classroom-map` | Map Designer con structured JSON output → 5-12 módulos con prereqs |
| `generate-lesson-from-material` | Two-stage Outliner + Writer con RAG sobre `match_material_chunks` |

Todas requieren `GEMINI_API_KEY` configurada en `supabase secrets`.

### Setup (orden)

```powershell
# 1. Migraciones (ya aplicadas si seguiste el flujo)
supabase db push

# 2. Configurar Gemini API key (sólo si no está)
supabase secrets set GEMINI_API_KEY=tu_key_de_aistudio_google_com

# 3. Deploy de las 3 edge functions nuevas
supabase functions deploy process-material
supabase functions deploy generate-classroom-map
supabase functions deploy generate-lesson-from-material

# 4. Verificar
supabase functions list
```

### Costos estimados (Gemini 1.5 Flash + text-embedding-004)

| Operación | Costo |
|---|---|
| Procesar PDF de 20 páginas | ~$0.0003 |
| Generar mapa de clase | ~$0.005 |
| Generar lección de 5 preguntas con RAG | ~$0.002 |
| Cache hit | $0 |
| **100 estudiantes × 20 lecciones/mes** | **~$4/mes** |

### Limitaciones conocidas

- Edge Functions tienen timeout de 150s. Si subís un PDF de >50 páginas conviene implementar background jobs con tabla `processing_jobs` + cron de 1 min.
- Gemini free tier tiene rate limit de 15 req/min — agrupamos embeddings en batches de 100.
- Storage free tier: 1 GB total. El UI muestra cuota usada.
- `pgvector` con RLS requiere `SECURITY DEFINER` (ya aplicado en `match_material_chunks`).
- Ejecutar `VACUUM ANALYZE` periódicamente sobre `material_chunks` mejora el HNSW index.
