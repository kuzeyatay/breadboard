"use client";

import type { RefObject } from "react";
import type { SearchSuggestion } from "./browser-recent-searches";
import { SearchGlyph } from "./browser-site-icon";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function BrowserSuggestionGlyph({ source }: { source: SearchSuggestion["source"] }) {
  return source === "history" ? (
    <svg className="browser-suggestion-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" {...STROKE} />
      <path d="M10 6.4V10l2.6 1.7" {...STROKE} />
    </svg>
  ) : (
    <SearchGlyph className="browser-suggestion-glyph" />
  );
}

export function BrowserSuggestionList<T extends SearchSuggestion>({
  id,
  suggestions,
  highlighted,
  onHighlight,
  onChoose,
  onRemoveHistory,
  address = false,
  dropdownRef,
}: {
  id: string;
  suggestions: readonly T[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (suggestion: T) => void;
  onRemoveHistory: (value: string, suggestion: T) => void;
  address?: boolean;
  dropdownRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={dropdownRef} id={id} className={`browser-search-suggestions ${address ? "browser-address-suggestions" : ""}`} role="listbox" aria-label={address ? "Address suggestions and recent searches" : "Search suggestions and recent searches"}>
      {suggestions.map((suggestion, index) => (
        <div
          key={suggestion.id ?? `${suggestion.source}-${suggestion.value}`}
          id={`${id}-${index}`}
          className="browser-suggestion-row"
          data-source={suggestion.source}
          role="option"
          aria-selected={highlighted === index}
          data-selected={highlighted === index}
          onMouseMove={() => onHighlight(index)}
        >
          <button
            type="button"
            className="browser-suggestion-select"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChoose(suggestion)}
          >
            <BrowserSuggestionGlyph source={suggestion.source} />
            <span className="browser-suggestion-copy">
              <strong>{suggestion.label}</strong>
              {suggestion.detail ? <small>— {suggestion.detail}</small> : null}
            </span>
          </button>
          {suggestion.source === "history" ? (
            <button
              type="button"
              className="browser-suggestion-remove"
              aria-label={`Remove ${suggestion.label} from recent searches`}
              title="Remove from recent searches"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveHistory(suggestion.value, suggestion);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" {...STROKE} /></svg>
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

