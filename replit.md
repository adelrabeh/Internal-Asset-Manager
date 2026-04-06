# منظومة رقمنة الوثائق العربية
## OCR Enterprise Dashboard

A production-grade, fully internal enterprise web app for OCR digitization of handwritten Arabic documents.

---

## Architecture

pnpm monorepo with TypeScript throughout.

### Artifacts / Services

| Artifact | Port | Path | Description |
|---|---|---|---|
| `artifacts/api-server` | 8080 | `/api/*` | Express backend, Drizzle ORM, PostgreSQL |
| `artifacts/ocr-dashboard` | 18689 | `/` | React + Vite Arabic RTL frontend |

### Key Libraries

- `lib/api-zod` — Zod schemas shared between frontend and backend
- `lib/api-client-react` — Auto-generated React Query hooks from OpenAPI spec
- `lib/db` — Drizzle ORM schema and database client

---

## Multi-Stage Workflow

```
Upload (upload permission) → OCR auto-runs → ocr_complete → Quality Review (review permission) → approved | rejected
```

### Job Statuses
| Status | Arabic | Description |
|---|---|---|
| `pending` | في الانتظار | Uploaded, awaiting OCR |
| `processing` | قيد المعالجة | OCR in progress |
| `ocr_complete` | بانتظار المراجعة | OCR done, awaiting reviewer approval |
| `approved` | معتمد | Reviewer approved |
| `rejected` | مرفوض | Reviewer rejected |
| `failed` | فشل | OCR failed |

### Permissions
- `upload` — Can upload files and trigger OCR processing
- `review` — Quality review of `ocr_complete` jobs; sends to `reviewed` or rejects
- `approve` — Final endorsement of `reviewed` jobs; sets final `approved` or `rejected`
- Admin role always has all three permissions

### API Routes
- `POST /api/jobs/:id/review` — requires `review` permission; body: `{action: "approve"|"reject", notes?}`
- `POST /api/jobs/:id/approve` — requires `approve` permission; body: `{action: "approve"|"reject", notes?}`

---

## Features

### Frontend (Arabic RTL)
- **Login page** — Session-based auth, Arabic UI, dark navy theme
- **Dashboard** — Real-time stats, quality pie chart, jobs bar chart, recent activity feed
- **Jobs list** — Filter by status, delete/retry/view actions, pagination
- **Job detail** — OCR result with confidence score, word count, low-confidence words, download DOCX/text
- **Upload** — Drag-and-drop multi-file uploader (JPG/PNG/PDF, 50MB max), auto-processes on upload
- **Admin: Users** — Create/toggle-active/delete users with role management
- **Admin: Audit Logs** — Paginated log table with action badges and timestamps
- **Admin: System** — Server status, queue overview, failed job retry-all, system info

### Backend (Express)
- Session-based authentication with bcryptjs
- **Gemini Vision AI OCR** (primary engine, via Replit AI Integrations proxy) — zero API key needed
- Tesseract.js fallback OCR with ImageMagick preprocessing (300 DPI, deskew, binarise)
- Arabic post-processing: line-level language detection, Alef-Lam repair, bidi strip
- DOCX generator (docx package) for download
- In-memory job queue with worker pool (2 concurrent) + startup resume of pending jobs
- Audit logging on all significant actions
- Full REST API with OpenAPI spec

### OCR Engine
- Primary: Gemini 2.5 Flash Vision — sends each page as compressed JPEG (≤ 4 MB), extracts Arabic (and mixed) text with 92% confidence baseline
- Fallback: Tesseract.js with `ara+eng` LSTM model when Gemini unavailable
- Rate limiting between pages (500 ms) to avoid API overload
- PDF → 300 DPI JPEG conversion via ImageMagick before sending to Gemini

### Database (PostgreSQL + Drizzle ORM)
- `users` — username, email, password_hash, role (admin/user), is_active
- `jobs` — filename, status, retry_count, error_message, processing_duration_ms
- `ocr_results` — extracted_text, refined_text, confidence_score, quality_level, word_count, pass_count
- `audit_logs` — action, resource_type, details, ip_address, user_agent

---

## Default Credentials

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin@1234` | مشرف (Admin) |
| `operator` | `Operator@1234` | مستخدم (User) |

Seeded automatically on first server startup if not existing.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Express session signing secret |
| `PORT` | Auto | Set by Replit per artifact |

---

## Development

```bash
# Start all services
# Use Replit workflow buttons

# Run TypeScript check (frontend)
cd artifacts/ocr-dashboard && npx tsc --noEmit

# Rebuild api-client-react types after codegen
cd lib/api-client-react && pnpm exec tsc --build

# Run codegen (OpenAPI → hooks)
pnpm --filter @workspace/api-zod run codegen
```
