'use client';

import { useState, type ReactNode } from 'react';
import { normalizeGenerativeUiResources, productForAction, safeProductUrl, type GenerativeUiAction } from '@/lib/generative-ui/contracts';
import ChatMarkdown from './chat-markdown';
import GenerativeUiRenderer from './hermes/generative-ui-renderer';
import ProductDetailsPanel, { type ProductPanelSelection } from './hermes/product-details-panel';

/** Shared by compact assistant surfaces, including Quartz's static embed. */
export default function AssistantRichResponse({ message, onSend, legacyChatSessionId, conversationPublicId, markdown }: {
  message: { content: string; uiResources?: unknown };
  onSend: (text: string) => void;
  legacyChatSessionId?: number | null;
  conversationPublicId?: string | null;
  /** Hosts can attach the shared selection controls to response prose. */
  markdown?: ReactNode;
}) {
  const resources = normalizeGenerativeUiResources(message.uiResources);
  const [selection, setSelection] = useState<ProductPanelSelection | null>(null);
  const onAction = (action: GenerativeUiAction) => {
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
  };
  const selectedResource = resources.find(resource => resource.id === selection?.resource.id);
  const activeSelection = selection && selectedResource?.kind === 'product-search'
    ? { ...selection, resource: selectedResource } : null;

  return <div className="assistant-rich-response min-w-0">
    {resources.length ? <div className="space-y-3">
      <GenerativeUiRenderer resources={resources} onAction={onAction}
        legacyChatSessionId={legacyChatSessionId} conversationPublicId={conversationPublicId}
        activeProductComparison={activeSelection ? { resourceId: activeSelection.resource.id, productIds: activeSelection.compareProductIds } : null} />
      {activeSelection && <ProductDetailsPanel selection={activeSelection} onClose={() => setSelection(null)} onAction={onAction} />}
    </div> : null}
    {message.content && (markdown ?? <ChatMarkdown content={message.content} compact />)}
  </div>;
}
