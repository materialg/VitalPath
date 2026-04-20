import { GoogleGenAI } from "@google/genai";

export enum Type {
  OBJECT = "object",
  ARRAY = "array",
  STRING = "string",
  NUMBER = "number",
  INTEGER = "integer",
  BOOLEAN = "boolean"
}

export enum ThinkingLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high"
}

export async function callAI(model: string, contents: any, config: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error("Gemini API key is not configured on the server.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const text = contents[0]?.parts?.[0]?.text || "";
  const result = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text }] }]
  });
  return result.text;
}

export async function callAIWithConfig(model: string, contents: any, config: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error("Gemini API key is not configured on the server.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const text = contents.map((c: any) => c.parts).flat()[0]?.text || "";

  const result = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      systemInstruction: config.systemInstruction,
      responseMimeType: config.responseMimeType,
      responseSchema: config.responseSchema,
    }
  });

  return result.text;
}
