import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { generateMealPlanLogic, generateWorkoutPlanLogic } from "./src/services/aiLogic";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Diagnostic Route
  app.get("/api/ai/status", (req, res) => {
    const keys = Object.keys(process.env).filter(k => k.includes("API") || k.includes("KEY") || k.includes("GEMINI") || k.includes("GOOGLE"));
    res.json({
      status: "ok",
      node_env: process.env.NODE_ENV,
      env_keys: keys,
      gemini_key_exists: !!process.env.GEMINI_API_KEY,
      gemini_key_length: process.env.GEMINI_API_KEY?.length || 0,
      gemini_key_prefix: process.env.GEMINI_API_KEY?.substring(0, 4) || "none"
    });
  });

  // AI Proxy Routes
  app.get("/api/ai/config", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    // Leaner check
    const isConfigured = !!(apiKey && apiKey.length > 5 && apiKey !== 'undefined' && apiKey !== 'MY_GEMINI_API_KEY');
    
    console.log(`[Config Check] Key present: ${!!apiKey}, Length: ${apiKey?.length}, Configured: ${isConfigured}`);
    
    res.json({ 
      isConfigured,
      hasKey: !!apiKey
    });
  });

  app.post("/api/ai/generate-meal-plan", async (req, res) => {
    try {
      const { targets, cleanFoodBank } = req.body;
      const plan = await generateMealPlanLogic(targets, cleanFoodBank);
      res.json(plan);
    } catch (error: any) {
      console.error("Meal Generation Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/generate-workout-plan", async (req, res) => {
    try {
      const { profile, weight, bodyFat, previousPlan } = req.body;
      const plan = await generateWorkoutPlanLogic(profile, weight, bodyFat, previousPlan);
      res.json(plan);
    } catch (error: any) {
      console.error("Workout Generation Error:", error);
      res.status(500).json({ error: error.message });
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
    console.log(`[${new Date().toISOString()}] [Server] VitalPath Backend running on http://localhost:${PORT}`);
    console.log(`[Server] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`[Server] GEMINI_API_KEY Configured: ${!!process.env.GEMINI_API_KEY}`);
  });
}

startServer();
