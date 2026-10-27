-- Colores de los bordes de cada clip de cinematica, para que la escena pinte de fondo lo mismo que el clip trae en sus bordes.
--
-- Problema: el clip de celebracion es vertical (9:16). En un computador se muestra entero y centrado, y su fondo es mas palido que el degradado de la escena, asi que se
-- veia como una columna distinta de los lados ("se ve cortado"). Flow no clava el color que se le pide; en vez de pedirlo mejor, se MIDE al publicar el clip
-- (npm run clip:publish / npm run clip:colors) y se guarda aqui.
--
-- bg_colors = 6 colores #rrggbb en minusculas: izquierda arriba/medio/abajo y derecha arriba/medio/abajo. NULL = la escena usa su degradado de siempre.
-- El CHECK impide guardar algo que no sea exactamente eso (nunca CSS suelto): la app pinta estos valores con `background: linear-gradient(...)`.
--
-- Orden de despliegue: el codigo funciona SIN esta migracion (la app lee todas las columnas y, si no esta bg_colors, usa el degradado de siempre), asi que puede
-- aplicarse antes o despues del PR. Despues de aplicarla hay que rellenar el clip que ya existe: npm run clip:colors -- --scene module_complete_good --aplicar

ALTER TABLE public.tonito_scene_clips
  ADD COLUMN IF NOT EXISTS bg_colors text[];

ALTER TABLE public.tonito_scene_clips
  DROP CONSTRAINT IF EXISTS tonito_scene_clips_bg_colors_check;

ALTER TABLE public.tonito_scene_clips
  ADD CONSTRAINT tonito_scene_clips_bg_colors_check CHECK (
    bg_colors IS NULL OR (
      cardinality(bg_colors) = 6
      AND bg_colors[1] ~ '^#[0-9a-f]{6}$' AND bg_colors[2] ~ '^#[0-9a-f]{6}$' AND bg_colors[3] ~ '^#[0-9a-f]{6}$'
      AND bg_colors[4] ~ '^#[0-9a-f]{6}$' AND bg_colors[5] ~ '^#[0-9a-f]{6}$' AND bg_colors[6] ~ '^#[0-9a-f]{6}$'
    )
  );
