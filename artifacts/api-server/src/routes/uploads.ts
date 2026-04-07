import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../lib/auth";
import { logAction } from "../lib/audit";
import { logger } from "../lib/logger";

const router: Router = Router();

// Resolve the package root from the bundle's URL so the uploads directory
// is always absolute and CWD-independent (works in dev and production).
const __packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPLOAD_DIR = process.env.UPLOADS_DIR ?? path.join(__packageRoot, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
logger.info({ UPLOAD_DIR }, "uploads: storage directory");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "image/tiff", "image/tif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("نوع الملف غير مدعوم. المدعوم: JPG، PNG، PDF، TIF."));
    }
  },
});

function getFileType(mimetype: string): "jpg" | "png" | "pdf" | "tif" {
  if (mimetype === "image/jpeg") return "jpg";
  if (mimetype === "image/png") return "png";
  if (mimetype === "image/tiff" || mimetype === "image/tif") return "tif";
  return "pdf";
}

router.post("/uploads", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "لم يتم تحديد أي ملف للرفع." });
    return;
  }

  const fileType = getFileType(req.file.mimetype);

  logger.info(
    { filename: req.file.filename, originalName: req.file.originalname, size: req.file.size },
    "File uploaded successfully",
  );

  await logAction(
    req,
    "FILE_UPLOADED",
    "upload",
    undefined,
    `File uploaded: ${req.file.originalname} (${req.file.size} bytes)`,
  );

  res.json({
    filename: req.file.filename,
    originalFilename: req.file.originalname,
    fileSize: req.file.size,
    fileType,
  });
});

export default router;
