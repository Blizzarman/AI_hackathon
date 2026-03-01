"use client";

import { useEffect, useState } from "react";

type SearchInputProps = {
  value: string;
  onDebouncedChange: (value: string) => void;
  delayMs?: number;
  placeholder?: string;
  className?: string;
};

export default function SearchInput({
  value,
  onDebouncedChange,
  delayMs = 250,
  placeholder = "Search...",
  className,
}: SearchInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDebouncedChange(draft);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [draft, delayMs, onDebouncedChange]);

  return (
    <div className={`search-input-wrap ${className ?? ""}`.trim()}>
      <input
        className="input search-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label="Search incidents"
      />
    </div>
  );
}
