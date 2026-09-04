"use client";

import { useLanguage, type Locale } from "@/lib/language-context";
import { Languages } from "lucide-react";
import { useState, useRef, useEffect } from "react";

const languageOptions = [
  { value: "zh-CN" as Locale, label: "简体中文" },
  { value: "zh-TW" as Locale, label: "繁體中文" },
  { value: "en" as Locale, label: "English" },
];

export function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLanguage = languageOptions.find((opt) => opt.value === locale);
  const ariaLabel = locale === "en" ? "Switch language" : locale === "zh-TW" ? "切換語言" : "切换语言";

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-2 text-sm text-foreground hover:text-foreground transition-colors"
        aria-label={ariaLabel}
      >
        <Languages className="w-4 h-4" />
        <span className="hidden sm:inline">{currentLanguage?.label}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-36 rounded-lg border bg-background shadow-lg z-50 overflow-hidden">
          {languageOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setLocale(option.value);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                locale === option.value
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
