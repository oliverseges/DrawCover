import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { RecognitionResult } from "@/lib/recognition";

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export class MissingApiKeyError extends Error {}
export class InvalidModelOutputError extends Error {}

const resultSchema = z.object({
  label: z.string().min(1),
  confidence: z.number().min(0).max(1),
  description: z.string(),
  alternatives: z.array(z.string()).default([]),
});

const responseJsonSchema = {
  type: "object",
  properties: {
    label: { type: "string", description: "Short name of the drawn subject, lowercase." },
    confidence: { type: "number", description: "Confidence from 0 to 1." },
    description: { type: "string", description: "One sentence describing what you see." },
    alternatives: {
      type: "array",
      items: { type: "string" },
      description: "Up to 3 other plausible guesses.",
    },
  },
  required: ["label", "confidence", "description", "alternatives"],
};

const PROMPT =
  "This image is a hand-drawn sketch made by a person in a simple drawing app. " +
  "Identify what it depicts and give your best guess, even if the drawing is rough. " +
  'Only answer with the label "unclear" (and low confidence) if the canvas is blank or just noise. ' +
  "Respond in JSON.";

export async function recognizeDrawing(pngBase64: string): Promise<RecognitionResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new MissingApiKeyError("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: PROMPT }, { inlineData: { mimeType: "image/png", data: pngBase64 } }],
      },
    ],
    config: { responseMimeType: "application/json", responseJsonSchema },
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text ?? "");
  } catch {
    throw new InvalidModelOutputError("Model returned non-JSON output");
  }
  const result = resultSchema.safeParse(parsed);
  if (!result.success) throw new InvalidModelOutputError("Model output failed validation");
  return { ...result.data, alternatives: result.data.alternatives.slice(0, 3) };
}
