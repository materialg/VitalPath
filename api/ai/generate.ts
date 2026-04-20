import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

const getApiKey = () =>
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.API_KEY ||
  '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
  }

  const { model, prompt, systemInstruction, responseMimeType, responseSchema, thinkingBudget } = req.body;
  const budget = typeof thinkingBudget === 'number' ? thinkingBudget : 0;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const response = await genAI.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: responseMimeType || 'text/plain',
        responseSchema,
        thinkingConfig: { thinkingBudget: budget },
      },
    });
    res.json({ text: response.text });
  } catch (error: any) {
    console.error('[Vercel AI Error]:', error);
    res.status(500).json({ error: error.message || 'Failed to generate content' });
  }
}
