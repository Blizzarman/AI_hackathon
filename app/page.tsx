import Link from "next/link";

const features = [
  {
    title: "Multimodal intake (OCR + ASR)",
    text: "Accept screenshots, pasted logs, and audio snippets in one intake flow.",
  },
  {
    title: "Severity + routing classification",
    text: "Standardize triage with consistent severity labels and team ownership.",
  },
  {
    title: "Entity extraction (CVE, error codes, regions)",
    text: "Structure noisy incident context into actionable entities automatically.",
  },
  {
    title: "Tool enrichment (NVD, GitHub, status pages)",
    text: "Pull external evidence sources to support investigation decisions.",
  },
  {
    title: "Similar incidents (RAG via pgvector)",
    text: "Retrieve comparable past incidents to accelerate diagnosis and response.",
  },
  {
    title: "Export pack (Markdown + JSON)",
    text: "Share incident artifacts with teams and tools in portable formats.",
  },
];

const valueBullets = [
  "Faster time-to-first-update",
  "Consistent severity + routing",
  "Evidence-backed next actions",
];

export default function Home() {
  return (
    <div className="landing-page">
      <header className="nav">
        <div className="container navInner">
          <Link href="/" className="navBrand">
            OpsSignal AI
          </Link>

          <div className="navActions">
            <nav className="navLinks">
              <a href="#product">Product</a>
              <a href="#how">How it works</a>
              <Link href="/architecture">Architecture</Link>
              <Link href="/demo">Guided Demo</Link>
              <Link href="/incidents">Demo</Link>
            </nav>
            <Link className="btn btn-primary navCta" href="/incidents">
              Try Demo
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero container">
          <p className="hero-eyebrow">OpsSignal AI</p>
          <h1>Multimodal Incident Triage + Comms Copilot</h1>
          <p className="hero-sub">
            Turn screenshots, logs, and audio into a structured incident record, clearer updates, and
            evidence-backed investigation steps in minutes.
          </p>

          <div className="hero-cta">
            <Link className="btn btn-primary" href="/incidents">
              Try Demo
            </Link>
            <Link className="btn btn-secondary" href="/incidents/new">
              Create Incident
            </Link>
          </div>

          <ul className="hero-values">
            {valueBullets.map((item) => (
              <li key={item}>
                <span className="value-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="img" focusable="false">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8.5 12.5l2.3 2.3 4.7-4.8" />
                  </svg>
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="container social-proof">
          <span className="chip">Built for Ops, IT, Support, Product</span>
          <span className="chip">HF-hosted Mistral models + pgvector</span>
        </section>

        <section id="product" className="container section">
          <h2>Product features</h2>
          <p className="section-sub">Everything needed to go from noisy input to coordinated response.</p>
          <div className="grid feature-grid">
            {features.map((feature) => (
              <article key={feature.title} className="feature-card">
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="container section">
          <h2>How it works</h2>
          <div className="how-flow">
            <div className="how-step">Ingest (logs/screenshot/audio)</div>
            <div className="how-arrow" aria-hidden="true">
              -&gt;
            </div>
            <div className="how-step">Triage (classify + extract)</div>
            <div className="how-arrow" aria-hidden="true">
              -&gt;
            </div>
            <div className="how-step">Enrich (tools)</div>
            <div className="how-arrow" aria-hidden="true">
              -&gt;
            </div>
            <div className="how-step">Communicate + Learn (updates + RAG)</div>
          </div>
        </section>

        <section className="container section">
          <h2>Architecture</h2>
          <p className="section-sub">Lean, composable flow with model + evidence traceability.</p>
          <pre className="diagram">{`Inputs
  (logs / screenshot / audio)
        |
        v
   AI pipeline
 (triage + extract + generate)
        |
        v
  Evidence tools
 (NVD / GitHub / status pages)
        |
        v
    DB + pgvector
        |
        v
    UI outputs
 (updates / actions / similar incidents)`}</pre>
        </section>
      </main>

      <footer className="container landing-footer">
        <div className="footer-links">
          <Link href="/incidents">/incidents</Link>
          <Link href="/incidents/new">/incidents/new</Link>
          <Link href="/architecture">/architecture</Link>
        </div>
        <p>Hackathon build - portfolio demo</p>
      </footer>
    </div>
  );
}
