// Reclasificacion de tipos con heuristicas LEXICAS (sin IA). La IA suele etiquetar como "persona" a un colectivo ("Sumerios", "Dinastia XVIII", "Senado Romano"): un pueblo,
// una dinastia o una institucion no es un individuo. Aqui se corrige de forma determinista y conservadora: ante la duda, el tipo que dio el modelo se respeta (un error aqui
// vuelve "grupo" a un personaje, y eso es peor que dejar un colectivo como persona). Funciones puras, sin red.

import { fold } from './text';
import type { ConceptKind } from './types';

// Sustantivos colectivos al INICIO del nombre: "Pueblo sumerio", "Dinastia XVIII", "Senado Romano", "Legiones Romanas", "Los pueblos del mar".
const COLLECTIVE_HEAD = /^(?:(?:los|las|el|la)\s+)?(?:pueblos?|civilizacion(?:es)?|dinastias?|tribus?|clanes?|clan|estamentos?|castas?|movimientos?|ejercitos?|senado|consejo|asamblea|gremios?|cofradias?|nobleza|clero|plebe|plebeyos|patricios|legion(?:es)?|hordas?|confederacion(?:es)?)\b/;

// Pistas, en la DEFINICION, de que se habla de un colectivo.
const COLLECTIVE_CUE = /\b(?:pueblo|pueblos|civilizacion|civilizaciones|tribu|tribus|dinastia|dinastias|habitantes|pobladores|gente|nacion|etnia|comunidad|sociedad|casta|clase social|estamento|grupo de|conjunto de|institucion|asamblea|ejercito)\b/;

// Pistas de que se habla de UN individuo: si aparecen, no se reclasifica.
const INDIVIDUAL_CUE = /\b(?:rey|reina|faraon|emperador|emperatriz|general|filosofo|filosofa|escritor|escritora|poeta|dios|diosa|hijo de|hija de|nacio|murio|gobernante|conquistador|sacerdote|escriba|arquitecto|medico|cientifico|explorador|califa|sultan|regente|principe|princesa|pintor|escultor)\b/;

// Tratamientos que delatan un individuo: "Rey Hammurabi", "Faraon Ramses II", "Emperador Augusto".
const TITLE_HEAD = /^(?:rey|reina|faraon|emperador|emperatriz|general|san|santa|don|dona|lord|sir|califa|sultan|principe|princesa)\b/;

// Un nombre de un solo termino en plural y sin tratamiento ("Sumerios", "Aztecas", "Fenicios").
function looksLikeDemonymPlural(folded: string): boolean {
  const w = folded.replace(/^(?:los|las)\s+/, '');
  if (/\s/.test(w) || w.length < 6) return false;
  // Terminaciones tipicas de gentilicios plurales. "Ramses", "Tutmosis" o "Pericles" NO entran: acabar en "s" no basta.
  return /(?:ios|ias|eses|anos|anas|icos|icas|ecas|itas|ines|ones|egos|egas|ucos|ucas|ongos|ongas|enses|istas)$/.test(w) || /^(?:mayas|incas|persas|medos|hunos|godos|francos|sajones|celtas|galos|iberos|vikingos|romanos|griegos|egipcios|hititas|asirios|babilonios|sumerios|acadios|fenicios|hebreos)$/.test(w);
}

export function reclassifyKind(kind: ConceptKind, name: string, definition: string): ConceptKind {
  // Solo se corrigen tipos "blandos". Un lugar, un evento, una obra o una formula no se tocan.
  if (kind !== 'persona' && kind !== 'concepto' && kind !== 'definicion') return kind;
  const n = fold(name).replace(/\s+/g, ' ').trim();
  const d = fold(definition);
  if (TITLE_HEAD.test(n)) return kind;
  // 1. Sustantivo colectivo al principio del nombre. Para una "persona" basta con eso (un individuo no se llama "Dinastia XVIII"). Para un "concepto" ademas la DEFINICION debe hablar
  // de un colectivo: sin esa exigencia, "Movimiento rectilineo uniforme" (fisica) o "Consejo de seguridad informatica" se volverian "grupo" (esta funcion corre sobre toda materia).
  if (COLLECTIVE_HEAD.test(n) && (kind === 'persona' || (COLLECTIVE_CUE.test(d) && !INDIVIDUAL_CUE.test(d)))) return 'grupo';
  if (kind !== 'persona') return kind;
  // 2. Una "persona" cuyo nombre es un gentilicio plural y cuya definicion habla de un colectivo (y no de un individuo).
  if (looksLikeDemonymPlural(n) && COLLECTIVE_CUE.test(d) && !INDIVIDUAL_CUE.test(d)) return 'grupo';
  // 3. Una "persona" que la definicion llama pueblo/civilizacion/dinastia y no menciona a ningun individuo.
  if (/\b(?:pueblo|civilizacion|tribu|dinastia|etnia)\b/.test(d) && !INDIVIDUAL_CUE.test(d) && n.split(' ').length <= 3 && /s$/.test(n)) return 'grupo';
  return kind;
}
