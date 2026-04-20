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

  // AI Configuration check endpoint
  app.get('/api/ai/config', (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const isConfigured = !!(apiKey && apiKey.length > 5 && apiKey !== 'undefined' && apiKey !== 'MY_GEMINI_API_KEY');
    
    console.log('[Server] AI Config check:', { isConfigured, keyLength: apiKey?.length || 0 });
    
    res.json({ 
      isConfigured,
      // Prefix provided for debugging only if needed, obscured
      prefix: apiKey ? apiKey.substring(0, 4) : null 
    });
  });

  // AI Proxy Endpoint
  app.post('/api/ai/generate', async (req, res) => {
    const { model, prompt, systemInstruction, responseMimeType, responseSchema } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(500).json({ error: "Gemini API key is not configured on the server." });
    }

    try {
      const genAI = new GoogleGenAI({ apiKey });
      
      const response = await genAI.models.generateContent({
        model: model || "gemini-3-flash-preview",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: responseMimeType || "text/plain",
          responseSchema: responseSchema,
        }
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("[Server AI Error]:", error);
      res.status(500).json({ error: error.message || "Failed to generate content" });
    }
  });

  // Diagnostic route
  app.get('/api/ai/debug', (req, res) => {
    res.json({
      envKeys: Object.keys(process.env).sort(),
      nodeEnv: process.env.NODE_ENV,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      keyPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 4) : 'N/A'
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
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
    console.log(`[Server] GEMINI_API_KEY status: ${process.env.GEMINI_API_KEY ? 'Configured' : 'Missing'}`);
  });
}

startServer().catch(err => {
  console.error('[Server Error]:', err);
});
