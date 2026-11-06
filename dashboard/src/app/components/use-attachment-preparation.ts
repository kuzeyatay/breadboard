'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

/** Count overlapping file picks and discard completions from a previous chat. */
export function useAttachmentPreparation(scopeKey: string | null) {
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const progress = useRef(new Map<typeof scope, { pending: number; error: string }>());
  const currentScope = useRef<typeof scope | null>(scope);
  const [state, setState] = useState({ scope, pending: 0, error: '' });

  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = null; };
  }, [scope]);

  const begin = useCallback(() => {
    const batch = progress.current.get(scope) ?? { pending: 0, error: '' };
    progress.current.set(scope, batch);
    if (batch.pending === 0) batch.error = '';
    batch.pending += 1;
    setState({ scope, pending: batch.pending, error: batch.error });
    let finished = false;
    return {
      isCurrent: () => currentScope.current === scope,
      finish(errors: readonly string[] = []) {
        if (finished) return;
        finished = true;
        batch.pending -= 1;
        batch.error = [batch.error, ...errors].filter(Boolean).join(' · ');
        if (batch.pending === 0) progress.current.delete(scope);
        if (currentScope.current === scope) {
          setState({ scope, pending: batch.pending, error: batch.error });
        }
      },
    };
  }, [scope]);

  return {
    begin,
    busy: state.scope === scope && state.pending > 0,
    error: state.scope === scope ? state.error : '',
  };
}
