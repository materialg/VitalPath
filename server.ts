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

  // AI Proxy Routes
  app.get("/api/ai/config", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    const isConfigured = !!(apiKey && apiKey !== 'undefined' && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim() !== '');
    res.json({ isConfigured });
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
