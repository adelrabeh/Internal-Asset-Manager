# دليل النشر المحلي — منصة رقمنة الوثائق
# دارة الملك عبدالعزيز

---

## نظرة عامة على البنية التقنية

```
┌─────────────────────────────────────────────────────────────┐
│                        خادم المؤسسة                         │
│                                                             │
│   ┌──────────────┐    ┌──────────────┐    ┌─────────────┐  │
│   │   Nginx       │    │  API Server  │    │ PostgreSQL  │  │
│   │  (واجهة +     │───▶│  (Node.js)   │───▶│   (قاعدة   │  │
│   │  reverse      │    │  port 8080   │    │  البيانات)  │  │
│   │  proxy)       │    │              │    │             │  │
│   │  port 80      │    │              │    │             │  │
│   └──────────────┘    └──────────────┘    └─────────────┘  │
│                               │                            │
│                        ┌──────┴──────┐                     │
│                        │  /data/     │                     │
│                        │  uploads/   │ ← الملفات المرفوعة  │
│                        │  (volume)   │                     │
│                        └─────────────┘                     │
└─────────────────────────────────────────────────────────────┘
              ▲
              │ HTTP (port 80)
              │
         المستخدمون (متصفح)
```

---

## المتطلبات

### متطلبات الخادم (الحد الأدنى)

| المورد | الحد الأدنى | الموصى به |
|--------|------------|-----------|
| المعالج | 4 cores | 8 cores |
| الذاكرة | 8 GB RAM | 16 GB RAM |
| التخزين | 100 GB SSD | 500 GB SSD |
| نظام التشغيل | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

> **ملاحظة:** احتياج التخزين يعتمد على حجم الوثائق المرفوعة. كل صفحة PDF تستهلك ~2-5 MB.

### البرامج المطلوبة

| البرنامج | الإصدار |
|---------|---------|
| Docker Engine | 24.0+ |
| Docker Compose | 2.20+ |

---

## خطوات التثبيت

### الخطوة 1 — تثبيت Docker

```bash
# تحديث النظام
sudo apt update && sudo apt upgrade -y

# تثبيت Docker
curl -fsSL https://get.docker.com | sudo bash

# إضافة المستخدم الحالي لمجموعة docker (لتجنب sudo)
sudo usermod -aG docker $USER
newgrp docker

# التحقق من التثبيت
docker --version
docker compose version
```

---

### الخطوة 2 — نسخ الكود إلى الخادم

**الخيار أ — نقل ملفات مضغوطة (للشبكات المغلقة):**

```bash
# على جهاز التطوير (Replit): نزّل كود المشروع كـ ZIP
# ثم انقله للخادم عبر SCP أو USB

# على الخادم:
mkdir -p /opt/darah-ocr
cd /opt/darah-ocr
unzip darah-ocr.zip
```

**الخيار ب — عبر Git (إذا كان الشبكة تسمح):**

```bash
mkdir -p /opt/darah-ocr
cd /opt/darah-ocr
git clone <رابط_المستودع> .
```

---

### الخطوة 3 — إعداد متغيرات البيئة

```bash
cd /opt/darah-ocr

# نسخ ملف الإعدادات النموذجي
cp .env.example .env

# تعديل الملف
nano .env
```

**القيم الإلزامية التي يجب تغييرها:**

```bash
# 1. كلمة مرور قاعدة البيانات (اختر كلمة مرور قوية)
POSTGRES_PASSWORD=كلمة_مرور_قوية_هنا

# 2. مفتاح أمان الجلسات (أنشئه بهذا الأمر)
openssl rand -hex 64
# انسخ الناتج وضعه هنا:
SESSION_SECRET=الناتج_من_الأمر_أعلاه

# 3. مفتاح Gemini AI
# احصل عليه من: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=AIza...
```

> **⚠ تحذير أمني:** لا تشارك ملف `.env` مع أحد ولا ترفعه إلى Git.

---

### الخطوة 4 — تشغيل النظام

```bash
cd /opt/darah-ocr

# تشغيل سكريبت النشر الآلي
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

السكريبت سيقوم تلقائياً بـ:
1. التحقق من صحة إعداداتك
2. بناء صور Docker
3. تشغيل قاعدة البيانات وإنشاء الجداول
4. تشغيل جميع الخدمات
5. التحقق من سلامة النظام

---

### الخطوة 5 — الدخول للنظام

افتح المتصفح على: `http://عنوان_IP_الخادم`

| الحساب | اسم المستخدم | كلمة المرور |
|--------|-------------|------------|
| مدير النظام | `admin` | `Admin@1234` |
| المشغّل | `operator` | `Operator@1234` |

> **⚠ هام:** غيّر كلمات المرور فور أول دخول من صفحة إدارة المستخدمين.

---

## إدارة النظام

### أوامر أساسية

```bash
# عرض حالة الخدمات
docker compose ps

# عرض سجلات API (مباشر)
docker compose logs -f api

# عرض سجلات الواجهة
docker compose logs -f frontend

# إيقاف النظام
docker compose down

# إعادة تشغيل خدمة محددة
docker compose restart api

# تحديث النظام بعد تغيير الكود
docker compose build --no-cache
docker compose up -d
```

### مراقبة الموارد

```bash
# استهلاك الموارد
docker stats

# حجم قاعدة البيانات
docker compose exec db psql -U darah -d darah_ocr -c "\l+"

# حجم الملفات المرفوعة
docker volume inspect darah-ocr-uploads
```

---

## النسخ الاحتياطي

### نسخ احتياطي يدوي

```bash
cd /opt/darah-ocr
./scripts/backup.sh
```

النسخة الاحتياطية تشمل:
- **قاعدة البيانات كاملة** (مضغوطة بـ gzip)
- **جميع الوثائق المرفوعة** (مضغوطة)
- **ملف الإعدادات** (.env)

تُحفظ في: `/opt/darah-ocr-backups/YYYYMMDD_HHMMSS/`

### جدولة النسخ الاحتياطي التلقائي

```bash
# فتح جدول cron
crontab -e

# إضافة السطر التالي (نسخ يومي الساعة 2:00 فجراً)
0 2 * * * cd /opt/darah-ocr && ./scripts/backup.sh >> /var/log/darah-backup.log 2>&1
```

### استعادة نسخة احتياطية

```bash
# تحديد مجلد النسخة الاحتياطية
BACKUP_PATH=/opt/darah-ocr-backups/20250101_020000

# 1. استعادة قاعدة البيانات
docker compose exec -T db psql -U darah -d darah_ocr < <(zcat ${BACKUP_PATH}/database.sql.gz)

# 2. استعادة الملفات المرفوعة
docker run --rm \
  -v darah-ocr-uploads:/data \
  -v ${BACKUP_PATH}:/backup \
  alpine tar xzf /backup/uploads.tar.gz -C /data
```

---

## HTTPS والنطاق (اختياري)

لتفعيل HTTPS باستخدام Nginx كـ reverse proxy خارجي:

### تثبيت Certbot (شهادة SSL مجانية)

```bash
sudo apt install certbot python3-certbot-nginx -y

# الحصول على شهادة SSL
sudo certbot --nginx -d اسم_النطاق.sa
```

### أو: شهادة SSL مؤسسية (Self-signed)

```bash
# إنشاء شهادة ذاتية التوقيع (للشبكات الداخلية)
sudo mkdir -p /etc/ssl/darah-ocr
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:4096 \
  -keyout /etc/ssl/darah-ocr/key.pem \
  -out /etc/ssl/darah-ocr/cert.pem \
  -subj "/C=SA/ST=Riyadh/O=Al-Darah/CN=اسم_النطاق"
```

ثم عدّل `nginx/darah-ocr.conf` لإضافة SSL.

---

## استكشاف الأخطاء

### المشكلة: لا يمكن الوصول للنظام على المتصفح

```bash
# 1. تحقق أن جميع الخدمات تعمل
docker compose ps

# 2. تحقق من جدار الحماية
sudo ufw status
sudo ufw allow 80/tcp    # إذا كان UFW مفعلاً
sudo ufw allow 443/tcp   # للـ HTTPS

# 3. تحقق من السجلات
docker compose logs frontend
docker compose logs api
```

### المشكلة: فشل تحميل ملف

```bash
# تحقق أن حجم الملف ضمن الحد (200 MB)
# تحقق من سجل API
docker compose logs api | grep -i "upload\|error"

# تحقق من مساحة التخزين
df -h /var/lib/docker/volumes/
```

### المشكلة: فشل OCR (خطأ Gemini)

```bash
# تحقق من مفتاح Gemini
docker compose exec api env | grep GEMINI

# تحقق من الاتصال بالإنترنت (لخدمة Gemini)
docker compose exec api curl -s https://generativelanguage.googleapis.com

# إذا كانت الشبكة مغلقة — انظر قسم "النشر بدون إنترنت"
```

### المشكلة: بطء شديد في المعالجة

```bash
# تحقق من موارد الخادم
docker stats --no-stream

# زيادة ذاكرة Docker إذا لزم
# في /etc/docker/daemon.json:
{
  "memory": "8g"
}
```

---

## النشر في شبكة مغلقة (بدون إنترنت)

إذا كانت الشبكة الداخلية لا تصل للإنترنت، لا يمكن استخدام Gemini Cloud. الحل: نموذج AI محلي.

> **ملاحظة:** هذا الخيار يتطلب خادماً بـ GPU قوية (NVIDIA RTX 3090 أو أفضل) للحصول على أداء مقبول.

### تثبيت Ollama (نموذج محلي)

```bash
# على الخادم ذو GPU
curl -fsSL https://ollama.ai/install.sh | sh

# تحميل نموذج يدعم الرؤية (Vision)
ollama pull llava:13b
# أو للعربية بشكل أفضل:
ollama pull llama3.2-vision:11b
```

ثم تعديل في `.env`:
```bash
# إزالة GEMINI_API_KEY
# إضافة:
OLLAMA_BASE_URL=http://localhost:11434
USE_LOCAL_OCR=true
```

> **ملاحظة:** دعم Ollama يتطلب تعديلات على كود OCR Engine. تواصل مع فريق التطوير لتفعيله.

---

## الأمان والصلاحيات

### قائمة التحقق الأمنية للإنتاج

- [ ] تغيير كلمات المرور الافتراضية (admin, operator)
- [ ] إعداد جدار الحماية (UFW أو iptables)
- [ ] تفعيل HTTPS إذا كان النظام متاحاً خارج الشبكة الداخلية
- [ ] ضبط النسخ الاحتياطي التلقائي
- [ ] تقييد الوصول للمنفذ 5432 (PostgreSQL) من الخارج
- [ ] مراجعة سجلات التدقيق بانتظام من لوحة الإدارة
- [ ] تحديث كلمات مرور قاعدة البيانات دورياً

### تقييد الوصول للشبكة الداخلية فقط

```bash
# السماح للشبكة الداخلية فقط بالوصول للمنفذ 80
sudo ufw allow from 192.168.0.0/16 to any port 80
sudo ufw deny 80
```

---

## التحديث إلى إصدار جديد

```bash
cd /opt/darah-ocr

# 1. نسخ احتياطي قبل التحديث
./scripts/backup.sh

# 2. سحب الكود الجديد
git pull origin main  # أو انسخ الملفات الجديدة يدوياً

# 3. إعادة البناء والتشغيل
docker compose build --no-cache
docker compose up -d

# 4. ترحيل قاعدة البيانات (إذا لزم)
docker compose run --rm db-migrate
```

---

## الدعم الفني

للاستفسارات التقنية المتعلقة بالنشر:
- مراجعة السجلات: `docker compose logs -f`
- فحص الصحة: `http://localhost/api/healthz`
- سجلات التدقيق: متاحة في لوحة الإدارة داخل النظام
