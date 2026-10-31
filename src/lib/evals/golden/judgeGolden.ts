import type { JudgeGoldenCase } from '../judgeEval';

// Conjunto dorado SINTETICO del juez. Cuatro familias:
//   fiel                  la pregunta es correcta y el material la respalda: debe aprobarse.
//   sutil_falsa           la respuesta marcada es falsa de forma sutil (parece razonable): debe rechazarse.
//   contradice_material   una convencion DEL CURSO distinta de la habitual: manda el material; debe rechazarse.
//   ausente_verdadera     dato verdadero en el mundo real pero que el fragmento del profesor no trae: se rechaza con el criterio 'material' y se aprueba con 'subject'.

const ELASTICIDAD =
  'La elasticidad precio de la demanda mide cuánto cambia la cantidad demandada cuando cambia el precio: es el cambio porcentual de la cantidad dividido por el cambio porcentual del precio. Si su valor absoluto es mayor que 1, la demanda es elástica; si es menor que 1, es inelástica.';
const NILO =
  'El Nilo se desbordaba cada año y dejaba limo fértil en sus orillas. Debido a las crecidas del Nilo, la agricultura prosperó en Egipto. La agricultura permitió el crecimiento de la población egipcia. Los escribas anotaban las cosechas con jeroglíficos.';
const ROMA =
  'Según la tradición, Roma fue fundada en el año 753 a. C. Debido a las guerras púnicas, Roma conquistó Sicilia. Las guerras púnicas enfrentaron a Roma con Cartago.';
const CONSUMIDOR =
  'La utilidad del consumidor se modela con la función Cobb-Douglas: U = x^a * y^(1-a). La restricción presupuestal limita el gasto: p_x * x + p_y * y = M. En el equilibrio, la tasa marginal de sustitución es igual al cociente de precios: TMS = p_x / p_y.';
const CONVENCIONES = 'En este curso el ingreso se denota con la letra I. La elasticidad se calcula siempre con el método del punto medio.';

const mc = (id: string, q: string, opts: string[], ok: number, exp: string) => ({ id, type: 'multiple_choice', q, opts, ok, exp });
const tf = (id: string, q: string, ok: boolean, exp: string) => ({ id, type: 'true_false', q, ok, exp });
const fb = (id: string, q: string, answers: string[], exp: string) => ({ id, type: 'fill_blank', q, answers, exp });

const BOTH_APPROVE = { subject: 'approve', material: 'approve' } as const;
const BOTH_REJECT = { subject: 'reject', material: 'reject' } as const;
const ABSENT_TRUE = { subject: 'approve', material: 'reject' } as const;

export const JUDGE_GOLDEN: JudgeGoldenCase[] = [
  // ───────── fieles ─────────
  { id: 'f1', kind: 'fiel', material: ELASTICIDAD, question: mc('f1', 'Si el valor absoluto de la elasticidad precio es 2, la demanda es:', ['Elástica', 'Inelástica', 'De elasticidad unitaria', 'Perfectamente inelástica'], 0, 'Mayor que 1 es elástica.'), expect: BOTH_APPROVE, note: 'correcta y respaldada' },
  { id: 'f2', kind: 'fiel', material: ELASTICIDAD, question: tf('f2', 'Si el valor absoluto de la elasticidad es menor que 1, la demanda es inelástica.', true, 'Menor que 1 es inelástica.'), expect: BOTH_APPROVE, note: 'correcta y respaldada' },
  { id: 'f3', kind: 'fiel', material: NILO, question: mc('f3', '¿Qué dejaba el Nilo en sus orillas al desbordarse?', ['Limo fértil', 'Sal', 'Arena del desierto', 'Piedra caliza'], 0, 'El texto lo dice.'), expect: BOTH_APPROVE, note: 'correcta y respaldada' },
  { id: 'f4', kind: 'fiel', material: CONSUMIDOR, question: fb('f4', 'En el equilibrio, TMS = p_x / ___', ['p_y'], 'El cociente de precios.'), expect: BOTH_APPROVE, note: 'correcta y respaldada' },

  // ───────── sutiles falsas: la respuesta marcada es falsa ─────────
  { id: 's1', kind: 'sutil_falsa', material: ELASTICIDAD, question: tf('s1', 'Si el valor absoluto de la elasticidad es 0,5, la demanda es elástica.', true, 'Menor que 1.'), expect: BOTH_REJECT, note: '0,5 es inelástica; la respuesta marcada invierte el criterio' },
  { id: 's2', kind: 'sutil_falsa', material: NILO, question: mc('s2', '¿Qué permitió el crecimiento de la población egipcia?', ['El comercio con Grecia', 'La agricultura', 'La minería de oro', 'La navegación por el Mediterráneo'], 0, 'Comercio.'), expect: BOTH_REJECT, note: 'el texto dice la agricultura; la marcada es otra' },
  { id: 's3', kind: 'sutil_falsa', material: CONSUMIDOR, question: tf('s3', 'En U = x^a * y^(1-a), el parámetro a es el precio del bien x.', true, 'a es el precio.'), expect: BOTH_REJECT, note: 'a es la preferencia por x, no un precio' },
  { id: 's4', kind: 'sutil_falsa', material: ROMA, question: mc('s4', '¿En qué año fue fundada Roma según la tradición?', ['509 a. C.', '753 a. C.', '27 a. C.', '476 d. C.'], 0, '509.'), expect: BOTH_REJECT, note: '509 a. C. es la República; la fundación es 753 a. C.' },
  { id: 's5', kind: 'sutil_falsa', material: CONSUMIDOR, question: tf('s5', 'En el equilibrio, TMS = p_y / p_x.', true, 'Cociente invertido.'), expect: BOTH_REJECT, note: 'el cociente está invertido' },

  // ───────── contradicen el material (convención del curso) ─────────
  { id: 'c1', kind: 'contradice_material', material: CONVENCIONES, question: mc('c1', '¿Qué letra denota el ingreso en este curso?', ['M', 'I', 'Y', 'R'], 0, 'M.'), expect: BOTH_REJECT, note: 'M es habitual, pero el material del curso dice I' },
  { id: 'c2', kind: 'contradice_material', material: CONVENCIONES, question: mc('c2', '¿Con qué método se calcula la elasticidad en este curso?', ['Con el punto inicial', 'Con el punto medio', 'Con la derivada puntual', 'Con regresión'], 0, 'Punto inicial.'), expect: BOTH_REJECT, note: 'el material fija el punto medio' },

  // ───────── verdaderas pero ausentes del fragmento ─────────
  { id: 'a1', kind: 'ausente_verdadera', material: ELASTICIDAD, question: tf('a1', 'Un bien inferior tiene elasticidad ingreso negativa.', true, 'Definición de bien inferior.'), expect: ABSENT_TRUE, note: 'cierto, pero el fragmento no habla de elasticidad ingreso' },
  { id: 'a2', kind: 'ausente_verdadera', material: ROMA, question: mc('a2', '¿Quién derrotó a Aníbal en la batalla de Zama?', ['Escipión el Africano', 'Julio César', 'Pompeyo', 'Augusto'], 0, 'Escipión.'), expect: ABSENT_TRUE, note: 'cierto, pero el fragmento no menciona Zama ni a Aníbal' },
  { id: 'a3', kind: 'ausente_verdadera', material: NILO, question: mc('a3', '¿Cómo se llama la escritura cursiva egipcia usada en documentos administrativos?', ['Hierático', 'Cuneiforme', 'Lineal B', 'Rúnico'], 0, 'Hierático.'), expect: ABSENT_TRUE, note: 'cierto, pero el fragmento solo menciona jeroglíficos' },
  { id: 'a4', kind: 'ausente_verdadera', material: CONSUMIDOR, question: tf('a4', 'La función Cobb-Douglas lleva el nombre de Charles Cobb y Paul Douglas.', true, 'Los dos autores.'), expect: ABSENT_TRUE, note: 'cierto, pero el fragmento no menciona a los autores' },
];
