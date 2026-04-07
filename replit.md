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
| `ocr_complete` | بانتظار المراجعة | OCR done, awaiting reviewer |
| `reviewed` | بانتظار الاعتماد | Quality review passed, awaiting approver |
| `approved` | معتمد | Finally approved |
| `rejected` | مرفوض | Rejected by reviewer or approver |
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
- **Login page** — Session-based auth with brute-force protection UI, Arabic RTL, dark navy theme
- **Dashboard** — Real-time stats, quality pie chart, jobs bar chart, recent activity feed
- **Jobs list** — Filter by status, checkboxes for bulk ZIP export, delete/retry/view actions, pagination
- **Job detail** — Side-by-side original document preview + OCR text, confidence score, word count, download DOCX/text
- **Upload** — Drag-and-drop multi-file uploader (JPG/PNG/PDF, 50MB max), auto-processes on upload
- **Search** — Full-text search in OCR results with Arabic snippet highlighting (/search)
- **Notifications** — Real-time SSE bell icon with unread count badge and dropdown list in header
- **Admin: Users** — Create/toggle-active/delete users with role management
- **Admin: Audit Logs** — Paginated log with action/user filters + color-coded action badges
- **Admin: System** — Server status, queue overview, failed job retry-all, user performance stats table
- **Admin: API Keys** — Generate/revoke external API keys (Bearer ocr_* token auth)

### Security Hardening
- **Helmet.js** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers
- **Rate Limiting** — Global 300 req/min, auth endpoints 20 req/15 min (express-rate-limit)
- **Brute-force lockout** — 5 failed login attempts → 15 min account lockout (tracked in DB)
- **Session hardening** — httpOnly, sameSite, 8-hour maxAge, secure cookie, renamed `sid`
- **Password strength** — Minimum requirements enforced on user creation
- **MIME validation** — File type validated beyond extension check on upload

### Backend (Express)
- Session-based authentication with bcryptjs
- **Gemini Vision AI OCR** (primary engine, via Replit AI Integrations proxy) — zero API key needed
- Tesseract.js fallback OCR with ImageMagick preprocessing (300 DPI, deskew, binarise)
- Arabic post-processing: line-level language detection, Alef-Lam repair, bidi strip
- DOCX generator (docx package) for download
- In-memory job queue with worker pool (2 concurrent) + startup resume of pending jobs
- Audit logging on all significant actions with new action types: JOB_REVIEWED, JOB_APPROVED, ACCOUNT_LOCKED, API_KEY_*
- Full REST API with OpenAPI spec
- SSE real-time notifications (`GET /api/notifications/stream`)
- Bulk ZIP export (`POST /api/jobs/bulk-export`, archiver)

### OCR Engine
- Primary: Gemini 2.5 Flash Vision — sends each page as compressed JPEG (≤ 4 MB), extracts Arabic (and mixed) text with 92% confidence baseline
- Fallback: Tesseract.js with `ara+eng` LSTM model when Gemini unavailable
- Rate limiting between pages (500 ms) to avoid API overload
- PDF → 300 DPI JPEG conversion via ImageMagick before sending to Gemini

### Database (PostgreSQL + Drizzle ORM)
- `users` — username, email, password_hash, role (admin/user), is_active, failed_login_attempts, locked_until
- `jobs` — filename, status, retry_count, error_message, processing_duration_ms, review/approve notes & timestamps
- `ocr_results` — extracted_text, refined_text, confidence_score, quality_level, word_count, pass_count
- `audit_logs` — action, resource_type, details, ip_address, user_agent
- `api_keys` — name, key_hash, prefix, user_id, last_used_at, expires_at, is_active

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
| `UPLOADS_DIR` | Optional | Override uploads directory (default: absolute path derived from `import.meta.url`) |

---

## Critical Architecture Notes

### Binary Tool Resolution (`resolveToolPath`)
All CLI tools (`pdftoppm`, `convert`, `identify`) are resolved at server startup via `resolveToolPath()`:
1. Tries `which <tool>` with the server's inherited PATH
2. Falls back to extended PATH including `/run/current-system/sw/bin`, `~/.nix-profile/bin`, `/nix/var/nix/profiles/default/bin`
3. Logs a warning if not found, returns bare name as last resort

`pdftoppm` comes from the `poppler-utils` Nix package (installed in replit.nix). This provides `pdftoppm` in all environments including production deployments.

### Uploads Directory (CWD-Independent)
The uploads directory is computed from `import.meta.url` (NOT `process.cwd()`):
```typescript
const __packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(__packageRoot, "uploads");
```
This ensures correct path resolution in both development and production regardless of the working directory of the Node.js process. Affected files: `uploads.ts`, `jobs.ts`, `results.ts`, `ocr-engine.ts`.

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
