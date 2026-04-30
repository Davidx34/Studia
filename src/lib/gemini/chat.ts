import { createClient } from '@/lib/supabase/client';

export interface ChatMessage {
  role: 'user' | 'tonito';
  text: string;
  timestamp: number;
}

export interface ChatStreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

/**
 * Envía un mensaje al chat de Toñito y procesa la respuesta como stream.
 * Llama a onChunk por cada token recibido (efecto typing real) y onDone al terminar.
 */
export async function streamChatWithTonito(
  message: string,
  callbacks: ChatStreamCallbacks,
  options: {
    moduleId?: string;
    history?: ChatMessage[];
  } = {}
): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    callbacks.onError(new Error('No active session'));
    return;
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/tonito-chat`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
      body: JSON.stringify({
        message,
        moduleId: options.moduleId,
        history: options.history?.map((m) => ({ role: m.role, text: m.text })) || [],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Chat API error ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);
          if (event.done) {
            callbacks.onDone(fullText);
            return;
          }
          if (event.chunk) {
            fullText += event.chunk;
            callbacks.onChunk(event.chunk);
          }
        } catch {
          // ignorar líneas mal formadas
        }
      }
    }

    // Si terminó sin recibir done explícito
    callbacks.onDone(fullText);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Carga el historial reciente de chat del usuario desde la DB.
 * Útil para restaurar la conversación al abrir el widget.
 */
export async function loadChatHistory(limit: number = 20): Promise<ChatMessage[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from('tonito_conversations')
    .select('role, message, created_at')
    .eq('user_id', user.id)
    .eq('interaction_type', 'chat')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data) return [];

  // Reverse para orden cronológico
  return data.reverse().map((row) => ({
    role: row.role as 'user' | 'tonito',
    text: row.message,
    timestamp: new Date(row.created_at).getTime(),
  }));
}
