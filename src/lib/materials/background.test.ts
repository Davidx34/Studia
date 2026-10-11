import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runInBackground } from '@/lib/server/background';
import { isStalledProcessing } from './processingState';
import { hasActiveProcessing } from '@/hooks/usePollingMaterials';
import { PROCESSING_STALE_MS } from '@/lib/security/materialGuards';

const NOW = new Date('2026-10-11T12:00:00Z').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('runInBackground', () => {
  it('entrega la promesa a waitUntil para que la plataforma la mantenga viva', async () => {
    const wait = vi.fn();
    runInBackground(Promise.resolve(1), wait);
    expect(wait).toHaveBeenCalledTimes(1);
    await expect(wait.mock.calls[0][0]).resolves.toBe(1);
  });

  it('un fallo del trabajo se registra y NO revienta ni queda sin manejar', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wait = vi.fn();
    runInBackground(Promise.reject(new Error('boom')), wait);
    await wait.mock.calls[0][0];
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('si waitUntil no existe (desarrollo local) no lanza', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      runInBackground(Promise.resolve(), () => {
        throw new Error('sin contexto');
      })
    ).not.toThrow();
    warn.mockRestore();
  });
});

describe('isStalledProcessing', () => {
  it('un procesamiento reciente no esta interrumpido', () => {
    expect(isStalledProcessing('processing', ago(60_000), NOW)).toBe(false);
    expect(isStalledProcessing('pending', ago(PROCESSING_STALE_MS - 1000), NOW)).toBe(false);
  });

  it('pasado el limite, pending y processing se dan por interrumpidos', () => {
    expect(isStalledProcessing('processing', ago(PROCESSING_STALE_MS + 1000), NOW)).toBe(true);
    expect(isStalledProcessing('pending', ago(PROCESSING_STALE_MS + 1000), NOW)).toBe(true);
  });

  it('completed y failed nunca; sin marca de inicio no se afirma nada', () => {
    expect(isStalledProcessing('completed', ago(PROCESSING_STALE_MS * 5), NOW)).toBe(false);
    expect(isStalledProcessing('failed', ago(PROCESSING_STALE_MS * 5), NOW)).toBe(false);
    expect(isStalledProcessing('processing', null, NOW)).toBe(false);
    expect(isStalledProcessing('processing', 'no es fecha', NOW)).toBe(false);
  });
});

describe('hasActiveProcessing (cuando sigue consultando la lista)', () => {
  const m = (status: string, started: string | null) => ({ processing_status: status, processing_started_at: started }) as any;

  it('hay algo en curso -> sigue consultando', () => {
    expect(hasActiveProcessing([m('completed', null), m('processing', ago(30_000))], NOW)).toBe(true);
  });

  it('todo terminado -> para', () => {
    expect(hasActiveProcessing([m('completed', null), m('failed', ago(1000))], NOW)).toBe(false);
  });

  it('lo interrumpido no mantiene la consulta viva para siempre', () => {
    expect(hasActiveProcessing([m('processing', ago(PROCESSING_STALE_MS + 5000))], NOW)).toBe(false);
  });
});

describe('integracion', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

  it('subir o reprocesar un PDF ya no espera la conversion: la lanza en segundo plano con la llave de servicio', () => {
    const src = read('src/lib/actions/materials.ts');
    // Con llave de servicio: segundo plano. Solo SIN ella (entorno mal configurado) se espera en la peticion, como antes.
    expect(src.match(/await processPdfMaterial\(/g)!.length).toBe(2);
    expect(src.match(/if \(hasServiceRoleKey\(\)\) runInBackground\(/g)!.length).toBe(2);
    expect(src.match(/runInBackground\(processPdfMaterial\(createAdminSupabase\(\)/g)!.length).toBe(2);
  });

  it('el polling se reprograma siempre mientras haya algo activo (antes se detenia si nada cambiaba)', () => {
    const src = read('src/hooks/usePollingMaterials.ts');
    expect(src).toContain('schedule();');
    expect(src).toContain('setNow(Date.now())');
    // el efecto de polling ya no depende de `materials` (cada cambio lo reiniciaba y solo asi se programaba el siguiente)
    expect(src).toMatch(/\}, \[isPolling, classroomId\]\);/);
  });

  it('la lista de materiales se sincroniza con lo que entrega router.refresh()', () => {
    expect(read('src/hooks/usePollingMaterials.ts')).toContain('setMaterials(initialMaterials)');
  });
});
