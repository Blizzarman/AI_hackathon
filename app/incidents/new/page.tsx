"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Layout from "@/components/Layout";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function NewIncidentPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      const screenshotBase64 = screenshot ? await fileToDataUrl(screenshot) : undefined;

      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, pastedText, githubRepo, screenshotBase64 }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const { id } = await res.json();
      router.push(`/incidents/${id}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setErr(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      title="New Incident"
      subtitle="Provide raw context and evidence. The pipeline will structure and enrich it."
      backHref="/incidents"
      backLabel="Back to incidents"
    >
      <Card>
        <div className="field">
          <label className="field-label" htmlFor="title-input">
            Title (optional)
          </label>
          <input
            id="title-input"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g., EU checkout 502 errors"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="raw-text">
            Paste logs / email / chat
          </label>
          <textarea
            id="raw-text"
            className="textarea"
            value={pastedText}
            onChange={(event) => setPastedText(event.target.value)}
            placeholder="Paste incident context here..."
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="github-repo">
            GitHub repo for issue enrichment (optional, org/repo)
          </label>
          <input
            id="github-repo"
            className="input"
            value={githubRepo}
            onChange={(event) => setGithubRepo(event.target.value)}
            placeholder="e.g., vercel/next.js"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="screenshot">
            Screenshot (optional)
          </label>
          <input
            id="screenshot"
            className="input-file"
            type="file"
            accept="image/*"
            onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)}
          />
        </div>

        {err ? <pre className="error-box">{err}</pre> : null}

        <div className="button-row">
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? "Running pipeline..." : "Create Incident"}
          </Button>
          <Button variant="secondary" href="/incidents">
            Cancel
          </Button>
        </div>
      </Card>
    </Layout>
  );
}
