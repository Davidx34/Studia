import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  canStartProcessing,
  claimProcessing,
  validateUploadInput,
  MAX_PDF_PAGES,
  MAX_CHUNKS_PER_MATERIAL,
  MIN_REPROCESS_INTERVAL_MS,
  PROCESSING_STALE_MS,
} from './materialGuards';

const CLASS = '11111111-2222-3333-4444-555555555555';
const base = { classroomId: CLASS, storagePath: `${CLASS}/1700000000000_apuntes.pdf`, filename: 'apuntes.pdf', mimeType: 'application/pdf', sizeBytes: 5000 };

describe('validateUploadInput', () => {
  it('acepta una subida normal', () => {
    expect(validateUploadInput(base)).toEqual({ ok: true });
    expect(validateUploadInput({ ...base, storagePath: `${CLASS}/1_guia.md`, filename: 'guia.md', mimeType: 'text/markdown' }).ok).toBe(true);
  });

  it('REGRESION: la ruta de OTRA clase se rechaza (antes se guardaba tal cual)', () => {
    const other = '99999999-2222-3333-4444-555555555555';
    expect(validateUploadInput({ ...base, storagePath: `${other}/1_a.pdf` }).ok).toBe(false);
  });

  it.each([
    `${CLASS}/../otra/archivo.pdf`,
    `${CLASS}/sub/archivo.pdf`,
    `${CLASS}/..\\archivo.pdf`,
    `${CLASS}/`,
    `/${CLASS}/archivo.pdf`,
    `${CLASS}/${'a'.repeat(300)}.pdf`,
  ])('rechaza la ruta %s', (storagePath) => {
    expect(validateUploadInput({ ...base, storagePath }).ok).toBe(false);
  });

  it('el tipo declarado debe coincidir con la extension', () => {
    expect(validateUploadInput({ ...base, filename: 'virus.exe' }).ok).toBe(false);
    expect(validateUploadInput({ ...base, filename: 'archivo.docx' }).ok).toBe(false); // dice PDF pero es docx
    expect(validateUploadInput({ ...base, filename: 'notas.txt', mimeType: 'text/markdown' }).ok).toBe(true); // ambos son texto
  });

  it('rechaza tipos no permitidos, vacios, enormes y nombres absurdos', () => {
    expect(validateUploadInput({ ...base, mimeType: 'application/x-msdownload' }).ok).toBe(false);
    expect(validateUploadInput({ ...base, sizeBytes: 0 }).ok).toBe(false);
    expect(validateUploadInput({ ...base, sizeBytes: 11 * 1024 * 1024 }).ok).toBe(false);
    expect(validateUploadInput({ ...base, sizeBytes: NaN }).ok).toBe(false);
    expect(validateUploadInput({ ...base, filename: 'a'.repeat(201) + '.pdf' }).ok).toBe(false);
    expect(validateUploadInput({ ...base, classroomId: 'no-es-un-uuid' }).ok).toBe(false);
  });
});

describe('canStartProcessing', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('un material nunca procesado se puede procesar', () => {
    expect(canStartProcessing('pending', null, now).ok).toBe(true);
    expect(canStartProcessing(null, undefined, now).ok).toBe(true);
  });

  it('REGRESION: no se reprocesa mientras ya se esta procesando', () => {
    const d = canStartProcessing('processing', ago(30_000), now);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/ya se esta procesando/);
  });

  it('un procesamiento atascado (mas de 5 min) no bloquea para siempre', () => {
    expect(canStartProcessing('processing', ago(PROCESSING_STALE_MS + 1000), now).ok).toBe(true);
  });

  it('no se repite en bucle: un minuto de espera entre procesamientos de un mismo material', () => {
    const d = canStartProcessing('completed', ago(10_000), now);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/50 s/);
    expect(canStartProcessing('completed', ago(MIN_REPROCESS_INTERVAL_MS + 1000), now).ok).toBe(true);
    expect(canStartProcessing('failed', ago(MIN_REPROCESS_INTERVAL_MS + 1000), now).ok).toBe(true);
  });

  it('una fecha ilegible o futura no bloquea', () => {
    expect(canStartProcessing('completed', 'basura', now).ok).toBe(true);
    expect(canStartProcessing('completed', new Date(now + 99_000).toISOString(), now).ok).toBe(true);
  });
});

// Supabase simulado para claimProcessing.
function fakeSupabase(row: { processing_status: string; processing_started_at: string | null } | null, updateReturns: any[]) {
  const calls: string[] = [];
  const chain = (kind: string): any => {
    const q: any = {
      eq: (c: string, v: any) => (calls.push(`${kind}.eq(${c},${v})`), q),
      is: (c: string, v: any) => (calls.push(`${kind}.is(${c},${v})`), q),
      single: async () => ({ data: row, error: row ? null : { message: 'no' } }),
      select: async () => ({ data: updateReturns, error: null }),
    };
    return q;
  };
  return {
    calls,
    from: () => ({ select: () => chain('sel'), update: () => chain('upd') }),
  };
}

describe('claimProcessing', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');

  it('reclama con compare-and-set sobre processing_started_at', async () => {
    const started = new Date(now - 10 * 60_000).toISOString();
    const sb = fakeSupabase({ processing_status: 'completed', processing_started_at: started }, [{ id: 'm1' }]);
    expect(await claimProcessing(sb, 'm1', now)).toEqual({ ok: true });
    expect(sb.calls).toContain(`upd.eq(processing_started_at,${started})`);
  });

  it('sin marca previa exige que siga siendo nula', async () => {
    const sb = fakeSupabase({ processing_status: 'pending', processing_started_at: null }, [{ id: 'm1' }]);
    await claimProcessing(sb, 'm1', now);
    expect(sb.calls).toContain('upd.is(processing_started_at,null)');
  });

  it('REGRESION: si otra peticion gano la carrera (0 filas actualizadas) no procesa', async () => {
    const sb = fakeSupabase({ processing_status: 'completed', processing_started_at: null }, []);
    expect((await claimProcessing(sb, 'm1', now)).ok).toBe(false);
  });

  it('un material ajeno o inexistente no se reclama', async () => {
    expect((await claimProcessing(fakeSupabase(null, []), 'm1', now)).ok).toBe(false);
  });

  it('si el estado dice que ya se procesa, ni intenta escribir', async () => {
    const sb = fakeSupabase({ processing_status: 'processing', processing_started_at: new Date(now - 5000).toISOString() }, [{ id: 'm1' }]);
    expect((await claimProcessing(sb, 'm1', now)).ok).toBe(false);
    expect(sb.calls.filter((c) => c.startsWith('upd'))).toEqual([]);
  });
});

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

describe('cableado', () => {
  it('los topes son razonables frente a los materiales reales', () => {
    expect(MAX_PDF_PAGES).toBeGreaterThanOrEqual(100);
    expect(MAX_CHUNKS_PER_MATERIAL).toBeGreaterThanOrEqual(100);
  });

  it('scrapeLink descarga con safeFetch, no con fetch directo', () => {
    const src = read('src/lib/materials/processLink.ts');
    expect(src).toContain('safeFetch(');
    expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/\bfetch\(/);
  });

  it('addLinkMaterial valida la URL antes de registrar nada', () => {
    const src = read('src/lib/actions/materials.ts');
    expect(src).toMatch(/parseSafeUrl\(url\)[\s\S]*from\('teaching_materials'\)[\s\S]*source_type: 'link'/);
  });

  it('confirmMaterialUpload valida la ruta, el tipo y el tamaño real antes de insertar', () => {
    const src = read('src/lib/actions/materials.ts');
    const fn = src.slice(src.indexOf('export async function confirmMaterialUpload'), src.indexOf('export async function addLinkMaterial'));
    expect(fn.indexOf('validateUploadInput(')).toBeGreaterThan(-1);
    expect(fn.indexOf('validateUploadInput(')).toBeLessThan(fn.indexOf(".from('teaching_materials')"));
    expect(fn).toContain('size_bytes: realSize');
  });

  it('reprocesar reclama el procesamiento antes de gastar cuota', () => {
    const src = read('src/lib/actions/materials.ts');
    const fn = src.slice(src.indexOf('export async function reprocessMaterial'));
    expect(fn.indexOf('claimProcessing(')).toBeGreaterThan(-1);
    expect(fn.indexOf('claimProcessing(')).toBeLessThan(fn.indexOf('processPdfMaterial('));
  });

  it('el PDF y el texto tienen topes antes de gastar cuota', () => {
    expect(read('src/lib/materials/pdfExtract.ts')).toContain('MAX_PDF_PAGES');
    expect(read('src/lib/materials/textProcessing.ts')).toContain('MAX_CHUNKS_PER_MATERIAL');
  });

  it('la migracion 054 exige que el correo reclamado sea el de la cuenta', () => {
    const sql = read('supabase/migrations/054_security_pending_registration_and_processing.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/FROM auth\.users u WHERE u\.id = auth\.uid\(\)/);
    expect(sql).toMatch(/v_account_email <> lower\(trim\(p_email\)\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_pending_registration\(text\) FROM PUBLIC, anon/);
  });
});
