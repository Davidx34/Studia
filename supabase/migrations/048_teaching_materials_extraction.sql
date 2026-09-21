-- Como se extrajo el texto de un material y con que calidad.
--
-- Por que existe: un PDF subido se leia con extraccion de texto simple (unpdf) y el resultado
-- se troceaba sin ninguna pista de lo que se habia perdido. En las 7 presentaciones reales de
-- Microeconomia I (diapositivas, casi todas con las paginas rotadas 90 grados) entre 0,1 % y
-- 8,7 % del texto eran caracteres basura, es decir formulas, y los graficos no aparecian. Ese
-- material se borraba en silencio en la sanitizacion.
--
-- Ahora un PDF se transcribe a Markdown con un modelo con vision (formulas en LaTeX, graficos
-- descritos) y solo se usa el resultado si pasa un control de calidad; si no, se cae al texto
-- simple. Estas dos columnas guardan que camino se uso y por que, para que el profesor lo vea.
--
--   extraction_method  'vision_gemini' | 'vision_openrouter' | 'vision_mixed' | 'plain_text'
--                      NULL en los materiales anteriores y en los que no son PDF.
--   extraction_report  paginas, paginas transcritas, palabras conservadas, tokens, advertencias...
--
-- Aditiva y nullable: no cambia nada de lo existente.

ALTER TABLE public.teaching_materials
  ADD COLUMN IF NOT EXISTS extraction_method text,
  ADD COLUMN IF NOT EXISTS extraction_report jsonb;

ALTER TABLE public.teaching_materials
  DROP CONSTRAINT IF EXISTS teaching_materials_extraction_method_valid;

ALTER TABLE public.teaching_materials
  ADD CONSTRAINT teaching_materials_extraction_method_valid CHECK (
    extraction_method IS NULL
    OR extraction_method IN ('vision_gemini', 'vision_openrouter', 'vision_mixed', 'plain_text')
  );

COMMENT ON COLUMN public.teaching_materials.extraction_method IS
  'Como se extrajo el texto: vision_gemini / vision_openrouter / vision_mixed (PDF transcrito a Markdown por un modelo con vision) o plain_text (texto simple). NULL = anterior a la migracion 048 o no es PDF.';
COMMENT ON COLUMN public.teaching_materials.extraction_report IS
  'Informe de la extraccion (paginas, paginas transcritas, palabras conservadas, tokens, advertencias). Ver src/lib/materials/pdfToMarkdown.ts.';

NOTIFY pgrst, 'reload schema';
