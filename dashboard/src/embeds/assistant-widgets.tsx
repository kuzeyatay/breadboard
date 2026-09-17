import { createRoot } from 'react-dom/client';
import AssistantRichResponse from '../app/components/assistant-rich-response';

// A static, data-only view: it never fetches a transcript or receives auth tokens.
const parentOrigin = new URLSearchParams(location.search).get('parentOrigin');
if (parentOrigin && /^https?:\/\//.test(parentOrigin) && window.parent !== window) {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  const post = (message: Record<string, unknown>) => window.parent.postMessage(message, parentOrigin);
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== 'breadboard:widgets-render') return;
    const { content, uiResources, theme, conversationPublicId } = event.data;
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    root.render(<AssistantRichResponse
      message={{ content: typeof content === 'string' ? content : '', uiResources }}
      conversationPublicId={typeof conversationPublicId === 'string' && conversationPublicId.startsWith('conv_') ? conversationPublicId : null}
      onSend={text => post({ type: 'breadboard:widgets-send', text })}
    />);
  });
  let lastHeight = 0;
  new ResizeObserver(() => {
    const height = Math.ceil(container.getBoundingClientRect().height) + 8;
    if (height === lastHeight) return;
    lastHeight = height;
    post({ type: 'breadboard:widgets-resize', height });
  }).observe(container);
  post({ type: 'breadboard:widgets-ready' });
}
