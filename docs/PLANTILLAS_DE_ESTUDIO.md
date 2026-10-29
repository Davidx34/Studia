# Plantillas del material de estudio

El **profesor** elige cómo se muestra el material de estudio de su clase. La IA **no escribe HTML ni estilos**: genera *datos* (título, idea principal, puntos clave…) que el código valida contra el material, y cada plantilla es un componente de la app que los pinta.

**Por qué así**

- Cambiar de plantilla es instantáneo y **no cuesta ninguna llamada a la IA**; el contenido no se toca.
- El contenido se sigue verificando contra el material (cifras y términos deben salir de él), cosa imposible si la IA escribiera el HTML.
- Sin riesgo de inyección: nunca se pinta HTML generado por el modelo.
- Una estructura sirve para muchos estilos: **plantilla = estructura (layout) + tema**.

## Estado

| Superficie | Plantillas | Dónde se elige | Estado |
|---|---|---|---|
| **Fichas de lectura** | 16 en 4 categorías (abajo) | Panel del profesor → *Material de estudio* → *Plantilla de las fichas de lectura* | Hecho |
| **Mapa de módulos** | 14 en 4 categorías (abajo) | Panel del profesor → *Material de estudio* → *Plantilla del mapa de aprendizaje* | Hecho: una **sección por clase** |
| **Infografías** | 4 tipos fijos | — | Pendiente |

## Las 16 plantillas de fichas

| Categoría | Plantilla | Estructura | Para |
|---|---|---|---|
| **Funcionales** (siguen los colores de la app, claro y oscuro) | Clásica · Tarjeta visual · Cornell · Compacta | propias | uso general, repaso, imprimir |
| **Infantiles** | **Aventura** | ruta | primaria: camino de paradas, burbujas de colores |
| | **Arcoíris** | mosaico | los más pequeños: bloques pastel con la inicial grande |
| **Por área** | **Naturaleza** | tarjeta | biología y ciencias naturales (números en forma de hoja) |
| | **Laboratorio** | mosaico | química (hexágonos, términos como casillas de la tabla periódica) |
| | **Cuaderno cuadriculado** | cuaderno | matemáticas (renglones, margen, marcador, notas adhesivas) |
| | **Plano técnico** | cornell | física e ingeniería (azul de plano, letra técnica) |
| | **Archivo histórico** | ruta | ciencias sociales (pergamino sepia, línea de tiempo con sellos) |
| | **Libro** | revista | lenguaje y literatura (capitular, dos columnas, cita) |
| **Estéticas** | **Editorial minimal** | revista | blanco y negro de revista |
| | **Neón** | mosaico | fondo oscuro con neón cian, rosa y violeta |
| | **Neobrutalista** | acordeón | bordes gruesos, sombras duras, colores planos |
| | **Aurora de cristal** | tarjeta | vidrio esmerilado sobre aurora violeta y turquesa |

## Cómo funciona

```
study_cards (datos) ──► FichaData ──► FichaList(template) ──┬─ funcional ──► componente propio (colores de la app)
                                          ▲                  └─ con tema  ──► ThemedFichas = estructura + tema
classrooms.ficha_template (migración 075) ┘   (id desconocido o ausente → "clasica")
```

- `src/lib/study/fichaTemplates.ts` — **catálogo** (puro): id, nombre, descripción, "ideal para", categoría, estructura y tema; y las fichas de ejemplo para las vistas previas.
- `src/lib/study/fichaThemes.ts` — **temas** (puro): paleta, tipografías, formas y fondo decorativo de cada uno, como variables `--f-*`. Cada par texto/fondo se declara en `pairs`.
- `src/components/study/fichas/ThemedLayouts.tsx` — las **7 estructuras** con tema: `tarjeta`, `mosaico`, `ruta`, `cuaderno`, `revista`, `cornell`, `acordeon`.
- `src/components/study/fichas/fichaThemes.css` — el CSS de esas estructuras. **No tiene colores propios**: todo sale de las variables del tema.
- `src/components/study/fichas/fichaFonts.ts` — las dos fuentes web (Baloo 2 y Playfair Display).
- `src/components/study/fichas/FichaViews.tsx` — las 4 plantillas funcionales y `FichaList`, que decide cuál usar.
- `src/components/study/fichas/FichaTemplatePicker.tsx` — el **selector del profesor**: galería por categorías con la miniatura real de cada plantilla (con sus fichas, o de ejemplo), vista previa completa y botón *Guardar*.
- `classrooms.ficha_template` — solo guarda el **id**. El CHECK valida la *forma* (`^[a-z][a-z0-9-]{0,31}$`), no una lista cerrada: **agregar una plantilla no necesita migración**.

### Decisiones de diseño (de la skill ui-ux-pro-max)

- **Temas autocontenidos:** traen su propio fondo y texto, así que se ven igual con la app en modo claro u oscuro (como una hoja o una pantalla sobre la página). Las 4 funcionales sí siguen el tema de la app.
- **Infantil:** Claymorphism (bordes de 3 px, sombras dobles, radios de 24–30 px, Baloo 2). Los temas infantiles son siempre claros.
- **Contraste:** todos los pares texto/fondo de todos los temas cumplen **4.5:1 (WCAG AA)**, y una prueba lo exige. El tema de vidrio mide contra el **peor caso** de la mezcla translúcida, no contra el fondo.
- **Fuentes:** solo dos web (Baloo 2 y Playfair Display), con `preload: false`: el navegador descarga una **solo cuando una ficha la usa**. El resto usa fuentes del sistema (cero costo).
- **Iconos:** una sola familia (lucide), decorativos (`aria-hidden`); nunca emojis.
- **Accesibilidad:** encabezados y listas reales, `<details>/<summary>` nativos, foco visible, `prefers-reduced-motion` y `@media print`.

## Agregar un tema (nuevo estilo con una estructura que ya existe)

1. En `fichaThemes.ts`, agrega una entrada a `THEME_TOKENS` con su paleta y formas. **Los pares de contraste se generan solos** y la prueba falla si alguno baja de 4.5:1.
2. En `fichaTemplates.ts`, agrega la plantilla a `FICHA_TEMPLATES` con `layout` y `theme`.
3. Listo: aparece en el selector con su vista previa. No hace falta tocar componentes ni CSS.

## Agregar una estructura nueva

1. Escribe el componente en `ThemedLayouts.tsx` (recibe `{ fichas }`) y regístralo en `LAYOUTS`; agrega su nombre al tipo `FichaLayout`.
2. Sus estilos van en `fichaThemes.css` **solo con variables `var(--f-*)`** (la prueba prohíbe hex, `rgb()` y nombres de color).

**Reglas que las pruebas exigen a toda plantilla**

- Muestra **todos** los campos de la ficha (título, idea, puntos, términos, reflexión) y **todas** las fichas, en orden.
- Funciona con una ficha **mínima** (sin extras) sin mostrar `undefined` ni columnas vacías.
- Los colores no están escritos en las clases: o son los del sistema o llegan como variables `--f-*`.
- Pasa todo el texto por `MathText` (LaTeX), con iconos decorativos y sin emojis.
- Sin scripts ni manejadores de eventos propios.

## Retirar una plantilla

Se quita del catálogo. Las clases que la tenían guardada la ven con la **Clásica** (un id desconocido nunca rompe la pantalla).

## Mapa de aprendizaje por clase

El mapa del estudiante ya no es un solo lienzo con todo: tiene **una sección por clase** (pestañas, si son varias), y cada una se pinta con la plantilla que eligió **el profesor de esa clase**. Los módulos sin clase van en *Módulos generales* con el mapa de islas de siempre; ningún módulo desaparece.

```
content_modules (classroom_id) ──► buildNodes ──► buildMapSections ──► MapSections (pestañas) ──► MapView(template)
                                                          ▲                                            ├─ islas   → LearningMap (el de siempre)
classrooms.map_template (migración 076) ─────────────────┘                                            └─ otras   → ThemedMap = estructura + tema
```

**4 estructuras** (no dependen de las posiciones que dejó la IA: recorren los módulos en un orden que respeta los prerrequisitos, así se ven bien aunque esas posiciones sean malas):

| Estructura | Qué es |
|---|---|
| `islas` | el mapa de siempre (lienzo con una isla por tema y las posiciones de la IA) |
| `camino` | camino que serpentea por filas (3 / 4 / 5 columnas según el ancho), recorre un tema completo antes del siguiente |
| `metro` | una línea por tema y una estación por módulo, con lo que cada uno requiere |
| `tablero` | tarjetas agrupadas por tema, con estado, dificultad y mejor puntaje |

**14 plantillas** = estructura + tema (los mismos 12 temas de las fichas, más `app`, que sigue los colores de la app en claro y oscuro): *Mapa de islas* y *Tablero* (funcionales); *Camino de aventura* y *Camino arcoíris* (infantiles); *Sendero del bosque*, *Laboratorio*, *Cuaderno cuadriculado*, *Línea técnica*, *Ruta del tiempo* y *Biblioteca* (por área); *Metro neón*, *Tablero neobrutalista*, *Camino de aurora* y *Metro editorial* (estéticas).

- `src/lib/map/` — **lógica pura**: `mapTemplates.ts` (catálogo), `mapLayouts.ts` (orden topológico, camino que serpentea, agrupación por tema), `mapSections.ts` (estado de cada módulo y reparto por clase), `mapThemes.ts` (los temas), `mapSamples.ts` (ejemplos para la vista previa).
- `src/components/map/ThemedMap.tsx` + `mapThemes.css` — las plantillas con tema. El CSS **no tiene colores propios** (una prueba lo exige).
- `src/components/map/MapTemplatePicker.tsx` — el selector del profesor, con la miniatura real de cada plantilla y vista previa completa **con los módulos de su clase** (con un avance simulado para ver todos los estados) o de ejemplo.
- `classrooms.map_template` — solo guarda el id; el CHECK valida la forma, **agregar una plantilla no necesita migración**. Un id desconocido o ausente usa `islas`.
- **Accesibilidad:** cada módulo es un botón con su estado en texto (`aria-label` y etiqueta visible); los bloqueados siguen siendo enfocables (`aria-disabled`) y Toñito explica por qué; pestañas con roles ARIA y flechas del teclado; foco visible; `prefers-reduced-motion`; sin emojis como iconos.

## Lo que falta (siguientes PR)

- **Datos extra para plantillas nuevas:** si una plantilla necesita algo que hoy no se genera (por ejemplo, un ejemplo o pistas propias), se amplía **una vez** el JSON que pide `buildStudyPrompt` con campos *opcionales y validados*; las plantillas lo muestran si existe y lo omiten si no.
