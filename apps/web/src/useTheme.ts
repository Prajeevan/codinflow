import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const STORAGE_KEY = "codinflow-theme";

function storedChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  // "system" removes the attribute so the prefers-color-scheme media query in
  // styles.css keeps driving the tokens and tracks the OS live.
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/**
 * Theme state for the toggle. The no-FOUC script in index.html has already
 * applied the stored choice before React mounts; this hook mirrors it and keeps
 * `resolved` (the actual light/dark in effect) current when the OS changes while
 * on "system".
 */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(storedChoice);
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    storedChoice() === "system" ? (systemPrefersDark() ? "dark" : "light") : (storedChoice() as "light" | "dark"),
  );

  useEffect(() => {
    apply(choice);
    setResolved(choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice);

    if (choice !== "system" || typeof matchMedia !== "function") return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const setTheme = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  /** Cycles System → Light → Dark → System for a single-button toggle. */
  const cycle = useCallback(() => {
    setTheme(choice === "system" ? "light" : choice === "light" ? "dark" : "system");
  }, [choice, setTheme]);

  return { choice, resolved, setTheme, cycle };
}
