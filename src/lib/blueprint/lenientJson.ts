// Los modelos a veces devuelven "casi JSON": booleanos y nulos al estilo Python (`True`, `False`, `None`) o comas colgando antes de `}` o `]`. Medido con material real de una clase: con
// `"ok": False` se perdia la respuesta ENTERA (preguntas buenas incluidas). Esto repara SOLO esos dos defectos y SOLO fuera de las cadenas de texto (lo que va entre comillas no se toca), y
// luego se usa extractJsonObject como siempre. No adivina nada mas: si despues de repararlo sigue sin ser JSON, sigue fallando.

import { extractJsonObject } from '@/lib/study/validate';

const WORD = /[A-Za-z0-9_$]/;
const PY: Record<string, string> = { True: 'true', False: 'false', None: 'null' };

export function repairLooseJson(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // el caracter escapado se copia tal cual (incluida una comilla)
        if (i + 1 < text.length) out += text[++i];
      } else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    // True / False / None como palabra completa
    if (ch === 'T' || ch === 'F' || ch === 'N') {
      const m = /^(True|False|None)/.exec(text.slice(i, i + 5));
      if (m && !(i > 0 && WORD.test(text[i - 1])) && !(i + m[0].length < text.length && WORD.test(text[i + m[0].length]))) {
        out += PY[m[0]];
        i += m[0].length - 1;
        continue;
      }
    }
    // coma colgando: ", }" o ", ]"
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

// extractJsonObject, pero tolerando esos dos defectos.
export function extractLooseJsonObject(text: string): any | null {
  return extractJsonObject(text) ?? extractJsonObject(repairLooseJson(text));
}
