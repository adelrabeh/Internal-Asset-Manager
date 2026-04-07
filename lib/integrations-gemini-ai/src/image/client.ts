import { GoogleGenAI, Modality } from "@google/genai";

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

export async function generateImage(
  prompt: string
): Promise<{ b64_json: string; mimeType: string }> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });

  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in response");
  }

  return {
    b64_json: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || "image/png",
  };
}
