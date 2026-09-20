"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type AudioHTMLAttributes,
  type MutableRefObject,
  type RefCallback,
  type VideoHTMLAttributes,
} from "react";
import { releaseMediaElement } from "@/app/components/media-element-resource";

export { releaseMediaElement } from "@/app/components/media-element-resource";

function useReclaimingMediaRef<T extends HTMLMediaElement>(
  source: string | undefined,
  // A caller that drives the element itself (a player with its own controls)
  // still needs a handle on it. It shares this ref rather than owning one, so
  // release-on-replacement keeps working.
  sharedRef?: MutableRefObject<T | null>,
): RefCallback<T> {
  const elementRef = useRef<T | null>(null);

  const attach = useCallback((element: T | null) => {
    const previous = elementRef.current;
    if (previous && previous !== element) releaseMediaElement(previous);
    elementRef.current = element;
    if (sharedRef) sharedRef.current = element;
    if (element && source && element.getAttribute("src") !== source) {
      element.setAttribute("src", source);
    }
  }, [sharedRef, source]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (source && element.getAttribute("src") !== source) {
      element.setAttribute("src", source);
    }
    return () => {
      if (elementRef.current === element) releaseMediaElement(element);
    };
  }, [source]);

  return attach;
}

/** A normal `<video>` whose native decoder state is released on replacement. */
export function ReclaimingVideo({
  src,
  elementRef,
  ...props
}: VideoHTMLAttributes<HTMLVideoElement> & {
  elementRef?: MutableRefObject<HTMLVideoElement | null>;
}) {
  const ref = useReclaimingMediaRef<HTMLVideoElement>(
    typeof src === "string" ? src : undefined,
    elementRef,
  );
  return <video {...props} ref={ref} src={src} />;
}

/** A normal `<audio>` whose native decoder state is released on replacement. */
export function ReclaimingAudio({
  src,
  ...props
}: AudioHTMLAttributes<HTMLAudioElement>) {
  const ref = useReclaimingMediaRef<HTMLAudioElement>(
    typeof src === "string" ? src : undefined,
  );
  return <audio {...props} ref={ref} src={src} />;
}
