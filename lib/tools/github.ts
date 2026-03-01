import { fetchWithTimeout } from "@/lib/tools/http";

type GithubTimeoutOptions = {
  timeoutMs?: number;
};

function githubRequestInit(token?: string): RequestInit {
  return {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
}

export async function fetchGithubIssue(
  repo: string,
  issueNumber: number,
  token?: string,
  options: GithubTimeoutOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? 7000;
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
    githubRequestInit(token),
    timeoutMs
  );

  if (!res.ok) {
    throw new Error(`GitHub error: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as unknown;
}

export async function searchGithubIssues(
  query: string,
  token?: string,
  options: GithubTimeoutOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? 7000;
  const encoded = encodeURIComponent(query);
  const res = await fetchWithTimeout(
    `https://api.github.com/search/issues?q=${encoded}&per_page=5`,
    githubRequestInit(token),
    timeoutMs
  );

  if (!res.ok) {
    throw new Error(`GitHub search error: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as unknown;
}
