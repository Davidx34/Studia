import type { MemoryGoldenCase } from '../memoryEval';

// Conjunto dorado SINTETICO de la memoria de clase. Los textos son inventados para esta prueba (no son material de ninguna clase real): cada uno trae
//   - conceptos centrales que un buen mapa debe tener,
//   - causas que el texto expresa con una expresion causal ("debido a", "permitio"...),
//   - pares que el texto menciona juntos SIN presentarlos como causa (trampas).
// Los casos 'real' (materiales de una clase) no se versionan: se cargan con --archivo desde un JSON local (ver scripts/eval-memory.ts).

export const MEMORY_GOLDEN: MemoryGoldenCase[] = [
  {
    id: 'egipto',
    origin: 'sintetico',
    profile: 'narrativo',
    text: 'El Nilo se desbordaba cada año y dejaba limo fértil en sus orillas. Debido a las crecidas del Nilo, la agricultura prosperó en Egipto. La agricultura permitió el crecimiento de la población egipcia. Los faraones gobernaban Egipto desde la ciudad de Menfis. Menfis estaba cerca del delta del Nilo. Los escribas anotaban las cosechas con jeroglíficos. Los jeroglíficos se grababan en los templos.',
    expectedConcepts: ['Nilo', 'crecidas del Nilo', 'agricultura', 'Egipto', 'faraones', 'Menfis', 'escribas', 'jeroglíficos', 'templos', 'población egipcia'],
    acceptableConcepts: ['limo fértil', 'delta del Nilo'],
    causalEdges: [
      ['crecidas del Nilo', 'agricultura'],
      ['agricultura', 'población egipcia'],
    ],
    notCausal: [
      ['faraones', 'Menfis'],
      ['escribas', 'jeroglíficos'],
      ['jeroglíficos', 'templos'],
      ['Menfis', 'Nilo'],
    ],
  },
  {
    id: 'roma',
    origin: 'sintetico',
    profile: 'narrativo',
    text: 'Según la tradición, Roma fue fundada en el año 753 a. C. La República romana nació cuando los romanos expulsaron a su último rey. El Senado dirigía la política exterior de la República. Debido a las guerras púnicas, Roma conquistó Sicilia. Las guerras púnicas enfrentaron a Roma con Cartago. Los romanos construyeron calzadas por toda Italia. Las calzadas conectaban Roma con las provincias.',
    expectedConcepts: ['Roma', 'República romana', 'Senado', 'guerras púnicas', 'Cartago', 'Sicilia', 'calzadas', 'Italia', 'provincias'],
    acceptableConcepts: ['último rey', 'política exterior'],
    causalEdges: [['guerras púnicas', 'Sicilia']],
    notCausal: [
      ['Senado', 'República romana'],
      ['calzadas', 'provincias'],
      ['calzadas', 'Italia'],
    ],
    // La frase causal ("Debido a las guerras púnicas, Roma conquistó Sicilia") nombra las guerras púnicas, y la frase vecina las vuelve a mencionar con Cartago:
    // hasCausalLink acepta la señal de la frase contigua. Es el compromiso de la iteración 1 (no perder causas expresadas en dos frases). Se mide y se informa.
    knownGapNotCausal: [['guerras púnicas', 'Cartago']],
  },
  {
    id: 'consumidor',
    origin: 'sintetico',
    profile: 'cuantitativo',
    text: 'La utilidad del consumidor se modela con la función de utilidad Cobb-Douglas: U = x^a * y^(1-a). La restricción presupuestal limita el gasto: p_x * x + p_y * y = M. En el equilibrio, la tasa marginal de sustitución es igual al cociente de precios: TMS = p_x / p_y. El ingreso M es la cantidad total disponible. Los precios p_x y p_y son dados.',
    expectedConcepts: ['función de utilidad Cobb-Douglas', 'restricción presupuestal', 'tasa marginal de sustitución', 'ingreso', 'precios', 'equilibrio'],
    acceptableConcepts: ['cociente de precios', 'gasto', 'utilidad del consumidor'],
    causalEdges: [],
    notCausal: [['ingreso', 'precios']],
  },
];
