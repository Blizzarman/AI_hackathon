import { fetchCve } from "@/lib/tools/nvd";
import { fetchGithubIssue } from "@/lib/tools/github";

type EnrichInput = {
  entities: {
    cves?: string[];
    issue_refs?: string[];
  };
  githubRepo?: string;
};

export async function stepEnrich(opts: EnrichInput) {
  const enrichment: Record<string, unknown> = {};

  const cves = Array.isArray(opts.entities.cves) ? opts.entities.cves : [];
  if (cves.length > 0) {
    const cveData: Record<string, unknown> = {};
    for (const cve of cves.slice(0, 3)) {
      try {
        cveData[cve] = await fetchCve(cve);
      } catch (error: unknown) {
        cveData[cve] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    enrichment.cves = cveData;
  }

  if (opts.githubRepo && Array.isArray(opts.entities.issue_refs)) {
    const token = process.env.GITHUB_TOKEN;
    const githubData: Record<string, unknown> = {};
    for (const ref of opts.entities.issue_refs.slice(0, 3)) {
      const match = String(ref).match(/^#(\d+)$/);
      if (!match) {
        continue;
      }
      try {
        githubData[ref] = await fetchGithubIssue(opts.githubRepo, Number(match[1]), token);
      } catch (error: unknown) {
        githubData[ref] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    enrichment.github = githubData;
  }

  return enrichment;
}
