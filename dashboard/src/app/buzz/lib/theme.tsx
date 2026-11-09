"use client";

// Keep the vendored primitives on the same theme as their Breadboard host,
// including desktop restores and scheduled light/dark changes.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useSurfaceTheme } from "@/app/components/effects/use-surface-theme";
import { applyAppTheme } from "@/lib/app-theme";

interface BuzzThemeValue {
  isDark: boolean;
  setIsDark: (next: boolean) => void;
  toggle: () => void;
}

const BuzzThemeContext = createContext<BuzzThemeValue>({
  isDark: false,
  setIsDark: () => {},
  toggle: () => {},
});

export function BuzzThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const isDark = useSurfaceTheme() === "dark";
  const setIsDark = useCallback((next: boolean) => {
    applyAppTheme(next ? "dark" : "light");
  }, []);

  const value = useMemo<BuzzThemeValue>(
    () => ({ isDark, setIsDark, toggle: () => setIsDark(!isDark) }),
    [isDark, setIsDark],
  );

  return (
    <BuzzThemeContext.Provider value={value}>{children}</BuzzThemeContext.Provider>
  );
}

export function useTheme(): BuzzThemeValue {
  return useContext(BuzzThemeContext);
}
