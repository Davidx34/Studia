# Plantillas del material de estudio

El **profesor** elige cómo se muestra el material de estudio de su clase. La IA **no escribe HTML ni estilos**: genera *datos* (título, idea principal, puntos clave…) que el código valida contra el material, y cada plantilla es un componente de la app que los pinta.

**Por qué así**

- Cambiar de plantilla es instantáneo y **no cuesta ninguna llamada a la IA**; el contenido no se toca.
- Todas heredan el modo claro/oscuro, las fórmulas LaTeX y la accesibilidad (listas y encabezados reales, tamaño de toque, `prefers-reduced-motion`).
- El contenido se sigue verificando contra el material (cifras y términos deben salir de él), cosa imposible si la IA escribiera el HTML.
- Sin riesgo de inyección: nunca se pinta HTML generado por el modelo.

## Estado

| Superficie | Plantillas | Dónde se elige | Estado |
|---|---|---|---|
| **Fichas de lectura** | Clásica, Tarjeta visual, Cornell, Compacta | Panel del profesor → *Material de estudio* → *Plantilla de las fichas de lectura* | Hecho |
| **Mapa de módulos** | — | — | Pendiente (hoy el mapa es del estudiante, no de la clase) |
| **Infografías** | 4 tipos fijos | — | Pendiente |

## Cómo funciona (fichas)

```
study_cards (datos) ──► FichaData ──► FichaList(template) ──► plantilla elegida
                                          ▲
classrooms.ficha_template (migración 075) ┘   (id desconocido o ausente → "clasica")
```

- `src/lib/study/fichaTemplates.ts` — **catálogo** (puro, sin React): id, nombre, descripción, "ideal para", y fichas de ejemplo para las vistas previas.
- `src/components/study/fichas/FichaViews.tsx` — los **componentes** de cada plantilla y `FichaList`.
- `src/components/study/fichas/FichaTemplatePicker.tsx` — el **selector del profesor**: miniatura real de cada plantilla con sus propias fichas (o de ejemplo si aún no generó), vista previa completa y botón *Guardar*.
- `classrooms.ficha_template` — solo guarda el **id**. El CHECK valida la *forma* del id (`^[a-z][a-z0-9-]{0,31}$`), no una lista cerrada: **agregar una plantilla no necesita migración**.

## Agregar una plantilla de fichas

1. En `fichaTemplates.ts`, agrega una entrada a `FICHA_TEMPLATES` (`id` en minúsculas y guiones, `name`, `description`, `bestFor`).
2. En `FichaViews.tsx`, escribe el componente (recibe `{ fichas: FichaData[] }`) y regístralo en `VIEWS`. TypeScript avisa si falta.
3. Listo: aparece en el selector con su vista previa. Las pruebas (`fichas.test.ts`) la revisan solas.

**Reglas que las pruebas exigen a toda plantilla**

- Muestra **todos** los campos de la ficha (título, idea, puntos, términos, reflexión) y **todas** las fichas, en orden.
- Funciona con una ficha **mínima** (sin extras) sin mostrar `undefined` ni columnas vacías.
- Usa **solo colores semánticos** (`bg-surface`, `text-fg`, `border-line`, `bg-primary/10`…): nada de hex ni colores de Tailwind a mano, para que siga el tema.
- Pasa todo el texto por `MathText` (LaTeX) y usa listas/encabezados reales.
- Sin scripts ni manejadores de eventos propios.

## Retirar una plantilla

Se quita del catálogo. Las clases que la tenían guardada la ven con la **Clásica** (un id desconocido nunca rompe la pantalla).

## Lo que falta (siguientes PR)

- **Mapa:** las posiciones (`map_position_x/y`) y las categorías son del módulo, y el mapa muestra los módulos de *todas* las clases del estudiante. Para que el profesor elija su plantilla, el mapa tiene que pasar a ser **por clase**.
- **Datos extra para plantillas nuevas:** si una plantilla necesita algo que hoy no se genera (por ejemplo, un ejemplo o pistas propias), se amplía **una vez** el JSON que pide `buildStudyPrompt` con campos *opcionales y validados*; las plantillas lo muestran si existe y lo omiten si no.
