import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // AI Configuration check
  app.get("/api/ai/configured", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const isConfigured = !!(apiKey && apiKey !== 'undefined' && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim() !== '');
    res.json({ configured: isConfigured });
  });

  // Proxy Gemini requests to keep the key on the server
  app.post("/api/ai/chat", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
        return res.status(400).json({ error: "Gemini API key is not configured on the server." });
      }

      const { model, contents, config } = req.body;
      
      const client = new GoogleGenAI({ apiKey });
      const result = await client.models.generateContent({ 
        model: model || "gemini-1.5-flash",
        contents,
        config: {
          systemInstruction: config?.systemInstruction,
          responseMimeType: config?.responseMimeType,
          responseSchema: config?.responseSchema,
          thinkingConfig: config?.thinkingConfig,
        }
      });
      
      const text = result.text;
      res.json({ text });
    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ error: error.message || "AI Generation failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
