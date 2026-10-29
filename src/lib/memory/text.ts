// Utilidades de texto de la memoria: claves normalizadas, palabras y similitud. Todo determinista y sin red.

const STOPWORDS: Record<string, true> = {};
'de del la las el los un una unos unas y o u e en a al con por para su sus se que es son ser como mas menos entre sobre segun sin lo le les este esta estos estas ese esa eso the of and'
  .split(' ')
  .forEach((w) => {
    STOPWORDS[w] = true;
  });

// Minusculas y sin tildes ("Demanda Agregada" -> "demanda agregada").
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Quita la 's' / 'es' final de palabras largas: "mercados" ~ "mercado", "funciones" ~ "funcion".
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

// Palabras con significado (sin articulos ni conectores), sin tildes y con raiz simple. Conserva letras, numeros y simbolos de variable de una letra solo si son letras.
export function words(s: string): string[] {
  const out: string[] = [];
  for (const raw of fold(s).split(/[^a-z0-9ñ]+/)) {
    if (!raw || STOPWORDS[raw]) continue;
    if (raw.length < 2 && !/[a-z]/.test(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

// La clave de un concepto: sus palabras con significado unidas por guiones.
export function normalizeKey(name: string): string {
  return words(name).join('-').slice(0, 80);
}

function bigrams(s: string): string[] {
  const t = s.replace(/[^a-z0-9]/g, '');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

// Similitud de Dice entre dos textos (0 a 1) sobre bigramas de caracteres: tolera plurales, tildes y una letra distinta.
export function dice(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const count: Record<string, number> = {};
  for (const x of A) count[x] = (count[x] ?? 0) + 1;
  let inter = 0;
  for (const y of B) {
    if (count[y] > 0) {
      inter++;
      count[y]--;
    }
  }
  return (2 * inter) / (A.length + B.length);
}

// ¿Son la misma idea dos claves? Misma cantidad de palabras y cada par igual o casi igual (un error de tipeo), NUNCA distintas en lo que importa: "primera ley" y "segunda ley"
// o "tema 1" y "tema 2" son conceptos distintos aunque se parezcan en letras, asi que las palabras con numeros deben coincidir exactamente.
export function similarKeys(a: string, b: string, tokenSimilarity: number): boolean {
  if (a === b) return a.length > 0;
  const A = a.split('-');
  const B = b.split('-');
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) continue;
    if (/[0-9]/.test(A[i] + B[i]) || A[i].length < 5 || B[i].length < 5) return false;
    if (dice(A[i], B[i]) < tokenSimilarity) return false;
  }
  return true;
}

// Que parte de las palabras de un concepto aparece en un texto fuente (0 a 1): sirve para descartar lo que la IA invento y no esta en el material.
export function groundedFraction(name: string, sourceText: string): number {
  const ws = words(name);
  if (ws.length === 0) return 0;
  const src = ' ' + words(sourceText).join(' ') + ' ';
  let hit = 0;
  for (const w of ws) if (src.indexOf(' ' + w + ' ') !== -1 || src.indexOf(w) !== -1) hit++;
  return hit / ws.length;
}
