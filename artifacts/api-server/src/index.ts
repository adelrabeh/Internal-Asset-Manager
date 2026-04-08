import app from "./app";
import { logger } from "./lib/logger";
import { resumePendingJobs } from "./lib/job-queue";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run database migration on startup
async function runMigration() {
  try {
    const client = await pool.connect();
    // Create tables if they don't exist using raw SQL from schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" serial PRIMARY KEY,
        "username" text NOT NULL UNIQUE,
        "email" text NOT NULL UNIQUE,
        "password_hash" text NOT NULL,
        "role" text NOT NULL DEFAULT 'user',
        "permissions" text[] DEFAULT '{}',
        "is_active" boolean NOT NULL DEFAULT true,
        "failed_login_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      );
      CREATE TABLE IF NOT EXISTS "projects" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "description" text,
        "status" text NOT NULL DEFAULT 'active',
        "folder_path" text,
        "created_by" integer,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "project_members" (
        "id" serial PRIMARY KEY,
        "project_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "jobs" (
        "id" serial PRIMARY KEY,
        "filename" text NOT NULL,
        "original_name" text,
        "file_path" text,
        "file_size" integer,
        "mime_type" text,
        "status" text NOT NULL DEFAULT 'pending',
        "retry_count" integer NOT NULL DEFAULT 0,
        "error_message" text,
        "ocr_text" text,
        "confidence_score" integer,
        "word_count" integer,
        "processing_duration_ms" integer,
        "review_notes" text,
        "reviewed_at" timestamp,
        "reviewed_by" integer,
        "approve_notes" text,
        "approved_at" timestamp,
        "approved_by" integer,
        "project_id" integer,
        "uploaded_by" integer,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" serial PRIMARY KEY,
        "user_id" integer,
        "username" text,
        "action" text NOT NULL,
        "resource_type" text,
        "resource_id" integer,
        "details" json,
        "ip_address" text,
        "user_agent" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS "api_keys" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "key_hash" text NOT NULL UNIQUE,
        "key_prefix" text NOT NULL,
        "user_id" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "last_used_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);
    client.release();
    logger.info("Database migration completed");
  } catch (err) {
    logger.error({ err }, "Migration failed (continuing anyway)");
  }
}

runMigration().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    void resumePendingJobs();
  });
});
