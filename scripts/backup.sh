#!/usr/bin/env bash
# ============================================================
# دارة الملك عبدالعزيز — OCR Platform
# سكريبت النسخ الاحتياطي
# ============================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/darah-ocr-backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

GREEN="\033[0;32m"
RESET="\033[0m"
info() { echo -e "${GREEN}[✓]${RESET} $*"; }

source .env 2>/dev/null || true

mkdir -p "${BACKUP_PATH}"

# ── نسخ قاعدة البيانات ──────────────────────────────────────
echo "نسخ احتياطي لقاعدة البيانات..."
docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-darah}" \
  "${POSTGRES_DB:-darah_ocr}" \
  | gzip > "${BACKUP_PATH}/database.sql.gz"
info "قاعدة البيانات: ${BACKUP_PATH}/database.sql.gz"

# ── نسخ الملفات المرفوعة ────────────────────────────────────
echo "نسخ احتياطي للملفات المرفوعة..."
docker run --rm \
  -v darah-ocr-uploads:/data \
  -v "${BACKUP_PATH}":/backup \
  alpine tar czf /backup/uploads.tar.gz -C /data .
info "الملفات: ${BACKUP_PATH}/uploads.tar.gz"

# ── نسخ ملف الإعدادات ────────────────────────────────────────
cp .env "${BACKUP_PATH}/env.backup"
info "الإعدادات: ${BACKUP_PATH}/env.backup"

# ── حذف النسخ القديمة (أكثر من 30 يوم) ─────────────────────
find "${BACKUP_DIR}" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

echo ""
info "اكتمل النسخ الاحتياطي: ${BACKUP_PATH}"
echo "  الحجم: $(du -sh ${BACKUP_PATH} | cut -f1)"
