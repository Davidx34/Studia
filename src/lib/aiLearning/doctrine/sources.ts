// Registro de fuentes de la doctrina. «verified: true» = existencia y datos bibliograficos comprobados por busqueda en linea el 2026-11-09 (se omiten paginas o DOI cuando las fuentes discrepaban).
// Esto verifica que la obra EXISTE y que sus datos son estos; no sustituye leer la obra: por eso cada principio lleva su resumen propio y sus limites.

import type { Source } from './types';

const V = '2026-11-09';

const list: Source[] = [
  // --- Evaluacion y redaccion de preguntas ---
  { id: 'haladyna2002', authors: 'Haladyna, T. M., Downing, S. M. y Rodriguez, M. C.', year: 2002, title: 'A review of multiple-choice item-writing guidelines for classroom assessment', venue: 'Applied Measurement in Education', detail: '15(3), 309–333', doi: '10.1207/s15324818ame1503_5', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Taxonomía de 31 guías validada por consenso de manuales; no todas tienen respaldo experimental propio.' },
  { id: 'downing2006', authors: 'Downing, S. M. y Haladyna, T. M. (eds.)', year: 2006, title: 'Handbook of Test Development', venue: 'Lawrence Erlbaum', kind: 'libro', verified: false },
  { id: 'anderson2001', authors: 'Anderson, L. W. y Krathwohl, D. R. (eds.)', year: 2001, title: "A Taxonomy for Learning, Teaching, and Assessing: A Revision of Bloom's Taxonomy of Educational Objectives", venue: 'Longman', kind: 'libro', verified: true, verifiedOn: V },
  { id: 'wiggins2005', authors: 'Wiggins, G. y McTighe, J.', year: 2005, title: 'Understanding by Design (2.ª ed. ampliada)', venue: 'ASCD', kind: 'libro', verified: true, verifiedOn: V },
  { id: 'blackwiliam1998', authors: 'Black, P. y Wiliam, D.', year: 1998, title: 'Assessment and classroom learning', venue: 'Assessment in Education: Principles, Policy & Practice', detail: '5(1), 7–74', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Se suele citar un tamaño de efecto de 0,4 a 0,7; esa cifra NO se verificó en el texto y no se usa aquí.' },
  { id: 'wiliam2011', authors: 'Wiliam, D.', year: 2011, title: 'Embedded Formative Assessment', venue: 'Solution Tree Press', kind: 'libro', verified: false },

  // --- Como se aprende ---
  { id: 'roediger2006', authors: 'Roediger, H. L. y Karpicke, J. D.', year: 2006, title: 'Test-enhanced learning: taking memory tests improves long-term retention', venue: 'Psychological Science', detail: '17(3), 249–255', doi: '10.1111/j.1467-9280.2006.01693.x', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'karpicke2011', authors: 'Karpicke, J. D. y Blunt, J. R.', year: 2011, title: 'Retrieval practice produces more learning than elaborative studying with concept mapping', venue: 'Science', detail: '331(6018), 772–775', doi: '10.1126/science.1199327', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'dunlosky2013', authors: 'Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J. y Willingham, D. T.', year: 2013, title: "Improving students' learning with effective learning techniques: promising directions from cognitive and educational psychology", venue: 'Psychological Science in the Public Interest', detail: '14(1), 4–58', doi: '10.1177/1529100612453266', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'cepeda2006', authors: 'Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T. y Rohrer, D.', year: 2006, title: 'Distributed practice in verbal recall tasks: a review and quantitative synthesis', venue: 'Psychological Bulletin', detail: '132(3), 354–380', doi: '10.1037/0033-2909.132.3.354', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'rohrer2007', authors: 'Rohrer, D. y Taylor, K.', year: 2007, title: 'The shuffling of mathematics problems improves learning', venue: 'Instructional Science', detail: '35, 481–498', doi: '10.1007/s11251-007-9015-8', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'bjork2011', authors: 'Bjork, E. L. y Bjork, R. A.', year: 2011, title: 'Making things hard on yourself, but in a good way: creating desirable difficulties to enhance learning', venue: 'En Gernsbacher et al. (eds.), Psychology and the Real World, Worth Publishers', detail: 'pp. 56–64', kind: 'capitulo', verified: true, verifiedOn: V },
  { id: 'sweller1988', authors: 'Sweller, J.', year: 1988, title: 'Cognitive load during problem solving: effects on learning', venue: 'Cognitive Science', detail: '12(2), 257–285', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Las fuentes discrepan en el DOI; se omite.' },
  { id: 'kalyuga2003', authors: 'Kalyuga, S., Ayres, P., Chandler, P. y Sweller, J.', year: 2003, title: 'The expertise reversal effect', venue: 'Educational Psychologist', detail: '38(1), 23–31', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'kirschner2006', authors: 'Kirschner, P. A., Sweller, J. y Clark, R. E.', year: 2006, title: 'Why minimal guidance during instruction does not work: an analysis of the failure of constructivist, discovery, problem-based, experiential, and inquiry-based teaching', venue: 'Educational Psychologist', detail: '41(2), 75–86', doi: '10.1207/s15326985ep4102_1', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Provocó respuestas críticas en el mismo volumen (p. ej. Hmelo-Silver et al., 2007).' },
  { id: 'hmelo2007', authors: 'Hmelo-Silver, C. E., Duncan, R. G. y Chinn, C. A.', year: 2007, title: 'Scaffolding and achievement in problem-based and inquiry learning: a response to Kirschner, Sweller, and Clark (2006)', venue: 'Educational Psychologist', detail: '42(2), 99–107', doi: '10.1080/00461520701263368', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'kapur2008', authors: 'Kapur, M.', year: 2008, title: 'Productive failure', venue: 'Cognition and Instruction', detail: '26(3), 379–424', doi: '10.1080/07370000802212669', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'rosenshine2012', authors: 'Rosenshine, B.', year: 2012, title: 'Principles of instruction: research-based strategies that all teachers should know', venue: 'American Educator', detail: '36(1), 12–19', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'ambrose2010', authors: 'Ambrose, S. A., Bridges, M. W., DiPietro, M., Lovett, M. C. y Norman, M. K.', year: 2010, title: 'How Learning Works: Seven Research-Based Principles for Smart Teaching', venue: 'Jossey-Bass (Carnegie Mellon University)', kind: 'libro', verified: true, verifiedOn: V },
  { id: 'bransford2000', authors: 'Bransford, J. D., Brown, A. L. y Cocking, R. R. (eds.)', year: 2000, title: 'How People Learn: Brain, Mind, Experience, and School (ed. ampliada)', venue: 'National Academy Press (National Research Council)', doi: '10.17226/9853', kind: 'informe', verified: true, verifiedOn: V },
  { id: 'posner1982', authors: 'Posner, G. J., Strike, K. A., Hewson, P. W. y Gertzog, W. A.', year: 1982, title: 'Accommodation of a scientific conception: toward a theory of conceptual change', venue: 'Science Education', detail: '66(2), 211–227', doi: '10.1002/sce.3730660207', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'zimmerman2002', authors: 'Zimmerman, B. J.', year: 2002, title: 'Becoming a self-regulated learner: an overview', venue: 'Theory Into Practice', detail: '41(2), 64–70', doi: '10.1207/s15430421tip4102_2', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'bloom1984', authors: 'Bloom, B. S.', year: 1984, title: 'The 2 sigma problem: the search for methods of group instruction as effective as one-to-one tutoring', venue: 'Educational Researcher', detail: '13(6), 4–16', doi: '10.3102/0013189X013006004', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'La cifra de «dos desviaciones estándar» salió de un conjunto pequeño de estudios de tesis; no debe presentarse como efecto esperado.' },
  { id: 'ericsson1993', authors: 'Ericsson, K. A., Krampe, R. T. y Tesch-Römer, C.', year: 1993, title: 'The role of deliberate practice in the acquisition of expert performance', venue: 'Psychological Review', detail: '100(3), 363–406', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Réplicas posteriores (Macnamara y Maitra, 2019) hallaron un efecto de la práctica deliberada considerablemente menor que el original.' },
  { id: 'macnamara2019', authors: 'Macnamara, B. N. y Maitra, M.', year: 2019, title: 'The role of deliberate practice in expert performance: revisiting Ericsson, Krampe & Tesch-Römer (1993)', venue: 'Royal Society Open Science', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'mayer2009', authors: 'Mayer, R. E.', year: 2009, title: 'Multimedia Learning (2.ª ed.)', venue: 'Cambridge University Press', doi: '10.1017/CBO9780511811678', kind: 'libro', verified: true, verifiedOn: V, caveat: 'Existe una 3.ª edición (2020); revisar la edición antes de citar páginas.' },
  { id: 'pashler2008', authors: 'Pashler, H., McDaniel, M., Rohrer, D. y Bjork, R.', year: 2008, title: 'Learning styles: concepts and evidence', venue: 'Psychological Science in the Public Interest', detail: '9(3)', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Las fuentes discrepan en las páginas; se omiten.' },
  { id: 'vygotsky1978', authors: 'Vygotsky, L. S.', year: 1978, title: 'Mind in Society: The Development of Higher Psychological Processes', venue: 'Harvard University Press', kind: 'libro', verified: false },

  // --- Retroalimentacion ---
  { id: 'hattie2007', authors: 'Hattie, J. y Timperley, H.', year: 2007, title: 'The power of feedback', venue: 'Review of Educational Research', detail: '77(1), 81–112', doi: '10.3102/003465430298487', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'kluger1996', authors: 'Kluger, A. N. y DeNisi, A.', year: 1996, title: 'The effects of feedback interventions on performance: a historical review, a meta-analysis, and a preliminary feedback intervention theory', venue: 'Psychological Bulletin', detail: '119(2), 254–284', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'mueller1998', authors: 'Mueller, C. M. y Dweck, C. S.', year: 1998, title: "Praise for intelligence can undermine children's motivation and performance", venue: 'Journal of Personality and Social Psychology', detail: '75(1), 33–52', doi: '10.1037/0022-3514.75.1.33', kind: 'articulo', verified: true, verifiedOn: V },

  // --- Motivacion y emociones ---
  { id: 'ryan2000', authors: 'Ryan, R. M. y Deci, E. L.', year: 2000, title: 'Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being', venue: 'American Psychologist', detail: '55(1), 68–78', doi: '10.1037/0003-066X.55.1.68', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'eccles2002', authors: 'Eccles, J. S. y Wigfield, A.', year: 2002, title: 'Motivational beliefs, values, and goals', venue: 'Annual Review of Psychology', detail: '53, 109–132', doi: '10.1146/annurev.psych.53.100901.135153', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'pekrun2006', authors: 'Pekrun, R.', year: 2006, title: 'The control-value theory of achievement emotions: assumptions, corollaries, and implications for educational research and practice', venue: 'Educational Psychology Review', detail: '18, 315–341', doi: '10.1007/s10648-006-9029-9', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'sisk2018', authors: 'Sisk, V. F., Burgoyne, A. P., Sun, J., Butler, J. L. y Macnamara, B. N.', year: 2018, title: 'To what extent and under which circumstances are growth mind-sets important to academic achievement? Two meta-analyses', venue: 'Psychological Science', detail: '29(4), 549–571', doi: '10.1177/0956797617739704', kind: 'articulo', verified: true, verifiedOn: V },

  // --- Creatividad, indagacion, conocimiento del profesor ---
  { id: 'beghetto2007', authors: 'Beghetto, R. A. y Kaufman, J. C.', year: 2007, title: 'Toward a broader conception of creativity: a case for "mini-c" creativity', venue: 'Psychology of Aesthetics, Creativity, and the Arts', detail: '1(2), 73–79', doi: '10.1037/1931-3896.1.2.73', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'amabile1996', authors: 'Amabile, T. M.', year: 1996, title: 'Creativity in Context', venue: 'Westview Press', kind: 'libro', verified: false },
  { id: 'sawyer2012', authors: 'Sawyer, R. K.', year: 2012, title: 'Explaining Creativity: The Science of Human Innovation (2.ª ed.)', venue: 'Oxford University Press', kind: 'libro', verified: false },
  { id: 'shulman1986', authors: 'Shulman, L. S.', year: 1986, title: 'Those who understand: knowledge growth in teaching', venue: 'Educational Researcher', detail: '15(2), 4–14', doi: '10.3102/0013189X015002004', kind: 'articulo', verified: true, verifiedOn: V, caveat: 'Si el conocimiento didáctico del contenido es medible como constructo propio sigue en discusión.' },

  // --- Estadistica ---
  { id: 'wilson1927', authors: 'Wilson, E. B.', year: 1927, title: 'Probable inference, the law of succession, and statistical inference', venue: 'Journal of the American Statistical Association', detail: '22(158), 209–212', kind: 'articulo', verified: true, verifiedOn: V },
  { id: 'newcombe1998', authors: 'Newcombe, R. G.', year: 1998, title: 'Interval estimation for the difference between independent proportions: comparison of eleven methods', venue: 'Statistics in Medicine', detail: '17(8), 873–890', kind: 'articulo', verified: true, verifiedOn: V },
];

export const SOURCES: Record<string, Source> = Object.fromEntries(list.map((s) => [s.id, s]));

/** «Autor(es) año» corto para mostrar junto a un principio. */
export function shortCite(id: string): string {
  const s = SOURCES[id];
  if (!s) return id;
  const first = s.authors.split(',')[0].trim();
  // Varios autores se reconocen por la conjuncion «y» (el ultimo va unido con ella).
  return `${first}${s.authors.includes(' y ') ? ' et al.' : ''} (${s.year})`;
}
