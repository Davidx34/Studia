// Limites de la revision del profesor. Aparte de submission.ts a proposito: lo usa tambien un componente del navegador y submission.ts carga el evaluador y los modelos
// (codigo de servidor) que no deben viajar en el paquete del cliente.
export const REVIEW_LIMITS = { feedbackMax: 2000 } as const;
