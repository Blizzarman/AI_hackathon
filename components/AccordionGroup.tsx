"use client";

import { ReactNode } from "react";

type AccordionGroupProps = {
  children: ReactNode;
  className?: string;
};

export default function AccordionGroup({ children, className }: AccordionGroupProps) {
  return <div className={`accordion-group ${className ?? ""}`.trim()}>{children}</div>;
}
