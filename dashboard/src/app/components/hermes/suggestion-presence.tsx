"use client";

import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { createContext, useContext, type ReactNode, type Ref } from "react";

export function SuggestionFade({ children, className, ref }: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      className={className}
      inert={!present}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.1 : 0.16, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Keep scope and privacy changes live while the outgoing panel is on screen.
const EmptyStateContent = createContext<ReactNode>(null);

function CurrentEmptyState() {
  return useContext(EmptyStateContent);
}

export function SuggestionEmptyStatePresence({ visible, children, className }: {
  visible: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <EmptyStateContent.Provider value={children}>
      <AnimatePresence mode="popLayout">
        {visible && (
          <SuggestionFade key="empty" className={className}>
            <CurrentEmptyState />
          </SuggestionFade>
        )}
      </AnimatePresence>
    </EmptyStateContent.Provider>
  );
}
