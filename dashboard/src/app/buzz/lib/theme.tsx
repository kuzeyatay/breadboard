"use client";

// The slice of Buzz's ThemeProvider its UI primitives actually consume.
//
// Upstream this is 750 lines: Tauri window chrome, syntax-theme loading, an
// adaptive palette generated from the editor theme. None of that applies to a
// page inside Breadboard, and the vendored primitives only ever read `isDark`
// — dialog and sheet use it to pick an overlay tint. So this provides that,
// plus the class the vendored stylesheet keys its dark palette on.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "buzz.theme";

interface BuzzThemeValue {
  isDark: boolean;
  setIsDark: (next: boolean) => void;
  toggle: () => void;
}

const BuzzThemeContext = createContext<BuzzThemeValue>({
  isDark: true,
  setIsDark: () => {},
  toggle: () => {},
});

export function BuzzThemeProvider({
  children,
  defaultDark = true,
}: {
  children: ReactNode;
  defaultDark?: boolean;
}) {
  // Server and first client paint must agree, so the stored choice is read in
  // an effect rather than during render.
  const [isDark, setIsDarkState] = useState(defaultDark);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") setIsDarkState(stored === "dark");
    } catch {
      // A blocked storage API is not a reason to render the wrong thing; the
      // default stands.
    }
  }, []);

  const setIsDark = useCallback((next: boolean) => {
    setIsDarkState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Preference is lost on reload; the session still switches.
    }
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
