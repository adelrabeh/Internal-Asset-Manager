#!/usr/bin/env bash
# ============================================================
# دارة الملك عبدالعزيز — OCR Platform
# سكريبت النشر الكامل على خادم محلي
# ============================================================
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()    { echo -e "${GREEN}[✓]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[!]${RESET} $*"; }
error()   { echo -e "${RED}[✗]${RESET} $*"; exit 1; }
section() { echo -e "\n${BOLD}══ $* ══${RESET}"; }

# ── التحقق من المتطلبات ──────────────────────────────────────
section "فحص المتطلبات"

command -v docker  &>/dev/null || error "Docker غير مثبّت. راجع: https://docs.docker.com/engine/install/"
command -v docker compose &>/dev/null 2>&1 || \
  docker-compose version &>/dev/null 2>&1 || \
  error "Docker Compose غير مثبّت."

info "Docker: $(docker --version)"

# ── التحقق من ملف .env ───────────────────────────────────────
section "فحص ملف الإعدادات"

if [ ! -f ".env" ]; then
  warn "ملف .env غير موجود — جارٍ نسخه من .env.example"
  cp .env.example .env
  error "عدّل ملف .env وضع القيم الصحيحة، ثم أعد تشغيل السكريبت"
fi

# التحقق من القيم الحاسمة
source .env 2>/dev/null || true

[[ -z "${POSTGRES_PASSWORD:-}" || "${POSTGRES_PASSWORD}" == "CHANGE_ME"* ]] && \
  error "POSTGRES_PASSWORD في .env لم تُضبط. غيّرها لكلمة مرور قوية."

[[ -z "${SESSION_SECRET:-}" || "${SESSION_SECRET}" == "CHANGE_ME"* ]] && \
  error "SESSION_SECRET في .env لم تُضبط. أنشئها بـ: openssl rand -hex 64"

[[ -z "${GEMINI_API_KEY:-}" || "${GEMINI_API_KEY}" == "your_google"* ]] && \
  error "GEMINI_API_KEY في .env لم تُضبط. احصل عليه من: https://aistudio.google.com/app/apikey"

info "ملف .env سليم"

# ── بناء الصور ───────────────────────────────────────────────
section "بناء صور Docker"
docker compose build --no-cache
info "اكتمل البناء"

# ── ترحيل قاعدة البيانات ─────────────────────────────────────
section "ترحيل قاعدة البيانات"
docker compose up -d db
info "انتظار جاهزية قاعدة البيانات..."
sleep 5
docker compose run --rm db-migrate
info "قاعدة البيانات جاهزة"

# ── تشغيل الخدمات ───────────────────────────────────────────
section "تشغيل الخدمات"
docker compose up -d
info "جميع الخدمات تعمل"

# ── التحقق من الصحة ─────────────────────────────────────────
section "فحص صحة الخدمات"
sleep 10

HTTP_PORT="${HTTP_PORT:-80}"

if curl -sf "http://localhost:${HTTP_PORT}/api/healthz" > /dev/null; then
  info "API يعمل بشكل صحيح"
else
  warn "API لم يستجب بعد — تحقق من: docker compose logs api"
fi

if curl -sf "http://localhost:${HTTP_PORT}/" > /dev/null; then
  info "الواجهة تعمل بشكل صحيح"
else
  warn "الواجهة لم تستجب — تحقق من: docker compose logs frontend"
fi

# ── ملخص النشر ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}   النظام يعمل بنجاح!${RESET}"
echo -e "${BOLD}════════════════════════════════════════════${RESET}"
echo ""
echo -e "  الرابط:        ${BOLD}http://localhost:${HTTP_PORT}${RESET}"
echo -e "  المدير:        ${BOLD}admin${RESET} / ${BOLD}Admin@1234${RESET}"
echo -e "  المشغّل:       ${BOLD}operator${RESET} / ${BOLD}Operator@1234${RESET}"
echo ""
echo -e "${YELLOW}  ⚠ غيّر كلمات المرور الافتراضية فور الدخول!${RESET}"
echo ""
echo -e "  سجلات API:     docker compose logs -f api"
echo -e "  إيقاف النظام:  docker compose down"
echo -e "  نسخ احتياطي:   ./scripts/backup.sh"
echo ""
