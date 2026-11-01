import { useRef, useCallback, useEffect } from 'react';
import { KinetixSseEvent } from './types';

export function useKinetixStream() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const runStream = async (
    frameBase64: string | null,
    voiceText: string,
    onEvent: (event: KinetixSseEvent) => void,
    onError: (err: unknown) => void
  ) => {
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('http://localhost:4000/api/orchestrate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameBase64, voiceTranscript: voiceText }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} from orchestrator`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const eventMatch = chunk.match(/event:\s*(.+)/);
          const dataMatch = chunk.match(/data:\s*(.+)/);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1].trim() as KinetixSseEvent['event'];
          try {
            const payload = JSON.parse(dataMatch[1].trim());
            onEvent({ event: eventName, data: payload } as KinetixSseEvent);
          } catch {
            // skip malformed payload
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      onError(err);
    }
  };

  const abortStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => () => abortStream(), [abortStream]);

  return { runStream, abortStream };
}