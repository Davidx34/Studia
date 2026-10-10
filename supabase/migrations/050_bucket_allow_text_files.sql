-- Permite subir archivos Markdown (.md) y texto (.txt) al bucket de materiales.
-- Se procesan sin IA (src/lib/materials/processTextFile.ts). Aditiva: conserva los tipos anteriores.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/msword',
     'application/vnd.ms-excel',
     'text/markdown',
     'text/plain'
   ]
 WHERE id = 'teaching-materials';
