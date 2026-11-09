import { APRENDIZAJE } from './principles/aprendizaje';
import { EVALUACION } from './principles/evaluacion';
import { MOTIVACION, RETROALIMENTACION } from './principles/retroalimentacionMotivacion';
import { CREATIVIDAD, DATOS, MITOS } from './principles/creatividadDatosMitos';
import type { Principle } from './types';

/** Toda la doctrina, en el orden de los dominios. */
export const ALL_PRINCIPLES: Principle[] = [...APRENDIZAJE, ...EVALUACION, ...RETROALIMENTACION, ...MOTIVACION, ...CREATIVIDAD, ...DATOS, ...MITOS];
