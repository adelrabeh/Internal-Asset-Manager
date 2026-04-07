import { GoogleGenAI } from "@google/genai";

/**
 * Gemini AI client — supports two modes:
 *
 * 1. On-premise / self-hosted:
 *    Set GEMINI_API_KEY to your Google AI Studio key.
 *    The client connects directly to Google's API.
 *
 * 2. Replit hosted (development):
 *    Uses AI_INTEGRATIONS_GEMINI_API_KEY + AI_INTEGRATIONS_GEMINI_BASE_URL
 *    provided automatically by the Replit Gemini integration.
 *
 * Priority: GEMINI_API_KEY > AI_INTEGRATIONS_GEMINI_API_KEY
 */

const directKey = process.env.GEMINI_API_KEY;
const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const replitBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

if (!directKey && !replitKey) {
  throw new Error(
    [
      "Gemini API key is not configured.",
      "  For on-premise deployment: set GEMINI_API_KEY to your Google AI Studio key",
      "  (get one at https://aistudio.google.com/app/apikey)",
      "  For Replit hosted: provision the Gemini AI integration in the Replit panel.",
    ].join("\n"),
  );
}

const apiKey = (directKey || replitKey) as string;

const httpOptions =
  !directKey && replitBaseUrl
    ? { apiVersion: "", baseUrl: replitBaseUrl }
    : undefined;

export const ai = new GoogleGenAI(
  httpOptions ? { apiKey, httpOptions } : { apiKey },
);
