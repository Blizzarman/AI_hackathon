import { fetchWithTimeout } from "@/lib/tools/http";

export async function fetchCve(cveId: string, timeoutMs = 7000) {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": "opssignal-ai" } },
    timeoutMs
  );

  if (!res.ok) {
    throw new Error(`NVD error: ${res.status}`);
  }

  return (await res.json()) as unknown;
}
