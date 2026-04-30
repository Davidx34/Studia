# Stud.ia PWA Setup — Fase 7

## Instalación de dependencias

```bash
npm install @serwist/next serwist
npm install -D @types/serviceworker
```

## Estructura nueva creada

```
public/
├── manifest.json                       # Web App Manifest
└── icons/
    ├── icon-source.svg                 # SVG fuente (ya generado)
    ├── icon-72.png                     # PNG 72x72
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-144.png
    ├── icon-152.png                    # iOS
    ├── icon-192.png                    # Android estándar
    ├── icon-384.png
    └── icon-512.png                    # Splash screen Android

src/
├── app/
│   ├── sw.ts                           # Service Worker source (Serwist)
│   ├── layout.tsx                      # ACTUALIZADO: PWA metadata + componentes globales
│   └── offline/page.tsx                # Página fallback cuando navegación falla
├── components/offline/
│   ├── OfflineIndicator.tsx            # Banner amber + sync badge
│   └── InstallPrompt.tsx               # Card de instalación (Android + iOS)
└── lib/offline/
    ├── queue.ts                        # Hooks + IndexedDB para acciones pendientes
    └── persistOffline.ts               # Wrappers con fallback a queue

next.config.js                          # ACTUALIZADO: integración Serwist
```

## TypeScript: actualizar tsconfig.json

Asegúrate de que tu `tsconfig.json` incluya estos lib y types para que el SW compile:

```json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext", "webworker"],
    "types": ["@serwist/next/typings"]
  },
  "exclude": ["node_modules", "public/sw.js"]
}
```

## Verificación local

1. **Build de producción** (el SW está deshabilitado en dev):
   ```bash
   npm run build
   npm start
   ```

2. **Abrir Chrome DevTools → Application tab:**
   - **Manifest** → Debe verse el ícono y los datos
   - **Service Workers** → Debe estar registrado y "activated"
   - **Storage → IndexedDB** → `studia-offline` (acciones encoladas) y `workbox-background-sync` (cola del SW)
   - **Cache Storage** → Verás `studia-app-shell`, `studia-images`, `studia-supabase-reads`, etc.

3. **Probar offline:**
   - DevTools → Network tab → cambiar a "Offline"
   - Refrescar la página → debe seguir funcionando
   - Hacer una acción (responder pregunta) → ver toast amber
   - Volver a "Online" → ver toast cyan "Sincronizando..."

4. **Probar instalación:**
   - En Chrome desktop: ícono de instalar en la barra de URL
   - En Android Chrome: aparece "Añadir a pantalla de inicio"
   - En iOS Safari: el `InstallPrompt` muestra instrucciones manuales

## Notas importantes

- **El SW solo funciona en HTTPS** o `localhost`. En Vercel ya tienes HTTPS automático.
- **Disable en dev** está activo en `next.config.js` para evitar caches stale durante desarrollo.
- **Registro automático**: Serwist registra el SW en cada page load — no necesitas código manual.
- **Background Sync** requiere Chrome/Edge/Opera. En Safari iOS, las escrituras offline solo se guardan en IndexedDB y se sincronizan cuando el usuario vuelva a abrir la app online.

## Generar íconos en tu propio entorno (si quieres regenerarlos)

Los íconos PNG ya están listos en `public/icons/`. Si modificas `icon-source.svg` y quieres regenerarlos:

```bash
# Opción 1: con Python + cairosvg
pip install cairosvg
python3 -c "
import cairosvg
sizes = [72, 96, 128, 144, 152, 192, 384, 512]
with open('public/icons/icon-source.svg', 'rb') as f:
    svg = f.read()
for s in sizes:
    cairosvg.svg2png(bytestring=svg, output_width=s, output_height=s,
                     write_to=f'public/icons/icon-{s}.png')
"

# Opción 2: con sharp (Node.js)
npm install -D sharp
node -e "
const sharp = require('sharp');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
sizes.forEach(s => sharp('public/icons/icon-source.svg').resize(s, s).png().toFile(\`public/icons/icon-\${s}.png\`));
"
```
