"use client";

import { useTheme } from "@/lib/theme-context";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="relative p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300"
      aria-label="切换主题"
    >
      <div className="relative w-5 h-5">
        <Sun
          className={`absolute inset-0 w-5 h-5 text-amber-400 transition-all duration-300 ${
            theme === "light" ? "opacity-100 rotate-0" : "opacity-0 -rotate-90"
          }`}
        />
        <Moon
          className={`absolute inset-0 w-5 h-5 text-indigo-400 transition-all duration-300 ${
            theme === "dark" ? "opacity-100 rotate-0" : "opacity-0 rotate-90"
          }`}
        />
      </div>
    </button>
  );
}
