type DemoClassification = {
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
  category: "OUTAGE" | "DEGRADATION" | "SECURITY" | "DATA" | "OTHER";
  routing_team: string;
  customer_impact: boolean;
};

type DemoEntities = {
  systems: string[];
  regions: string[];
  error_codes: string[];
  vendors: string[];
  cves: string[];
  timestamps: string[];
  issue_refs: string[];
};

type DemoGenerated = {
  summary_md: string;
  next_actions_md: string;
  comms_internal: string;
  comms_external: string;
};

export type DemoIncidentSeed = {
  classification: DemoClassification;
  entities: DemoEntities;
  generated: DemoGenerated;
  raw_text: string;
  enrichment: Record<string, unknown>;
};

function makeRawText(seed: {
  title: string;
  severity: string;
  category: string;
  team: string;
  evidence: string[];
  impact: string;
  refs?: string[];
  cves?: string[];
}): string {
  const refs = (seed.refs ?? []).join(", ");
  const cves = (seed.cves ?? []).join(", ");
  return [
    `Title: ${seed.title}`,
    `Severity: ${seed.severity}`,
    `Category: ${seed.category}`,
    `Routing team: ${seed.team}`,
    `Impact: ${seed.impact}`,
    ...seed.evidence,
    refs ? `Issue refs: ${refs}` : "",
    cves ? `CVE refs: ${cves}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const DEMO_INCIDENTS: DemoIncidentSeed[] = [
  {
    classification: {
      title: "[DEMO] EU Checkout 502 spike on payment confirmation",
      severity: "SEV1",
      category: "OUTAGE",
      routing_team: "payments-api",
      customer_impact: true,
    },
    entities: {
      systems: ["checkout", "payments-api", "edge-alb"],
      regions: ["eu-west-1"],
      error_codes: ["HTTP 502", "HTTP 504", "ELB-502"],
      vendors: ["aws"],
      cves: [],
      timestamps: ["2026-03-01T08:12:00Z"],
      issue_refs: ["#123"],
    },
    generated: {
      summary_md:
        "Checkout confirmation in EU intermittently fails with 502/504 due to elevated upstream timeout rates in payments-api.",
      next_actions_md:
        "- Shift read-heavy calls away from impacted pool\n- Roll back last payments-api deployment\n- Increase upstream timeout budget by 500ms\n- Post customer status update every 20 minutes",
      comms_internal:
        "SEV1 active. Payments API rollback in progress. Error budget exhausted in eu-west-1 checkout confirmation path.",
      comms_external:
        "We are investigating elevated checkout failures affecting some EU users. Mitigation is underway and updates will follow shortly.",
    },
    raw_text: makeRawText({
      title: "EU Checkout 502 spike on payment confirmation",
      severity: "SEV1",
      category: "OUTAGE",
      team: "payments-api",
      impact: "High checkout drop-off in EU storefront",
      evidence: [
        "ALB logs: GET /checkout/confirm -> 502 upstream_connect_error",
        "p95 latency rose from 380ms to 2.4s",
      ],
      refs: ["#123"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "checkout_outage" },
  },
  {
    classification: {
      title: "[DEMO] Search index lag causing stale product results",
      severity: "SEV3",
      category: "DEGRADATION",
      routing_team: "search-platform",
      customer_impact: true,
    },
    entities: {
      systems: ["search-indexer", "catalog-api", "redis-cache"],
      regions: ["us-east-1"],
      error_codes: ["INDEX_LAG"],
      vendors: ["elastic"],
      cves: [],
      timestamps: ["2026-03-01T09:05:00Z"],
      issue_refs: ["#842"],
    },
    generated: {
      summary_md:
        "Catalog updates are visible with 25-35 minute delay because the indexer consumer group is behind after a shard rebalance.",
      next_actions_md:
        "- Reassign hot partitions\n- Increase indexer worker count by 2x\n- Drain stale cache keys for top categories",
      comms_internal:
        "SEV3 degradation. Indexing lag confirmed; no data loss detected. Catch-up ETA ~40 minutes.",
      comms_external:
        "Some product search results may appear outdated. We are applying fixes to restore normal freshness.",
    },
    raw_text: makeRawText({
      title: "Search index lag causing stale product results",
      severity: "SEV3",
      category: "DEGRADATION",
      team: "search-platform",
      impact: "Customers see stale product availability",
      evidence: [
        "Kafka lag: indexer group at 1.8M messages behind",
        "Freshness SLA 5 min, currently 31 min",
      ],
      refs: ["#842"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "search_lag" },
  },
  {
    classification: {
      title: "[DEMO] Suspicious SSH activity on bastion host",
      severity: "SEV2",
      category: "SECURITY",
      routing_team: "security-ops",
      customer_impact: false,
    },
    entities: {
      systems: ["bastion", "iam", "vpn-gateway"],
      regions: ["eu-central-1"],
      error_codes: ["AUTH_ANOMALY"],
      vendors: ["crowdstrike"],
      cves: ["CVE-2024-3094"],
      timestamps: ["2026-03-01T10:10:00Z"],
      issue_refs: ["#901"],
    },
    generated: {
      summary_md:
        "EDR flagged anomalous SSH sessions from unexpected ASN. Access was blocked by policy and keys rotated.",
      next_actions_md:
        "- Complete host forensic capture\n- Rotate all privileged SSH keys\n- Validate IAM token issuance logs\n- Publish post-incident security note",
      comms_internal:
        "SEV2 security event contained. No customer data exposure observed so far; forensic timeline in progress.",
      comms_external:
        "We detected and contained suspicious infrastructure access attempts. There is currently no evidence of customer impact.",
    },
    raw_text: makeRawText({
      title: "Suspicious SSH activity on bastion host",
      severity: "SEV2",
      category: "SECURITY",
      team: "security-ops",
      impact: "No confirmed customer impact",
      evidence: [
        "Failed+successful SSH burst from unknown ASN",
        "Session initiated using legacy key not seen in 90 days",
      ],
      refs: ["#901"],
      cves: ["CVE-2024-3094"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "security_ssh" },
  },
  {
    classification: {
      title: "[DEMO] Warehouse feed duplicate writes in analytics",
      severity: "SEV2",
      category: "DATA",
      routing_team: "data-platform",
      customer_impact: true,
    },
    entities: {
      systems: ["etl-orchestrator", "warehouse", "billing-events"],
      regions: ["us-east-2"],
      error_codes: ["DUPLICATE_KEY", "ETL_RETRY_LOOP"],
      vendors: ["snowflake"],
      cves: [],
      timestamps: ["2026-03-01T11:32:00Z"],
      issue_refs: ["#777"],
    },
    generated: {
      summary_md:
        "Retry loop in ETL replayed billing events and produced duplicated finance aggregates for the current day partition.",
      next_actions_md:
        "- Pause faulty DAG\n- Deduplicate affected partition\n- Recompute finance snapshot\n- Add idempotency guard on replay step",
      comms_internal:
        "SEV2 data integrity incident. Customer-facing totals may be incorrect in dashboards; correction underway.",
      comms_external:
        "Some analytics and billing dashboards may show temporary inconsistencies while we complete data correction.",
    },
    raw_text: makeRawText({
      title: "Warehouse feed duplicate writes in analytics",
      severity: "SEV2",
      category: "DATA",
      team: "data-platform",
      impact: "Incorrect billing totals shown in customer dashboards",
      evidence: [
        "job replay-billing-events retried 14 times",
        "duplicate keys detected in partition dt=2026-03-01",
      ],
      refs: ["#777"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "data_duplicates" },
  },
  {
    classification: {
      title: "[DEMO] Push notifications delayed by provider throttling",
      severity: "SEV4",
      category: "OTHER",
      routing_team: "messaging",
      customer_impact: true,
    },
    entities: {
      systems: ["notification-worker", "queue", "mobile-gateway"],
      regions: ["global"],
      error_codes: ["429_THROTTLED"],
      vendors: ["firebase"],
      cves: [],
      timestamps: ["2026-03-01T12:03:00Z"],
      issue_refs: ["#522"],
    },
    generated: {
      summary_md:
        "Notification delivery latency increased to 6-8 minutes due to temporary upstream throttling from provider API.",
      next_actions_md:
        "- Reduce burst concurrency\n- Enable queue smoothing profile\n- Retry throttled batches with jitter",
      comms_internal:
        "SEV4 minor degradation. No message loss; delay only. Backlog expected to clear within one hour.",
      comms_external:
        "Push notifications are being delivered with slight delays. We are applying mitigations to restore normal timing.",
    },
    raw_text: makeRawText({
      title: "Push notifications delayed by provider throttling",
      severity: "SEV4",
      category: "OTHER",
      team: "messaging",
      impact: "Delayed, not dropped, notifications",
      evidence: [
        "Provider responded 429 with backoff hints",
        "Queue age max 7m12s",
      ],
      refs: ["#522"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "notification_delay" },
  },
  {
    classification: {
      title: "[DEMO] Identity service timeout chain during login",
      severity: "SEV1",
      category: "OUTAGE",
      routing_team: "identity",
      customer_impact: true,
    },
    entities: {
      systems: ["auth-api", "session-store", "oidc-gateway"],
      regions: ["us-west-2", "eu-west-1"],
      error_codes: ["HTTP 503", "REDIS_TIMEOUT"],
      vendors: ["redis"],
      cves: [],
      timestamps: ["2026-03-01T12:40:00Z"],
      issue_refs: ["#612"],
    },
    generated: {
      summary_md:
        "Login failures peaked at 38% after session-store latency spike cascaded through identity token issuance.",
      next_actions_md:
        "- Fail over to warm replica\n- Lower token validation timeout\n- Purge stale connection pool sockets",
      comms_internal:
        "SEV1 login outage. Failover started; expected recovery in 10-15 minutes.",
      comms_external:
        "Some users are unable to sign in right now. Our team is actively restoring full access.",
    },
    raw_text: makeRawText({
      title: "Identity service timeout chain during login",
      severity: "SEV1",
      category: "OUTAGE",
      team: "identity",
      impact: "Major sign-in disruption",
      evidence: [
        "auth-api /token failures 503 at 38%",
        "session-store p99 latency 4.8s",
      ],
      refs: ["#612"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "identity_outage" },
  },
  {
    classification: {
      title: "[DEMO] API gateway WAF false positives on checkout",
      severity: "SEV2",
      category: "DEGRADATION",
      routing_team: "edge-platform",
      customer_impact: true,
    },
    entities: {
      systems: ["api-gateway", "waf", "checkout-api"],
      regions: ["ap-southeast-1"],
      error_codes: ["WAF_BLOCK_942100"],
      vendors: ["cloudflare"],
      cves: [],
      timestamps: ["2026-03-01T13:25:00Z"],
      issue_refs: ["#245"],
    },
    generated: {
      summary_md:
        "A new WAF rule set introduced false positives for valid checkout payloads in APAC traffic.",
      next_actions_md:
        "- Disable offending WAF signature\n- Replay blocked requests sample\n- Add staged rollout checks for managed rules",
      comms_internal:
        "SEV2 checkout degradation. Mitigation deployed to APAC edge; monitoring block-rate normalization.",
      comms_external:
        "We mitigated an issue causing some checkout attempts to fail in APAC. Service is stabilizing.",
    },
    raw_text: makeRawText({
      title: "API gateway WAF false positives on checkout",
      severity: "SEV2",
      category: "DEGRADATION",
      team: "edge-platform",
      impact: "Intermittent failed checkout requests in APAC",
      evidence: [
        "Spike in WAF rule 942100 blocks",
        "Gateway block rate from 0.2% to 9.6%",
      ],
      refs: ["#245"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "waf_false_positive" },
  },
  {
    classification: {
      title: "[DEMO] Build artifact tampering alert in CI",
      severity: "SEV2",
      category: "SECURITY",
      routing_team: "platform-security",
      customer_impact: false,
    },
    entities: {
      systems: ["ci-runner", "artifact-store", "signing-service"],
      regions: ["global"],
      error_codes: ["SIG_MISMATCH"],
      vendors: ["github"],
      cves: ["CVE-2024-3094"],
      timestamps: ["2026-03-01T14:02:00Z"],
      issue_refs: ["#431"],
    },
    generated: {
      summary_md:
        "Code-signing verification failed for one build lane. Pipeline was halted before release publication.",
      next_actions_md:
        "- Quarantine suspicious runner image\n- Rotate signing keys\n- Rebuild from trusted baseline",
      comms_internal:
        "SEV2 security alert in CI supply chain controls. No production deploys were issued from affected lane.",
      comms_external:
        "We detected and contained a CI pipeline integrity alert. No customer action is required at this time.",
    },
    raw_text: makeRawText({
      title: "Build artifact tampering alert in CI",
      severity: "SEV2",
      category: "SECURITY",
      team: "platform-security",
      impact: "No direct customer impact",
      evidence: [
        "signature mismatch for artifact digest sha256:...ac9",
        "runner image hash drifted from golden baseline",
      ],
      refs: ["#431"],
      cves: ["CVE-2024-3094"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "ci_tamper_alert" },
  },
  {
    classification: {
      title: "[DEMO] Recommendation API elevated 5xx under load test bleed",
      severity: "SEV3",
      category: "DEGRADATION",
      routing_team: "ml-platform",
      customer_impact: true,
    },
    entities: {
      systems: ["reco-api", "feature-store", "model-serving"],
      regions: ["us-east-1"],
      error_codes: ["HTTP 500", "MODEL_TIMEOUT"],
      vendors: ["kubernetes"],
      cves: [],
      timestamps: ["2026-03-01T14:35:00Z"],
      issue_refs: ["#318"],
    },
    generated: {
      summary_md:
        "Synthetic load intended for staging leaked into production hostnames and saturated recommendation model workers.",
      next_actions_md:
        "- Block staging token at edge\n- Scale model-serving deployment\n- Add production domain guardrail in load framework",
      comms_internal:
        "SEV3 active. Recommendation endpoints recovered after scale-up; residual latency expected for 15 minutes.",
      comms_external:
        "Personalized recommendations may be slower than usual. We have mitigated the issue and continue to monitor.",
    },
    raw_text: makeRawText({
      title: "Recommendation API elevated 5xx under load test bleed",
      severity: "SEV3",
      category: "DEGRADATION",
      team: "ml-platform",
      impact: "Slower recommendation cards and intermittent errors",
      evidence: [
        "model-serving CPU pinned >95%",
        "unexpected test traffic with user-agent loadbot/2.1",
      ],
      refs: ["#318"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "reco_load_bleed" },
  },
  {
    classification: {
      title: "[DEMO] EU invoice export missing line items",
      severity: "SEV2",
      category: "DATA",
      routing_team: "billing-core",
      customer_impact: true,
    },
    entities: {
      systems: ["invoice-service", "ledger-db", "export-worker"],
      regions: ["eu-west-1"],
      error_codes: ["NULL_REF_ITEM"],
      vendors: ["postgresql"],
      cves: [],
      timestamps: ["2026-03-01T15:12:00Z"],
      issue_refs: ["#669"],
    },
    generated: {
      summary_md:
        "A schema mapping regression dropped optional line-item references in EU invoice export files.",
      next_actions_md:
        "- Patch mapper and re-run export for affected window\n- Validate invoice totals against ledger\n- Notify support with corrected download ETA",
      comms_internal:
        "SEV2 billing data issue. Incorrect invoice exports identified; no payment processing impact.",
      comms_external:
        "Some invoice exports generated today may be incomplete. We are regenerating corrected files.",
    },
    raw_text: makeRawText({
      title: "EU invoice export missing line items",
      severity: "SEV2",
      category: "DATA",
      team: "billing-core",
      impact: "Incomplete invoice exports for subset of customers",
      evidence: [
        "line_items array length mismatch vs ledger entries",
        "regression introduced in mapper release 2.18.4",
      ],
      refs: ["#669"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "invoice_export_data_issue" },
  },
  {
    classification: {
      title: "[DEMO] CDN stale asset propagation delay",
      severity: "SEV4",
      category: "OTHER",
      routing_team: "web-platform",
      customer_impact: true,
    },
    entities: {
      systems: ["cdn", "asset-publisher", "frontend"],
      regions: ["global"],
      error_codes: ["CACHE_STALE"],
      vendors: ["fastly"],
      cves: [],
      timestamps: ["2026-03-01T15:49:00Z"],
      issue_refs: ["#738"],
    },
    generated: {
      summary_md:
        "New static assets took longer than expected to propagate across edge POPs, causing mixed UI versions.",
      next_actions_md:
        "- Trigger global purge for affected prefixes\n- Increase cache-busting entropy in filenames\n- Add post-publish edge validation check",
      comms_internal:
        "SEV4 edge cache consistency issue. No backend impact.",
      comms_external:
        "A subset of users may temporarily see outdated UI assets. Refreshing the page should resolve the issue.",
    },
    raw_text: makeRawText({
      title: "CDN stale asset propagation delay",
      severity: "SEV4",
      category: "OTHER",
      team: "web-platform",
      impact: "Inconsistent frontend assets",
      evidence: [
        "asset hash mismatch across POP checks",
        "cache hit ratio remained normal; invalidation lag detected",
      ],
      refs: ["#738"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "cdn_stale_assets" },
  },
  {
    classification: {
      title: "[DEMO] Payment webhooks backlog in us-east",
      severity: "SEV3",
      category: "DEGRADATION",
      routing_team: "integrations",
      customer_impact: true,
    },
    entities: {
      systems: ["webhook-dispatcher", "queue", "partner-api"],
      regions: ["us-east-1"],
      error_codes: ["WEBHOOK_RETRY"],
      vendors: ["stripe"],
      cves: [],
      timestamps: ["2026-03-01T16:10:00Z"],
      issue_refs: ["#584"],
    },
    generated: {
      summary_md:
        "Webhook delivery retries increased after partner API degraded, creating a regional dispatch backlog.",
      next_actions_md:
        "- Apply per-partner circuit breaker\n- Increase dispatcher worker pool\n- Replay delayed webhook jobs",
      comms_internal:
        "SEV3 integration delay. Events remain durable and will be delivered after backlog drains.",
      comms_external:
        "Some payment status updates may appear delayed. No transactions are lost.",
    },
    raw_text: makeRawText({
      title: "Payment webhooks backlog in us-east",
      severity: "SEV3",
      category: "DEGRADATION",
      team: "integrations",
      impact: "Delayed payment status updates",
      evidence: [
        "partner-api 5xx rate peaked at 14%",
        "webhook queue depth rose to 220k",
      ],
      refs: ["#584"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "webhook_backlog" },
  },
  {
    classification: {
      title: "[DEMO] Privilege escalation policy drift detected",
      severity: "SEV2",
      category: "SECURITY",
      routing_team: "security-ops",
      customer_impact: false,
    },
    entities: {
      systems: ["iam", "policy-engine", "audit-stream"],
      regions: ["global"],
      error_codes: ["POLICY_DRIFT"],
      vendors: ["okta"],
      cves: ["CVE-2024-3094"],
      timestamps: ["2026-03-01T16:42:00Z"],
      issue_refs: ["#915"],
    },
    generated: {
      summary_md:
        "Automated audit detected role policy drift granting elevated permissions to a deprecated service account.",
      next_actions_md:
        "- Revoke drifted grants\n- Rotate credentials for affected service account\n- Run full IAM policy diff",
      comms_internal:
        "SEV2 security control breach prevented before exploitation evidence. Access scope reduced.",
      comms_external:
        "We identified and corrected an internal access policy misconfiguration. No customer data exposure is currently indicated.",
    },
    raw_text: makeRawText({
      title: "Privilege escalation policy drift detected",
      severity: "SEV2",
      category: "SECURITY",
      team: "security-ops",
      impact: "No confirmed customer impact",
      evidence: [
        "policy drift job flagged unexpected s3:* grant",
        "deprecated svc account still active in one workspace",
      ],
      refs: ["#915"],
      cves: ["CVE-2024-3094"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "iam_policy_drift" },
  },
  {
    classification: {
      title: "[DEMO] Customer profile sync lag between regions",
      severity: "SEV3",
      category: "DATA",
      routing_team: "profile-platform",
      customer_impact: true,
    },
    entities: {
      systems: ["profile-service", "cdc-stream", "replication-worker"],
      regions: ["us-east-1", "eu-west-1"],
      error_codes: ["CDC_LAG"],
      vendors: ["kafka"],
      cves: [],
      timestamps: ["2026-03-01T17:08:00Z"],
      issue_refs: ["#447"],
    },
    generated: {
      summary_md:
        "Cross-region profile replication lagged by up to 18 minutes due to CDC partition imbalance.",
      next_actions_md:
        "- Rebalance CDC partitions\n- Increase replication workers\n- Verify profile consistency checksums",
      comms_internal:
        "SEV3 data freshness issue across profile replicas; integrity intact.",
      comms_external:
        "Some profile changes may take longer to appear across regions. We are restoring normal sync times.",
    },
    raw_text: makeRawText({
      title: "Customer profile sync lag between regions",
      severity: "SEV3",
      category: "DATA",
      team: "profile-platform",
      impact: "Delayed profile updates",
      evidence: [
        "cdc lag max 18m",
        "replication worker rebalance churn observed",
      ],
      refs: ["#447"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "profile_sync_lag" },
  },
  {
    classification: {
      title: "[DEMO] Scheduled maintenance notification sent twice",
      severity: "SEV4",
      category: "OTHER",
      routing_team: "customer-comms",
      customer_impact: false,
    },
    entities: {
      systems: ["campaign-service", "email-provider", "scheduler"],
      regions: ["global"],
      error_codes: ["IDEMPOTENCY_MISS"],
      vendors: ["sendgrid"],
      cves: [],
      timestamps: ["2026-03-01T17:35:00Z"],
      issue_refs: ["#301"],
    },
    generated: {
      summary_md:
        "Maintenance email campaign was enqueued twice due to idempotency key mismatch after scheduler retry.",
      next_actions_md:
        "- Stop duplicate campaign jobs\n- Apply idempotency patch\n- Publish internal RCA on scheduler retries",
      comms_internal:
        "SEV4 communication incident. Duplicate messages only; no service impact.",
      comms_external:
        "You may have received duplicate maintenance notifications. Please follow the latest notice content.",
    },
    raw_text: makeRawText({
      title: "Scheduled maintenance notification sent twice",
      severity: "SEV4",
      category: "OTHER",
      team: "customer-comms",
      impact: "No platform impact, duplicate communication",
      evidence: [
        "campaign job retried without prior idempotency token",
        "duplicate send count +98,244",
      ],
      refs: ["#301"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "duplicate_comms" },
  },
  {
    classification: {
      title: "[DEMO] APAC checkout tax calc service unavailable",
      severity: "SEV1",
      category: "OUTAGE",
      routing_team: "tax-engine",
      customer_impact: true,
    },
    entities: {
      systems: ["tax-calc", "checkout", "region-router"],
      regions: ["ap-southeast-2"],
      error_codes: ["HTTP 503", "NO_HEALTHY_UPSTREAM"],
      vendors: ["aws"],
      cves: [],
      timestamps: ["2026-03-01T18:05:00Z"],
      issue_refs: ["#998"],
    },
    generated: {
      summary_md:
        "Tax calculation dependency in APAC returned 503 for all requests after unhealthy upstream set reached 100%.",
      next_actions_md:
        "- Route APAC traffic to failover tax cluster\n- Warm standby instances\n- Validate end-to-end checkout completion",
      comms_internal:
        "SEV1 outage in APAC checkout path. Failover live; monitoring conversion recovery.",
      comms_external:
        "We are currently resolving a checkout issue affecting some APAC users. Service restoration is in progress.",
    },
    raw_text: makeRawText({
      title: "APAC checkout tax calc service unavailable",
      severity: "SEV1",
      category: "OUTAGE",
      team: "tax-engine",
      impact: "Checkout blocked for APAC region",
      evidence: [
        "region-router reported no healthy tax-calc endpoints",
        "checkout confirm success dropped below 60%",
      ],
      refs: ["#998"],
    }),
    enrichment: { demo: true, source: "demo_seed", scenario: "apac_tax_outage" },
  },
];
