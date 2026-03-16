import { useState, useEffect, useRef, useCallback } from 'react';
import { zeusWs } from '@/lib/ws';
import type { WsEnvelope, FilesPayload } from '../../../shared/types';

export interface SearchResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

export function useFileSearch(sessionId: string | null) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const unsub = zeusWs.on('files', (envelope: WsEnvelope) => {
      if (envelope.sessionId !== sessionId) return;
      const payload = envelope.payload as FilesPayload;
      if (payload.type === 'search_files_result') {
        setResults(payload.results);
        setLoading(false);
      }
    });

    return unsub;
  }, [sessionId]);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (!sessionId || !q.trim()) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        zeusWs.send({
          channel: 'files',
          sessionId,
          payload: { type: 'search_files', query: q.trim() },
          auth: '',
        });
      }, 200);
    },
    [sessionId],
  );

  return { query, search, results, loading };
}
