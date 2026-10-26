import { describe, it, expect } from 'vitest';
import { DEFAULT_MODELS, aiProfile, geminiModel, geminiModels, thinkingConfigFor } from './geminiModels';
import { PAID_HEADS, DEFAULT_CHAINS, chainFor, defaultChain, providerById, PROVIDERS } from './gateway/providers';
import { formatUsageLine } from './gateway/router';

describe('aiProfile', () => {
  it('es free salvo que AI_PROFILE sea paid (sin importar mayusculas ni espacios)', () => {
    expect(aiProfile({})).toBe('free');
    expect(aiProfile({ AI_PROFILE: 'paid' })).toBe('paid');
    expect(aiProfile({ AI_PROFILE: '  PAID ' })).toBe('paid');
    expect(aiProfile({ AI_PROFILE: 'premium' })).toBe('free');
    expect(aiProfile({ AI_PROFILE: '' })).toBe('free');
  });
});

describe('geminiModels', () => {
  it('por defecto (free) deja exactamente los modelos de siempre', () => {
    expect(geminiModels('judge', {})).toEqual(['gemini-2.5-flash']);
    expect(geminiModels('chunks', {})).toEqual(['gemini-2.5-flash']);
    expect(geminiModels('topics', {})).toEqual(['gemini-2.5-flash']);
    expect(geminiModels('pdf', {})).toEqual(['gemini-2.5-flash-lite', 'gemini-2.5-flash']);
  });

  it('con AI_PROFILE=paid usa Gemini 3.5 (juez en el 3.5 Flash, el resto en el Lite)', () => {
    const env = { AI_PROFILE: 'paid' };
    expect(geminiModel('judge', env)).toBe('gemini-3.5-flash');
    expect(geminiModel('chunks', env)).toBe('gemini-3.5-flash-lite');
    expect(geminiModel('topics', env)).toBe('gemini-3.5-flash-lite');
    expect(geminiModels('pdf', env)[0]).toBe('gemini-3.5-flash-lite');
  });

  it('una variable por papel manda sobre el perfil y admite lista con comas', () => {
    expect(geminiModels('judge', { AI_PROFILE: 'paid', GEMINI_MODEL_JUDGE: 'gemini-3.5-flash-lite' })).toEqual(['gemini-3.5-flash-lite']);
    expect(geminiModels('pdf', { GEMINI_MODEL_PDF: ' a , b ,, c' })).toEqual(['a', 'b', 'c']);
  });

  it('GEMINI_PDF_MODELS (la variable de antes) sigue valiendo para el PDF, y GEMINI_MODEL_PDF gana', () => {
    expect(geminiModels('pdf', { GEMINI_PDF_MODELS: 'x,y' })).toEqual(['x', 'y']);
    expect(geminiModels('pdf', { GEMINI_PDF_MODELS: 'x,y', GEMINI_MODEL_PDF: 'z' })).toEqual(['z']);
  });

  it('todos los papeles tienen al menos un modelo en los dos perfiles', () => {
    for (const profile of ['free', 'paid'] as const) {
      for (const list of Object.values(DEFAULT_MODELS[profile])) expect(list.length).toBeGreaterThan(0);
    }
  });
});

describe('thinkingConfigFor (cada familia lo pide distinto y pedirlo mal da HTTP 400)', () => {
  it('2.5: thinkingBudget 0', () => {
    expect(thinkingConfigFor('gemini-2.5-flash')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(thinkingConfigFor('gemini-2.5-flash-lite')).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });
  it('3.5 Flash: thinkingLevel minimal', () => {
    expect(thinkingConfigFor('gemini-3.5-flash')).toEqual({ thinkingConfig: { thinkingLevel: 'minimal' } });
  });
  it('3.5 Flash-Lite: NADA (thinkingBudget 0 le da 400 en la llave del proyecto)', () => {
    expect(thinkingConfigFor('gemini-3.5-flash-lite')).toEqual({});
  });
  it('un modelo desconocido: nada (siempre es una peticion valida)', () => {
    for (const m of ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'otro', '']) expect(thinkingConfigFor(m)).toEqual({});
  });
});

describe('perfil paid en las cadenas de la pasarela', () => {
  const full = { GEMINI_API_KEY: 'k', GROQ_API_KEY: 'k' };

  it('free: las cadenas son las de siempre', () => {
    for (const task of ['generation', 'judge', 'analysis', 'study'] as const) expect(defaultChain(task, {})).toEqual(DEFAULT_CHAINS[task]);
  });

  it('paid: gemini 3.5 va primero y el resto queda de respaldo', () => {
    for (const task of ['generation', 'analysis', 'study'] as const) {
      const chain = defaultChain(task, { AI_PROFILE: 'paid' });
      expect(chain[0]).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash-lite' });
      expect(chain.length).toBeGreaterThan(PAID_HEADS[task].length);
    }
    expect(defaultChain('judge', { AI_PROFILE: 'paid' })[0]).toEqual({ provider: 'gemini', model: 'gemini-3.5-flash' });
  });

  it('paid no duplica candidatos', () => {
    for (const task of ['generation', 'judge', 'analysis', 'study'] as const) {
      const keys = defaultChain(task, { AI_PROFILE: 'paid' }).map((c) => `${c.provider}:${c.model}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('chainFor: solo proveedores con llave; paid sin llave de Gemini queda como free', () => {
    expect(chainFor('generation', { AI_PROFILE: 'paid', ...full })[0].provider).toBe('gemini');
    expect(chainFor('generation', { AI_PROFILE: 'paid', GROQ_API_KEY: 'k' })[0].provider).toBe('groq');
  });

  it('AI_CHAIN_<TAREA> sigue mandando sobre el perfil', () => {
    const chain = chainFor('generation', { AI_PROFILE: 'paid', ...full, AI_CHAIN_GENERATION: 'groq:openai/gpt-oss-120b' });
    expect(chain).toEqual([{ provider: 'groq', model: 'openai/gpt-oss-120b' }]);
  });

  it('los candidatos de paid apuntan a proveedores que existen', () => {
    for (const heads of Object.values(PAID_HEADS)) for (const c of heads) expect(providerById(c.provider), c.provider).toBeDefined();
  });
});

describe('proveedor moonshot (Kimi)', () => {
  it('esta en el catalogo, es de pago, y NO entra en ninguna cadena por defecto', () => {
    const p = providerById('moonshot');
    expect(p?.keyEnv).toBe('MOONSHOT_API_KEY');
    expect(p?.tier).toBe('paid');
    expect(p?.baseUrl.startsWith('https://')).toBe(true);
    for (const chain of Object.values(DEFAULT_CHAINS)) expect(chain.some((c) => c.provider === 'moonshot')).toBe(false);
    for (const chain of Object.values(PAID_HEADS)) expect(chain.some((c) => c.provider === 'moonshot')).toBe(false);
  });

  it('con llave y AI_CHAIN, entra en la cadena', () => {
    const chain = chainFor('generation', { MOONSHOT_API_KEY: 'k', AI_CHAIN_GENERATION: 'moonshot:modelo-x' });
    expect(chain).toEqual([{ provider: 'moonshot', model: 'modelo-x' }]);
  });

  it('los ids de proveedor siguen siendo unicos', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('formatUsageLine', () => {
  it('lleva tarea, modelo, tiempo y tokens, y nada del contenido', () => {
    expect(formatUsageLine('generation', { provider: 'gemini', model: 'gemini-3.5-flash-lite' }, 1234, { prompt: 900, completion: 1100 })).toBe(
      '[AI_USAGE] task=generation model=gemini/gemini-3.5-flash-lite ms=1234 in=900 out=1100',
    );
    expect(formatUsageLine('judge', { provider: 'groq', model: 'm' }, 5)).toContain('in=? out=?');
  });
});
