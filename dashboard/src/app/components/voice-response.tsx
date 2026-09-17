'use client';

import { useCallback, useState } from 'react';
import type { VoiceMessage } from '@/lib/speech/voice-conversation';
import { productForAction, safeProductUrl, type GenerativeUiAction } from '@/lib/generative-ui/contracts';
import ChatMarkdown from './chat-markdown';
import GenerativeUiRenderer from './hermes/generative-ui-renderer';
import ProductDetailsPanel, { type ProductPanelSelection } from './hermes/product-details-panel';

/** The same Markdown and native widget registry used by the chat transcript. */
export default function VoiceResponse({ message, onSend }: {
  message: VoiceMessage;
  onSend: (text: string) => void;
}) {
  const [selection, setSelection] = useState<ProductPanelSelection | null>(null);
  const onAction = useCallback((action: GenerativeUiAction) => {
    const product = productForAction(action);
    if (!product) return;
    if (action.type === 'product.find-similar') {
      setSelection(null);
      onSend(`Find products similar to ${product.title} from ${product.merchant}.`);
      return;
    }
    if (action.type === 'product.visit') {
      const url = safeProductUrl(product.url);
      if (!url) return;
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
      return;
    }
    setSelection(current => {
      const prior = current?.resource.id === action.resource.id ? current.compareProductIds : [];
      return {
        resource: action.resource,
        productId: action.productId,
        compareProductIds: action.type === 'product.open-details' ? prior
          : prior.includes(action.productId) ? prior.filter(id => id !== action.productId)
            : [...prior, action.productId].slice(-2),
      };
    });
  }, [onSend]);
  const selectedResource = message.uiResources?.find(resource => resource.id === selection?.resource.id);
  const activeSelection = selection && selectedResource?.kind === 'product-search'
    ? { ...selection, resource: selectedResource } : null;

  return <div className="voice-response">
    {message.uiResources?.length ? <div className="voice-response-resources">
      <GenerativeUiRenderer resources={message.uiResources} onAction={onAction}
        activeProductComparison={activeSelection ? { resourceId: activeSelection.resource.id, productIds: activeSelection.compareProductIds } : null} />
      {activeSelection && <ProductDetailsPanel selection={activeSelection} onClose={() => setSelection(null)} onAction={onAction} />}
    </div> : null}
    {message.content && <ChatMarkdown content={message.content} compact />}
  </div>;
}
