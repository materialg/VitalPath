import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Helper to find the key in common variable names
  const getApiKey = () => {
    return process.env.GEMINI_API_KEY || 
           process.env.GEMINI_KEY || 
           process.env.GOOGLE_API_KEY || 
           process.env.GOOGLE_KEY || 
           process.env.VITE_GEMINI_API_KEY || 
           process.env.API_KEY || 
           '';
  };

  // AI Configuration check endpoint
  app.get('/api/ai/config', (req, res) => {
    const apiKey = getApiKey();
    const isConfigured = !!(apiKey && apiKey.length > 5 && apiKey !== 'undefined' && apiKey !== 'MY_GEMINI_API_KEY');
    
    console.log('[Server] AI Config check:', { 
      isConfigured, 
      keyLength: apiKey?.length || 0,
      envKeys: Object.keys(process.env).filter(k => k.includes('API') || k.includes('GEMINI')).sort()
    });
    
    res.json({ 
      isConfigured,
      foundKeys: Object.keys(process.env).filter(k => k.includes('API') || k.includes('GEMINI')).sort()
    });
  });

  // AI Proxy Endpoint
  app.post('/api/ai/generate', async (req, res) => {
    const { model, prompt, systemInstruction, responseMimeType, responseSchema } = req.body;
    const apiKey = getApiKey();

    if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(500).json({ error: "Gemini API key is not configured on the server. Please add GEMINI_API_KEY to secrets." });
    }

    try {
      const genAI = new GoogleGenAI({ apiKey });
      
      const response = await genAI.models.generateContent({
        model: model || "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: responseMimeType || "text/plain",
          responseSchema: responseSchema,
          thinkingConfig: { thinkingBudget: 0 },
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("[Server AI Error]:", error);
      res.status(500).json({ error: error.message || "Failed to generate content" });
    }
  });

  // Diagnostic route for the user
  app.get('/api/ai/debug', (req, res) => {
    res.json({
      nodeEnv: process.env.NODE_ENV,
      allEnvKeys: Object.keys(process.env).sort(),
      relevantKeys: Object.keys(process.env).filter(k => k.includes('API') || k.includes('GEMINI') || k.includes('VITAL')).sort(),
      hasValidKey: !!(getApiKey().length > 5)
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
    const key = getApiKey();
    console.log(`[Server] API Key status: ${key ? 'Found (' + key.length + ' chars)' : 'Missing'}`);
  });
}

startServer().catch(err => {
  console.error('[Server Error]:', err);
});
