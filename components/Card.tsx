"use client";

import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
};

export default function Card({ children, title, subtitle, className }: CardProps) {
  return (
    <section className={`card ${className ?? ""}`.trim()}>
      {title || subtitle ? (
        <header className="card-header">
          {title ? <h2 className="card-title">{title}</h2> : null}
          {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
        </header>
      ) : null}
      <div className="card-body">{children}</div>
    </section>
  );
}
