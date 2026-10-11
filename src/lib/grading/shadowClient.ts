// Modo sombra: avisa al servidor de lo que respondio el estudiante y de lo que decidio el navegador, para que el
// servidor lo califique por su cuenta y registre si coinciden. NO cambia nada de lo que ve el estudiante: es "dispara
// y olvida" y cualquier fallo (red, 4xx, 5xx) se ignora.
export function reportShadow(questionId: string | undefined, answer: unknown, clientCorrect: boolean): void {
  if (!questionId || answer === null || answer === undefined) return;
  try {
    void fetch('/api/lesson/shadow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId, answer, clientCorrect }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // nunca debe afectar la leccion
  }
}
