import { describe, expect, it, vi } from 'vitest';
import { AUTO_RETRY_WAIT_MS, closeLesson, noticeFor, outcomeOf, type CloseDeps } from './saveOutcome';
import type { FinishOutcome } from './finishClient';

// Un servidor que responde en orden lo que se le diga, y registra cada paso para comprobar el ORDEN.
function setup(responses: (FinishOutcome | Error)[], over: Partial<CloseDeps> = {}) {
  const calls: string[] = [];
  let i = 0;
  let secs = 10;
  const deps: CloseDeps = {
    finish: vi.fn(async (_id: string, s: number) => {
      calls.push(`finish(${s})`);
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }),
    seconds: vi.fn(() => (secs += 5)), // cada lectura da un valor distinto: se nota si el reintento relee el reloj
    wait: vi.fn(async (ms: number) => void calls.push(`wait(${ms})`)),
    onSaved: vi.fn(async () => void calls.push('onSaved')),
    onError: vi.fn(),
    ...over,
  };
  return { deps, calls };
}

describe('outcomeOf', () => {
  it('ok -> guardado; rechazado -> sin registrar; no disponible -> reintentar', () => {
    expect(outcomeOf('ok')).toBe('saved');
    expect(outcomeOf('rejected')).toBe('unrecorded');
    expect(outcomeOf('unavailable')).toBe('retry');
  });
});

describe('noticeFor: que se le muestra al estudiante', () => {
  it('guardado: nada que avisar', () => {
    expect(noticeFor('saved')).toBeNull();
  });
  it('reintentar: aviso CON boton de reintento', () => {
    expect(noticeFor('retry')).toEqual({ canRetry: true });
  });
  it('sin registrar: aviso SIN boton (reintentar no ayuda)', () => {
    expect(noticeFor('unrecorded')).toEqual({ canRetry: false });
  });
});

describe('closeLesson', () => {
  it('sin intento en el servidor: no hay nada que cerrar y ni se llama al servidor', async () => {
    const { deps } = setup(['ok']);
    expect(await closeLesson(null, deps)).toBe('unrecorded');
    expect(deps.finish).not.toHaveBeenCalled();
    expect(deps.onSaved).not.toHaveBeenCalled();
  });
  it('un id vacio tampoco', async () => {
    const { deps } = setup(['ok']);
    expect(await closeLesson('', deps)).toBe('unrecorded');
    expect(deps.finish).not.toHaveBeenCalled();
  });
  it('cierre correcto: guardado, una sola llamada con el intento y los segundos, y DESPUES se ejecuta onSaved', async () => {
    const { deps, calls } = setup(['ok']);
    expect(await closeLesson('att-1', deps)).toBe('saved');
    expect(deps.finish).toHaveBeenCalledTimes(1);
    expect(deps.finish).toHaveBeenCalledWith('att-1', 15);
    expect(deps.wait).not.toHaveBeenCalled();
    expect(calls).toEqual(['finish(15)', 'onSaved']);
  });
  it('el servidor lo rechaza: sin registrar, sin reintento y SIN ejecutar onSaved', async () => {
    const { deps } = setup(['rejected']);
    expect(await closeLesson('att-1', deps)).toBe('unrecorded');
    expect(deps.finish).toHaveBeenCalledTimes(1);
    expect(deps.wait).not.toHaveBeenCalled();
    expect(deps.onSaved).not.toHaveBeenCalled();
  });
  it('no disponible y luego bien: UN reintento automatico tras esperar, releyendo el reloj, y queda guardado', async () => {
    const { deps, calls } = setup(['unavailable', 'ok']);
    expect(await closeLesson('att-1', deps)).toBe('saved');
    expect(deps.finish).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(['finish(15)', `wait(${AUTO_RETRY_WAIT_MS})`, 'finish(20)', 'onSaved']);
  });
  it('no disponible dos veces: reintentar (y no se ejecuta onSaved ni se reintenta una tercera vez)', async () => {
    const { deps } = setup(['unavailable', 'unavailable', 'ok']);
    expect(await closeLesson('att-1', deps)).toBe('retry');
    expect(deps.finish).toHaveBeenCalledTimes(2);
    expect(deps.onSaved).not.toHaveBeenCalled();
  });
  it('no disponible y luego rechazado: sin registrar (el reintento cambia la conclusion)', async () => {
    const { deps } = setup(['unavailable', 'rejected']);
    expect(await closeLesson('att-1', deps)).toBe('unrecorded');
    expect(deps.onSaved).not.toHaveBeenCalled();
  });
  it('si la llamada LANZA: reintentar, y se avisa del error', async () => {
    const boom = new Error('red caida');
    const { deps } = setup([boom]);
    expect(await closeLesson('att-1', deps)).toBe('retry');
    expect(deps.onError).toHaveBeenCalledWith(boom);
    expect(deps.onSaved).not.toHaveBeenCalled();
  });
  it('si lanza en el reintento: reintentar', async () => {
    const { deps } = setup(['unavailable', new Error('otra vez')]);
    expect(await closeLesson('att-1', deps)).toBe('retry');
    expect(deps.onError).toHaveBeenCalledTimes(1);
  });
  it('un fallo al evaluar logros NO convierte un resultado guardado en "no guardado"', async () => {
    const onSaved = vi.fn(async () => {
      throw new Error('logros caidos');
    });
    const { deps } = setup(['ok'], { onSaved });
    expect(await closeLesson('att-1', deps)).toBe('saved');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(deps.onError).toHaveBeenCalledTimes(1);
  });
  it('sin onSaved ni onError tambien funciona (y no se rompe al fallar)', async () => {
    const { deps } = setup(['ok'], { onSaved: undefined, onError: undefined });
    expect(await closeLesson('att-1', deps)).toBe('saved');
    const { deps: d2 } = setup([new Error('x')], { onSaved: undefined, onError: undefined });
    expect(await closeLesson('att-1', d2)).toBe('retry');
  });
  it('la espera del reintento automatico es la acordada (1,2 s)', () => {
    expect(AUTO_RETRY_WAIT_MS).toBe(1200);
  });
});
