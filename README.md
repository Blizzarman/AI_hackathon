# OpsSignal AI: Multimodal Incident Triage + Comms Copilot

Turn logs, screenshots, and context into structured incidents, investigation-ready evidence, and stakeholder updates in minutes.

## Demo Video

### Public video URL (YouTube / Loom / etc.)
Replace `<PASTE_VIDEO_URL_HERE_OR_LEAVE_EMPTY>` with your public link:

[![Watch OpsSignal AI Demo](docs/screenshots/landing.png)](<PASTE_VIDEO_URL_HERE_OR_LEAVE_EMPTY>)

Direct link: <PASTE_VIDEO_URL_HERE_OR_LEAVE_EMPTY>

### Local video file in repo
If you prefer to ship a local demo file:

- [Download / play local demo video](docs/demo.mp4)

## Demo Script
- Open landing page: `http://localhost:3000/`
- Click **Guided Demo** (`/demo`)
- Open **Incidents** (`/incidents`) and pick a seeded incident
- Open incident detail (`/incidents/[id]`)
- Run **Investigation Copilot** and review tool evidence
- Generate updates, then **Export Markdown** or open **Share view**

## Screenshots

### 1) Landing
![Landing](docs/screenshots/landing.png)

### 2) Incidents
![Incidents](docs/screenshots/incidents.png)

### 3) Incident Detail
![Incident Detail](docs/screenshots/incident-detail.png)

## Problem Statement
Ops, Support, and Product teams often triage incidents from fragmented, noisy inputs (logs, screenshots, chat messages, tickets). This leads to:
- Slow time-to-first-update
- Inconsistent severity/category/routing decisions
- Weak evidence linking between diagnosis and communication

OpsSignal AI provides a single workflow that ingests raw signals, classifies incidents, enriches context with external tools, drafts updates, and keeps an auditable timeline.

## Key Features
- Multimodal intake (pasted logs + screenshot OCR)
- AI triage (severity, category, routing, customer impact)
- AI Transparency panel (signals, reasoning, missing info, confidence)
- Entity extraction (CVE, error codes, regions, refs)
- Investigation copilot with tool results and updated next actions
- Update Generator for internal and external communications
- Similar incidents retrieval (pgvector)
- Export and share views (Markdown/JSON)
- Step-level pipeline logs + timeline events

## How It Works (4 Steps)
1. Ingest: capture raw incident inputs (logs, screenshot, context)
2. Triage: classify severity/category/routing and extract entities
3. Enrich: query evidence sources (e.g., NVD, GitHub, status data)
4. Communicate + Learn: generate updates, store timeline, retrieve similar incidents

## Architecture
```text
[Inputs]
  logs / screenshot / context
          |
          v
[Ingestion]
  OCR + normalization
          |
          v
[Triage]
  classify + entities + AI rationale
          |
          v
[Enrichment]
  tools (NVD / GitHub / status)
          |
          v
[Generation]
  summary + next actions + comms drafts
          |
          v
[Storage]
  Postgres + pgvector
  incidents / artifacts / pipeline_runs / incident_timeline
          |
          v
[UI]
  /incidents list
  /incidents/[id] detail + AI Transparency
  /share/[id]
```

## Tech Stack
- Next.js (App Router)
- React + TypeScript
- PostgreSQL + pgvector
- Hugging Face Inference API (text, embedding, OCR)
- Zod (strict JSON schema validation)
- Docker Compose (local database)

## Setup

### 1) Prerequisites
- Docker Desktop + Docker Compose
- Node.js 20+
- npm 10+
- Hugging Face token (`HF_TOKEN`)

### 2) Start PostgreSQL (pgvector)
From repository root (where `docker-compose.yml` exists):

```bash
docker compose up -d
```

### 3) Initialize DB schema
Run both SQL files.

PowerShell (Windows):
```powershell
Get-Content .\sql\init.sql | docker compose exec -T db psql -U ops -d opssignal
Get-Content .\sql\timeline.sql | docker compose exec -T db psql -U ops -d opssignal
```

macOS/Linux:
```bash
cat ./sql/init.sql | docker compose exec -T db psql -U ops -d opssignal
cat ./sql/timeline.sql | docker compose exec -T db psql -U ops -d opssignal
```

### 4) Configure environment variables
Create `opssignal-ai/.env.local`.

PowerShell (Windows):
```powershell
Copy-Item .\opssignal-ai\.env.example .\opssignal-ai\.env.local
```

macOS/Linux:
```bash
cp ./opssignal-ai/.env.example ./opssignal-ai/.env.local
```

Recommended `.env.local` template:
```env
DATABASE_URL=postgresql://ops:ops@localhost:5432/opssignal

HF_TOKEN=hf_xxx
HF_TEXT_MODEL=mistralai/Mistral-Large-Instruct-2407
HF_EMBED_MODEL=mistralai/Mistral-Embed
HF_EMBED_FALLBACK_MODEL=sentence-transformers/all-MiniLM-L6-v2
HF_OCR_MODEL=microsoft/trocr-base-stage1

GITHUB_TOKEN=ghp_xxx
```

### 5) Install and run app
```bash
cd opssignal-ai
npm install
npm run dev
```

Open: `http://localhost:3000`

## Safety and Responsibility Notes
- External communication drafts are cautious and non-definitive by default.
- AI Transparency exposes signals, uncertainty, and missing information before action.
- Tool enrichment is read-only (no destructive operational actions).
- Human review is expected before public comms or irreversible remediation.

## Roadmap
- Slack/Jira/Zendesk connectors
- Authentication + organization workspaces
- Role-based access control (RBAC)
- Caching and background job orchestration
- Evaluation test suite (classification quality, hallucination checks, comms safety)

## License
TBD (hackathon submission placeholder).
