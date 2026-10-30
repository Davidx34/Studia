// Defensa contra INYECCION DE PROMPTS en el texto de los materiales. Los apuntes de un profesor (PDF, DOCX, enlaces) entran como contexto a la IA; un documento malicioso (o un enlace
// que alguien controla) puede traer "ignora las instrucciones anteriores...", cerrar a mano el delimitador de datos (">>>") para escapar del bloque, o esconder ordenes con caracteres
// invisibles. Este modulo NO es la unica defensa (las otras son: el material va entre delimitadores y se declara como DATO, toda salida del modelo se valida y se descarta si no
// cumple, y la IA nunca escribe codigo), pero reduce lo que llega al modelo. Es DETERMINISTA, sin red ni IA, e IDEMPOTENTE (sanitizar dos veces da lo mismo).
//
// Que hace, en orden:
//   1. quita caracteres INVISIBLES y de control (espacios de ancho cero, marcas bidireccionales, "caracteres etiqueta" U+E0000, selectores de variacion ocultos, controles C0/C1);
//   2. DETECTA frases de secuestro de instrucciones (es/en), marcadores de rol del modelo y fichas de plantilla de chat, y las ESCAPA envolviendolas en "[cita: ...]" (o
//      neutralizandolas): el modelo las lee como texto citado del material y no como una orden. El patron es una HEURISTICA: no promete detectar todo;
//   3. NEUTRALIZA los delimitadores: toda racha de 2 o mas "<" o ">" (incluidas las variantes de ancho completo y angulos Unicode) se separa con espacios ("> > >"), asi que un
//      documento no puede cerrar el bloque "<<<MATERIAL ... MATERIAL>>>". Un "<" o ">" suelto (una desigualdad) no se toca.
// Cada intervencion se cuenta en `alerts` para registrarla (logPromptAlerts) SIN guardar el contenido.

export type AlertKind = 'invisible' | 'hijack' | 'role_marker' | 'delimiter' | 'delimiter_label' | 'truncated';

export interface SanitizeAlert {
  kind: AlertKind;
  count: number;
}

export interface SanitizeResult {
  text: string;
  alerts: SanitizeAlert[];
  // true si hubo algo que parece un ataque (frase de secuestro, marcador de rol o un delimitador con el nombre de nuestros bloques); lo demas es limpieza rutinaria.
  suspicious: boolean;
}

export interface SanitizeOptions {
  // Tope de caracteres del resultado.
  maxChars?: number;
}

// Marca con que se citan los fragmentos sospechosos. La limpieza ignora lo que ya va precedido de ella (idempotencia).
const QUOTE_OPEN = '[cita: ';

// ───────────────────────── 1. invisibles y controles ─────────────────────────
// U+00AD guion suave, U+034F, U+061C, U+115F/1160/17B4/17B5/180B-180E, U+200B-200F (ancho cero y marcas direccionales), U+202A-202E (anulaciones bidi), U+2060-206F (formato invisible),
// U+2800 (braille en blanco), U+3164/FFA0 (rellenos hangul), U+FE00-FE0E (selectores de variacion; FE0F se conserva para los emoji), U+FEFF, U+FFF9-FFFB, y los pares sustitutos de
// U+E0000-E007F ("caracteres etiqueta", con los que se puede esconder texto) y U+E0100-E01EF (selectores de variacion suplementarios).
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠎​-‏‪-‮⁠-⁯⠀ㅤ︀-︎﻿ﾠ￹-￻]|\uDB40[\uDC00-\uDC7F\uDD00-\uDDEF]/g;
// Controles C0/C1 salvo tabulador, salto de linea y retorno de carro.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// ───────────────────────── 2. secuestro de instrucciones ─────────────────────────
// Se buscan sobre una copia en minusculas y SIN TILDES de la MISMA longitud que el original (fold1to1), para poder envolver el trozo original.
function fold1to1(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const d = ch.normalize('NFD').charAt(0);
    out += d.toLowerCase().length === 1 ? d.toLowerCase() : ch.toLowerCase().charAt(0);
  }
  return out;
}

// Frases de secuestro (sobre texto plegado: sin tildes, en minusculas).
const HIJACK: RegExp[] = [
  // "ignora las instrucciones anteriores", "olvida todas las reglas", "descarta el prompt"...
  /\b(?:ignor|olvid|desestim|omit|descart|salt)(?:a|e|ar|en|ad|ate)\w*\s+(?:\w+\s+){0,3}(?:instruccion(?:es)?|indicacion(?:es)?|reglas?|ordenes|directrices|restricciones|prompt)\b(?:\s+(?:anteriores|previas|de\s+arriba|del\s+sistema|originales|dadas))?/g,
  // "system prompt", "prompt del sistema", "mensaje del sistema"
  /\b(?:system|sistema)\s*(?:prompt|message|mensaje|instructions?|instruccion(?:es)?)\b|\b(?:prompt|mensaje)\s+del\s+sistema\b/g,
  // "actua como un asistente/modelo/IA/experto/DAN...", "a partir de ahora eres...", "ahora eres un..."
  /\b(?:actua|actue|comportate|finge|simula|haz\s+de\s+cuenta)\s+(?:como|que)\s+(?:si\s+fueras\s+)?(?:un|una|el|la)?\s*(?:asistente|modelo|ia|inteligencia\s+artificial|experto|sistema|chatbot|gpt|dan|hacker|administrador|desarrollador)\b|\b(?:a\s+partir\s+de\s+ahora|desde\s+ahora)\s+(?:eres|seras|actuaras)\b|\bahora\s+eres\s+(?:un|una)\b/g,
  // "revela/muestra/repite tu prompt / tus instrucciones"
  /\b(?:revela|muestra|imprime|repite|dime|filtra)\s+(?:tu|el|tus|las)\s+(?:prompt|instrucciones|reglas)\b(?:\s+(?:del\s+sistema|originales|internas|ocultas))?/g,
  // Ingles
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your|these)\s+(?:instructions?|prompts?|rules?|guidelines)\b|\byou\s+are\s+now\b|\bnew\s+instructions?\s*:|\breveal\s+(?:your|the)\s+(?:system\s+)?prompt\b|\bact\s+as\s+(?:an?\s+)?(?:ai|assistant|model|dan)\b|\bjailbreak\b/g,
];

// Fichas de plantilla de chat de los modelos: "<|im_start|>", "[INST]", "<<SYS>>"...
const CHAT_TOKENS = /<\|?\s*(?:im_start|im_end|system|assistant|user|endoftext|eot_id|begin_of_text)\s*\|?>|\[\/?inst\]|<<\s*\/?sys\s*>>/gi;
// Marcador de rol al inicio de una linea: "system:", "assistant:", "sistema:", "asistente:". ("user:"/"usuario:" no: aparecen en dialogos legitimos.)
const ROLE_LINE = /^([ \t]*)(system|assistant|sistema|asistente)([ \t]*:)/gim;

// ───────────────────────── 3. delimitadores ─────────────────────────
// Angulos ASCII y sus parecidos Unicode (ancho completo, angulos matematicos, comillas angulares de dingbats).
const ANGLE_RUN = /[<>＜＞〈〉⟨⟩❮❯〈〉]{2,}/g;
// Una racha de angulos pegada al nombre de uno de NUESTROS bloques: eso ya es un intento (o una casualidad muy rara).
const LABEL_NEAR_ANGLES = /(?:[<>＜＞〈〉⟨⟩❮❯〈〉]{2,}\s*(?:material|texto|fragmento|contexto)\b)|(?:\b(?:material|texto|fragmento|contexto)\s*[<>＜＞〈〉⟨⟩❮❯〈〉]{2,})/i;

// Largo maximo de un tramo citado. Lo que NOSOTROS envolvemos es una frase corta; un "[cita:" que no cierra pronto no es una cita nuestra.
const MAX_CITED_SPAN = 200;

// Los tramos que YA estan citados ("[cita: ... ]"): [inicio, fin) del texto. Una coincidencia que cae dentro de uno no se vuelve a envolver (idempotencia).
// Solo cuenta como tramo un "[cita: " que CIERRA con "]" a menos de MAX_CITED_SPAN caracteres y sin otro "[cita: " en medio. Si no, un documento podia escribir "[cita: x" sin cerrar
// al principio para que todo el resto pasara por "ya citado" y se saltara la deteccion.
function citedSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let from = 0;
  for (;;) {
    const a = text.indexOf(QUOTE_OPEN, from);
    if (a === -1) break;
    const inner = a + QUOTE_OPEN.length;
    const close = text.indexOf(']', inner);
    const nested = text.indexOf(QUOTE_OPEN, inner);
    if (close === -1 || close + 1 - a > MAX_CITED_SPAN || (nested !== -1 && nested < close)) {
      from = inner; // no es un tramo valido: se sigue buscando a partir de ahi
      continue;
    }
    spans.push([a, close + 1]);
    from = close + 1;
  }
  return spans;
}

function bump(alerts: Record<string, number>, kind: AlertKind, n = 1) {
  if (n > 0) alerts[kind] = (alerts[kind] ?? 0) + n;
}

// Une rangos [inicio, fin) que se solapan.
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function sanitizeMaterialText(raw: unknown, opts: SanitizeOptions = {}): SanitizeResult {
  const counts: Record<string, number> = Object.create(null);
  let text = typeof raw === 'string' ? raw : '';

  // 1. Invisibles y controles.
  // Se repite hasta que no cambie: quitar un invisible puede juntar los dos pedazos de un par sustituto (un caracter etiqueta partido por una marca bidi) y formar uno nuevo.
  let invisible = 0;
  for (let prev = ''; prev !== text; ) {
    prev = text;
    invisible += (text.match(INVISIBLE) ?? []).length + (text.match(CONTROLS) ?? []).length;
    text = text.replace(INVISIBLE, '').replace(CONTROLS, '');
  }
  bump(counts, 'invisible', invisible);

  // Un delimitador pegado a nuestros nombres de bloque se cuenta ANTES de neutralizarlo (despues ya no se vería).
  if (LABEL_NEAR_ANGLES.test(text)) bump(counts, 'delimiter_label');

  // 2a. Fichas de plantilla de chat: se reemplazan por una forma inofensiva ("<|im_start|>" -> "[marcador: im_start]").
  text = text.replace(CHAT_TOKENS, (m) => {
    bump(counts, 'role_marker');
    return `[marcador: ${m.replace(/[^a-z_]/gi, ' ').trim().replace(/\s+/g, '_').toLowerCase()}]`;
  });
  // 2b. Marcadores de rol al inicio de linea ("Sistema: ...").
  text = text.replace(ROLE_LINE, (_m, ws: string, role: string, colon: string) => {
    bump(counts, 'role_marker');
    return `${ws}[cita] ${role}${colon}`;
  });

  // 2c. Frases de secuestro: se busca en la copia plegada y se envuelve el trozo ORIGINAL (misma longitud => mismos indices).
  const folded = fold1to1(text);
  const ranges: [number, number][] = [];
  const cited = citedSpans(text);
  let precited = 0;
  for (const re of HIJACK) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(folded)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      // Idempotencia: lo que ya esta dentro de una cita no se vuelve a envolver (pero SI se cuenta: un documento que ya trae su frase "citada" es igual de sospechoso).
      const at = m.index;
      if (cited.some(([a, b]) => at >= a && at < b)) precited++;
      else ranges.push([at, at + m[0].length]);
    }
  }
  if (ranges.length > 0) {
    const merged = mergeRanges(ranges);
    let out = '';
    let pos = 0;
    for (const [a, b] of merged) {
      out += text.slice(pos, a) + QUOTE_OPEN + text.slice(a, b) + ']';
      pos = b;
    }
    text = out + text.slice(pos);
    bump(counts, 'hijack', merged.length);
  }
  bump(counts, 'hijack', precited);

  // 3. Delimitadores: se separa toda racha de 2 o mas angulos ("<<<" -> "< < <").
  text = text.replace(ANGLE_RUN, (run) => {
    bump(counts, 'delimiter');
    return run.split('').join(' ');
  });

  // Tope de largo (despues de limpiar: la limpieza puede alargar un poco).
  if (opts.maxChars !== undefined && text.length > opts.maxChars) {
    text = text.slice(0, opts.maxChars);
    bump(counts, 'truncated');
  }

  const alerts: SanitizeAlert[] = (Object.keys(counts) as AlertKind[]).sort().map((kind) => ({ kind, count: counts[kind] }));
  const suspicious = (counts.hijack ?? 0) > 0 || (counts.role_marker ?? 0) > 0 || (counts.delimiter_label ?? 0) > 0;
  return { text, alerts, suspicious };
}

// Solo el texto limpio (para insertarlo en un prompt).
export function sanitizeForPrompt(raw: unknown, opts: SanitizeOptions = {}): string {
  return sanitizeMaterialText(raw, opts).text;
}

// Envuelve el material ya limpio entre delimitadores: <<<ETIQUETA ... ETIQUETA>>>. La etiqueta es una de las nuestras (nunca texto del material).
export function fenceMaterial(label: 'MATERIAL' | 'TEXTO' | 'FRAGMENTO' | 'CONTEXTO', raw: unknown, opts: SanitizeOptions = {}): { block: string; result: SanitizeResult } {
  const result = sanitizeMaterialText(raw, opts);
  return { block: `<<<${label}\n${result.text}\n${label}>>>`, result };
}

// Limpia y, si hay algo sospechoso, deja rastro (sin el contenido). Es lo que usan los constructores de prompts: una sola pasada y siempre observable.
export function sanitizeLogged(raw: unknown, context: string, opts: SanitizeOptions = {}, log?: (msg: string, detail?: Record<string, unknown>) => void): string {
  const result = sanitizeMaterialText(raw, opts);
  logPromptAlerts(result, context, log);
  return result.text;
}

// Registra una alerta SIN el contenido (solo el contexto y cuantas intervenciones de cada tipo). Solo si hay algo sospechoso; la limpieza rutinaria no hace ruido.
export function logPromptAlerts(result: SanitizeResult, context: string, log: (msg: string, detail?: Record<string, unknown>) => void = (m, d) => console.warn(m, d ?? '')): void {
  if (!result.suspicious) return;
  const detail: Record<string, unknown> = { context: String(context).slice(0, 80) };
  for (const a of result.alerts) detail[a.kind] = a.count;
  log('[PROMPT_INJECTION_SUSPECT]', detail);
}
