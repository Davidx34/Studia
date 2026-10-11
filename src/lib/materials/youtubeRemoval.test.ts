import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// YouTube se elimino por decision del proyecto (rinde 1-3 fragmentos por video y falla ~1 de cada 4). Estas pruebas
// evitan que vuelva a colarse y fijan la via recomendada: NotebookLM -> Markdown.
const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

describe('YouTube eliminado', () => {
  it('no quedan el procesador, el cron ni la dependencia', () => {
    expect(exists('src/lib/materials/processYoutube.ts')).toBe(false);
    expect(exists('src/app/api/cron/retry-youtube-materials/route.ts')).toBe(false);
    expect(read('package.json')).not.toContain('youtubei.js');
  });

  it('las acciones ya no crean ni reprocesan videos', () => {
    const src = read('src/lib/actions/materials.ts');
    expect(src).not.toMatch(/addYoutubeMaterial|processYoutubeMaterial|extractYoutubeId/);
    expect(src).toContain('addLinkMaterial');
    expect(src).toContain('addNotebookLMMaterial');
  });

  it('la biblioteca del estudiante no incrusta videos de YouTube', () => {
    expect(read('src/app/(student)/my-classes/[id]/library/LibraryClient.tsx')).not.toMatch(/youtube/i);
  });

  it('la migracion 061 retira la tarea programada y NO borra datos', () => {
    const sql = read('supabase/migrations/061_remove_youtube_retry_cron.sql')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(sql).toContain("cron.unschedule('retry-youtube-materials')");
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});

describe('NotebookLM primero', () => {
  const src = read('src/app/(teacher)/teacher/classrooms/[id]/materials/MaterialUploader.tsx');

  it('es la primera pestaña, la que abre por defecto y esta marcada como recomendada', () => {
    expect(src).toContain("useState<UploadTab>('notebooklm')");
    expect(src.indexOf("id: 'notebooklm'")).toBeLessThan(src.indexOf("id: 'file'"));
    expect(src.indexOf("id: 'file'")).toBeLessThan(src.indexOf("id: 'link'"));
    expect(src).toContain("hint: 'Recomendado'");
  });

  it('explica el paso a paso y que tambien se puede subir como .md', () => {
    expect(src).toContain('Crea un cuaderno en NotebookLM');
    expect(src).toContain('resumen detallado en Markdown');
    expect(src).toContain('.md');
  });

  it('ya no hay pestaña de YouTube', () => {
    expect(src).not.toMatch(/youtube/i);
  });
});
