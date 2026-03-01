import { fetchWithTimeout } from "@/lib/tools/http";

type VendorStatusConfig = {
  vendor: "Cloudflare" | "AWS" | "GitHub";
  url: string;
  parser: (payload: unknown) => { status: string; indicator: string; raw: unknown };
};

const STATUS_CONFIG: Record<string, VendorStatusConfig> = {
  cloudflare: {
    vendor: "Cloudflare",
    url: "https://www.cloudflarestatus.com/api/v2/status.json",
    parser: parseStatuspageV2,
  },
  github: {
    vendor: "GitHub",
    url: "https://www.githubstatus.com/api/v2/status.json",
    parser: parseStatuspageV2,
  },
  aws: {
    vendor: "AWS",
    url: "https://status.aws.amazon.com/data.json",
    parser: parseAwsStatus,
  },
};

function parseStatuspageV2(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const statusObj =
    root.status && typeof root.status === "object"
      ? (root.status as Record<string, unknown>)
      : {};
  const indicator = typeof statusObj.indicator === "string" ? statusObj.indicator : "unknown";
  const description = typeof statusObj.description === "string" ? statusObj.description : "unknown";
  return {
    status: description,
    indicator,
    raw: root,
  };
}

function parseAwsStatus(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const current = typeof root.current === "string" ? root.current : "unknown";
  return {
    status: current,
    indicator: current.toLowerCase().includes("disruption") ? "major" : "none",
    raw: root,
  };
}

export type VendorStatusResult = {
  vendor: "Cloudflare" | "AWS" | "GitHub";
  status: string;
  indicator: string;
  data: unknown;
};

export function normalizeVendorName(value: string): string {
  return value.trim().toLowerCase();
}

export function supportedStatusVendors(): Array<"Cloudflare" | "AWS" | "GitHub"> {
  return ["Cloudflare", "AWS", "GitHub"];
}

export async function fetchVendorStatus(vendorInput: string, timeoutMs = 7000): Promise<VendorStatusResult> {
  const key = normalizeVendorName(vendorInput);
  const cfg = STATUS_CONFIG[key];
  if (!cfg) {
    throw new Error(`Unsupported status vendor: ${vendorInput}`);
  }

  const res = await fetchWithTimeout(
    cfg.url,
    { headers: { Accept: "application/json", "User-Agent": "opssignal-ai" } },
    timeoutMs
  );
  if (!res.ok) {
    throw new Error(`${cfg.vendor} status error: HTTP ${res.status}`);
  }

  const payload = (await res.json()) as unknown;
  const parsed = cfg.parser(payload);
  return {
    vendor: cfg.vendor,
    status: parsed.status,
    indicator: parsed.indicator,
    data: parsed.raw,
  };
}
