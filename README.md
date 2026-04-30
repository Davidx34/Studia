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
