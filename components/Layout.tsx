"use client";

import { ReactNode } from "react";
import Link from "next/link";
import Container from "@/components/Container";

type LayoutProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
};

export default function Layout({
  children,
  title,
  subtitle,
  actions,
  backHref,
  backLabel = "Back",
}: LayoutProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Container className="topbar-inner">
          <Link className="brand" href="/">
            OpsSignal AI
          </Link>
          <nav className="topnav">
            <Link href="/incidents">Incidents</Link>
            <Link href="/incidents/new">New Incident</Link>
          </nav>
        </Container>
      </header>

      <main className="page-main">
        <Container>
          {backHref ? (
            <div className="back-wrap">
              <Link className="back-link" href={backHref}>
                {backLabel}
              </Link>
            </div>
          ) : null}

          {title || subtitle || actions ? (
            <section className="page-head">
              <div>
                {title ? <h1 className="page-title">{title}</h1> : null}
                {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
              </div>
              {actions ? <div className="page-actions">{actions}</div> : null}
            </section>
          ) : null}

          {children}
        </Container>
      </main>
    </div>
  );
}
