"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

type AccordionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export default function Accordion({ title, children, defaultOpen = false, className }: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    setHeight(el.scrollHeight);
  }, [children, open]);

  return (
    <section className={`accordion ${open ? "accordion-open" : "accordion-closed"} ${className ?? ""}`.trim()}>
      <button
        type="button"
        className="accordion-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="accordion-title">{title}</span>
        <svg className="accordion-chevron" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.5 7.75L10 12.25L14.5 7.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>

      <div className="accordion-content-wrap" style={{ maxHeight: open ? `${height + 24}px` : "0px" }}>
        <div ref={contentRef} className="accordion-content">
          {children}
        </div>
      </div>
    </section>
  );
}
