'use client';

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createVoiceChatHost, type VoiceChatSnapshot } from '@/lib/speech/voice-chat-link';

export function useVoiceChatHost({ identity, createdIdentity, scope, element, snapshot, onSend }: {
  identity: string | number | null;
  createdIdentity?: string | number | null;
  scope: string;
  element: RefObject<HTMLTextAreaElement | null>;
  snapshot: VoiceChatSnapshot | null;
  onSend: (text: string) => void;
}) {
  const host = useRef<ReturnType<typeof createVoiceChatHost> | null>(null);
  const boundIdentity = useRef(identity);
  const boundScope = useRef(scope);
  const send = useRef(onSend);
  const resume = useRef(() => {});
  const [registration] = useState(() => {
    let key: string | undefined;
    const listeners = new Set<() => void>();
    return {
      read: () => key,
      subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      publish(next: string | undefined) {
        if (key === next) return;
        key = next;
        for (const listener of listeners) listener();
      },
    };
  });
  const key = useSyncExternalStore(registration.subscribe, registration.read, () => undefined);
  useLayoutEffect(() => {
    send.current = onSend;
    const createdHere = boundIdentity.current === null && identity !== null && identity === createdIdentity;
    if (!snapshot || boundScope.current !== scope || (boundIdentity.current !== identity && !createdHere)) {
      host.current?.close();
      host.current = null;
      registration.publish(undefined);
    }
    boundIdentity.current = identity;
    boundScope.current = scope;
    resume.current = () => {
      if (snapshot && !host.current) {
        host.current = createVoiceChatHost(snapshot, text => send.current(text), () => element.current);
        registration.publish(host.current.key);
      }
    };
    resume.current();
    if (snapshot) host.current?.update(snapshot);
  }, [identity, createdIdentity, scope, element, snapshot, onSend, registration]);
  useLayoutEffect(() => {
    const close = () => { host.current?.close(); host.current = null; };
    const reopen = () => resume.current();
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', reopen);
    return () => {
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', reopen);
      close();
    };
  }, []);
  return key;
}
