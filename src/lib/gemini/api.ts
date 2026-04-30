import { createClient } from '@/lib/supabase/client';

export interface GeneratedQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface GeminiQuestionResponse {
  type: 'question';
  cached: boolean;
  data: GeneratedQuestion;
}

export interface GeminiFeedbackResponse {
  type: 'feedback';
  isCorrect: boolean;
  message: string;
}

export interface GeminiChatResponse {
  type: 'chat';
  message: string;
}

async function callEdgeFunction<T>(body: object): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error('No active session');

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/gemini-tutor`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Edge Function error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  if (data?.error) throw new Error(data.error);

  return data as T;
}

export async function generateQuestion(moduleId: string): Promise<GeminiQuestionResponse> {
  return callEdgeFunction<GeminiQuestionResponse>({
    moduleId,
    interactionType: 'generate_question',
  });
}

export async function evaluateAnswer(
  moduleId: string,
  question: string,
  options: string[],
  correctIndex: number,
  userAnswerIndex: number
): Promise<GeminiFeedbackResponse> {
  return callEdgeFunction<GeminiFeedbackResponse>({
    moduleId,
    interactionType: 'evaluate_answer',
    questionContext: { question, options, correctIndex, userAnswerIndex },
  });
}

export async function chatWithTonito(
  moduleId: string,
  userMessage: string
): Promise<GeminiChatResponse> {
  return callEdgeFunction<GeminiChatResponse>({
    moduleId,
    interactionType: 'chat',
    userMessage,
  });
}
