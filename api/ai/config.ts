import type { VercelRequest, VercelResponse } from '@vercel/node';

const getApiKey = () =>
  process.env.GEMINI_API_KEY ||
  process.env.GEMINI_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.API_KEY ||
  '';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const apiKey = getApiKey();
  const isConfigured = !!(apiKey && apiKey.length > 5 && apiKey !== 'undefined');
  res.json({
    isConfigured,
    foundKeys: Object.keys(process.env)
      .filter(k => k.includes('API') || k.includes('GEMINI'))
      .sort(),
  });
}
