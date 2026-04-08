/**
 * Persistent File Store
 *
 * Abstracts file storage with two backends:
 *  - Cloud (Replit deployment): Google Cloud Storage via Replit sidecar auth
 *  - On-premise / dev: local filesystem only
 *
 * Authentication uses Replit's sidecar endpoint (http://127.0.0.1:1106) for
 * proper token exchange — NOT Application Default Credentials which lack access.
 *
 * When GCS is configured (DEFAULT_OBJECT_STORAGE_BUCKET_ID env var):
 *   1. After upload → file saved locally AND mirrored to GCS (awaited)
 *   2. Before OCR → if file missing locally, auto-download from GCS
 *
 * When GCS is NOT configured (on-premise / dev without sidecar):
 *   → Local filesystem only
 */

import { Storage } from "@google-cloud/storage";
import { createWriteStream, existsSync } from "fs";
import { unlink } from "fs/promises";
import { pipeline } from "stream/promises";
import { logger } from "./logger";

// ── Replit sidecar auth ───────────────────────────────────────────────────────

const REPLIT_SIDECAR = "http://127.0.0.1:1106";

function makeStorage(): Storage {
  return new Storage({
    credentials: {
      type: "external_account",
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR}/token`,
      credential_source: {
        url: `${REPLIT_SIDECAR}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    } as never,
    projectId: "",
  });
}

// ── GCS client (lazy, singleton) ─────────────────────────────────────────────

let _storage: Storage | null = null;

function getGcsClient(): { storage: Storage; bucket: ReturnType<Storage["bucket"]> } | null {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return null;
  if (!_storage) _storage = makeStorage();
  return { storage: _storage, bucket: _storage.bucket(bucketId) };
}

const GCS_PREFIX = "uploads/";

function gcsObjectName(filename: string): string {
  return `${GCS_PREFIX}${filename}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mirror a locally-saved file to GCS.
 * MUST be awaited before responding to upload requests so that any worker
 * container can subsequently download the file via ensureLocal().
 */
export async function mirrorToCloud(localPath: string, filename: string): Promise<void> {
  const gcs = getGcsClient();
  if (!gcs) return;

  const objectName = gcsObjectName(filename);
  try {
    await gcs.bucket.upload(localPath, {
      destination: objectName,
      metadata: { contentType: "application/octet-stream" },
    });
    logger.info({ filename, objectName }, "file-store: mirrored to GCS");
  } catch (err) {
    logger.warn({ err, filename }, "file-store: GCS mirror failed (file still available locally)");
  }
}

/**
 * Ensure a file exists locally before OCR.
 * If missing locally but GCS is configured, downloads it from GCS.
 * Throws if file is missing everywhere.
 */
export async function ensureLocal(localPath: string, filename: string): Promise<void> {
  if (existsSync(localPath)) return;

  const gcs = getGcsClient();
  if (!gcs) {
    throw new Error(`ملف الرفع غير موجود: ${filename}`);
  }

  const objectName = gcsObjectName(filename);
  const file = gcs.bucket.file(objectName);

  try {
    const [fileExists] = await file.exists();
    if (!fileExists) {
      throw new Error(`ملف الرفع غير موجود في التخزين المحلي أو السحابي: ${filename}`);
    }

    logger.info({ filename, objectName }, "file-store: downloading from GCS to local cache");
    await pipeline(
      file.createReadStream(),
      createWriteStream(localPath),
    );
    logger.info({ filename, localPath }, "file-store: download complete");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("ملف الرفع غير موجود")) {
      throw err;
    }
    logger.error({ err, filename }, "file-store: GCS download error");
    throw new Error(`ملف الرفع غير موجود: ${filename}`);
  }
}

/**
 * Delete a file from both local disk and GCS.
 */
export async function deleteFile(localPath: string, filename: string): Promise<void> {
  try {
    if (existsSync(localPath)) await unlink(localPath);
  } catch (err) {
    logger.warn({ err, localPath }, "file-store: local delete failed");
  }

  const gcs = getGcsClient();
  if (!gcs) return;
  try {
    const objectName = gcsObjectName(filename);
    await gcs.bucket.file(objectName).delete({ ignoreNotFound: true });
    logger.info({ filename, objectName }, "file-store: deleted from GCS");
  } catch (err) {
    logger.warn({ err, filename }, "file-store: GCS delete failed");
  }
}

/**
 * Returns true if GCS persistent storage is configured.
 */
export function isCloudStorageEnabled(): boolean {
  return !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
}
