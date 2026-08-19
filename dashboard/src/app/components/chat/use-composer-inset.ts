"use client";

// How much of a transcript the composer is standing on.
//
// The bar floats over the foot of the conversation rather than sitting below
// it, so the conversation runs underneath it the way a page runs under a
// toolbar. Two things downstream need to know how tall it is, and neither can
// be told in CSS: the scrolled content needs a tail at least that tall, or the
// newest message would come to rest behind the bar; and the jump-to-newest
// control has to float clear of it.
//
// The height is not a constant. The bar grows with a long draft, with
// attachments, with the selection strip and whatever a surface hands it as
// `beforeComposer`, so it is measured and re-measured rather than guessed.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

/** Name of the variable the surface publishes to its transcript subtree. */
export const COMPOSER_INSET_VAR = "--bb-composer-inset";

export type ComposerInset = {
  /** Put this on the floating composer wrapper. */
  ref: (node: HTMLElement | null) => void;
  /**
   * Put this on the element that owns both the scroller and the composer: it
   * publishes the measured height to everything inside as a CSS variable.
   */
  style: CSSProperties;
  /** The measured height in px, for anything that would rather have a number. */
  height: number;
};

export function useComposerInset(): ComposerInset {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof window === "undefined" || !window.ResizeObserver) {
      return;
    }
    // Rounded up: a fractional inset would leave a hairline of the message
    // showing under the bar on displays that do not land on a whole pixel.
    const measure = () => setHeight(Math.ceil(node.getBoundingClientRect().height));
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  return {
    ref,
    style: { [COMPOSER_INSET_VAR]: `${height}px` } as CSSProperties,
    height,
  };
}
