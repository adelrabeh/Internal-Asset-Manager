import { GoogleGenAI } from "@google/genai";

const directKey = process.env.GEMINI_API_KEY;
const replitKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
const replitBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const cloudflareGateway = process.env.GEMINI_CLOUDFLARE_GATEWAY;

if (!directKey && !replitKey) {
  throw new Error(
    [
      "Gemini API key is not configured.",
      "  Set GEMINI_API_KEY to your Google AI Studio key",
    ].join("\n"),
  );
}

const apiKey = (directKey || replitKey) as string;

// Cloudflare AI Gateway proxy (يتجاوز قيود الشبكة)
// الرابط: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/google-ai-studio
const gatewayUrl = cloudflareGateway || (
  !directKey && replitBaseUrl ? replitBaseUrl : undefined
);

const httpOptions = gatewayUrl
  ? { apiVersion: "", baseUrl: gatewayUrl }
  : undefined;

export const ai = new GoogleGenAI(
  httpOptions ? { apiKey, httpOptions } : { apiKey },
);
