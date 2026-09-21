-- Nuevos metodos de extraccion de PDF: 'deterministic' y 'hybrid'.
--
-- La conversion de PDF a Markdown paso de "un modelo con vision lee todo el PDF" a un modelo HIBRIDO:
-- todas las paginas se convierten sin IA (titulos, listas, acentos, encabezados repetidos) y solo las
-- paginas con formulas ilegibles, imagenes, dibujos o tablas se mandan a un modelo con vision, cuya
-- respuesta se verifica automaticamente pagina por pagina (ver src/lib/materials/pdfToMarkdown.ts).
--
--   deterministic  sin IA, o la IA no aporto ninguna pagina verificada
--   hybrid         al menos una pagina transcrita por IA y verificada
--
-- Se CONSERVAN los valores anteriores (vision_gemini, vision_openrouter, vision_mixed, plain_text) porque
-- hay materiales ya procesados con ellos. Aditiva: no cambia ninguna fila.

ALTER TABLE public.teaching_materials
  DROP CONSTRAINT IF EXISTS teaching_materials_extraction_method_valid;

ALTER TABLE public.teaching_materials
  ADD CONSTRAINT teaching_materials_extraction_method_valid CHECK (
    extraction_method IS NULL
    OR extraction_method IN ('deterministic', 'hybrid', 'vision_gemini', 'vision_openrouter', 'vision_mixed', 'plain_text')
  );

COMMENT ON COLUMN public.teaching_materials.extraction_method IS
  'Como se extrajo el texto de un PDF: deterministic (sin IA) / hybrid (sin IA + paginas con formulas o graficos transcritas por un modelo con vision y verificadas) / vision_* y plain_text (metodos anteriores). NULL = anterior a la migracion 048 o no es PDF.';

NOTIFY pgrst, 'reload schema';
