import { collection, addDoc, query, where, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { GoogleGenAI, Type } from "@google/genai";
import type { LiftBankItem } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: message,
    operationType: operationType as any,
    path,
    authInfo: {
      userId: auth.currentUser?.uid || 'anonymous',
      email: auth.currentUser?.email || '',
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || false,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName || '',
        email: provider.email || ''
      })) || []
    }
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (message.includes('permission-denied') || message.includes('Missing or insufficient permissions')) {
    throw new Error("You don't have permission to perform this action. Your session might have expired.");
  }
  if (message.includes('quota-exceeded')) {
    throw new Error("Firestore quota exceeded. Please try again tomorrow.");
  }
  
  throw new Error(message);
}

// Check if AI is configured
export const checkIsAIConfigured = async (): Promise<{ isConfigured: boolean, foundKeys?: string[] }> => {
  try {
    const res = await fetch("/api/ai/config");
    if (!res.ok) return { isConfigured: false };
    return await res.json();
  } catch (e) {
    return { isConfigured: false };
  }
};

// Internal helper to call Gemini via server proxy
async function callAI(model: string, prompt: string, config: any) {
  const response = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      systemInstruction: config.systemInstruction,
      responseMimeType: config.responseMimeType,
      responseSchema: config.responseSchema,
      thinkingBudget: config.thinkingBudget,
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server AI error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}

export { callAI };

export function calculateDailyTargets(profile: any, weight: number, bodyFat: number) {
  if (!profile || !weight || !profile.height || !profile.age) {
    return {
      dailyCalories: 2000,
      macros: { protein: 150, carbs: 200, fats: 65, fiber: 25 },
      tdee: 2500,
      dailyDeficit: 500,
      daysLeft: 90,
      targetWeight: weight || 180
    };
  }

  const weightKg = weight / 2.20462;
  const heightCm = profile.height * 2.54;
  const age = profile.age;
  
  let bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
  if (profile.gender === 'male') {
    bmr += 5;
  } else {
    bmr -= 161;
  }

  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    very_active: 1.9
  };

  let tdee = bmr * (activityMultipliers[profile.activityLevel as keyof typeof activityMultipliers] || 1.2);
  const stepCalories = (profile.dailyStepsGoal || 0) * 0.04;
  tdee += stepCalories;

  const leanBodyMass = weight * (1 - (bodyFat / 100));
  const targetWeight = leanBodyMass / (1 - (profile.goalBodyFat / 100));
  const weightToLose = weight - targetWeight;
  const totalDeficitNeeded = weightToLose * 3500;

  const targetDate = new Date(profile.targetDate);
  const today = new Date();
  const daysLeft = Math.max(1, Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  
  const dailyDeficit = totalDeficitNeeded / daysLeft;
  let targetCalories = Math.round(tdee - dailyDeficit);

  const minCalories = profile.gender === 'male' ? 1500 : 1200;
  targetCalories = Math.max(minCalories, targetCalories);

  const protein = Math.round(leanBodyMass * 1.0);
  const fats = Math.round((targetCalories * 0.30) / 9);
  const carbs = Math.round((targetCalories - (protein * 4) - (fats * 9)) / 4);
  const fiber = Math.round((targetCalories / 1000) * 14);

  return {
    dailyCalories: targetCalories,
    macros: { protein, carbs, fats, fiber },
    tdee: Math.round(tdee),
    dailyDeficit: Math.round(dailyDeficit),
    daysLeft,
    targetWeight: Math.round(targetWeight * 10) / 10
  };
}

export function calculateTargetDate(currentBF: number, goalBF: number, activityLevel: string) {
  if (isNaN(currentBF) || isNaN(goalBF)) return new Date().toISOString().split('T')[0];
  const bfDiff = currentBF - goalBF;
  if (bfDiff <= 0) return new Date().toISOString().split('T')[0];

  const rates: Record<string, number> = {
    sedentary: 0.2,
    light: 0.4,
    moderate: 0.6,
    active: 0.8,
    very_active: 1.0,
  };

  const weeklyRate = rates[activityLevel] || 0.5;
  const weeksNeeded = Math.ceil(bfDiff / weeklyRate);
  
  const target = new Date();
  target.setDate(target.getDate() + (weeksNeeded * 7));
  
  try {
    return target.toISOString().split('T')[0];
  } catch (e) {
    return new Date().toISOString().split('T')[0];
  }
}

export async function logDailyTarget(uid: string, profile: any, weight: number, bodyFat: number, date?: string) {
  const targets = calculateDailyTargets(profile, weight, bodyFat);
  const targetDate = date || new Date().toISOString();
  const dateOnly = targetDate.split('T')[0];
  const q = query(
    collection(db, 'users', uid, 'dailyTargets'),
    where('date', '>=', dateOnly),
    where('date', '<=', dateOnly + '\uf8ff'),
    limit(1)
  );
  
  const snap = await getDocs(q);
  if (snap.empty) {
    await addDoc(collection(db, 'users', uid, 'dailyTargets'), {
      date: targetDate,
      ...targets
    });
  }
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export async function generateWorkoutPlan(
  profile: any,
  weight: number,
  bodyFat: number,
  liftBank: LiftBankItem[],
  previousPlan?: any
) {
  const visible = (liftBank || []).filter(l => !l.hidden);
  const byCategory = {
    push: visible.filter(l => l.category === 'push'),
    pull: visible.filter(l => l.category === 'pull'),
    legs: visible.filter(l => l.category === 'legs'),
    core: visible.filter(l => l.category === 'core'),
    cardio: visible.filter(l => l.category === 'cardio'),
  };

  if (byCategory.push.length === 0 || byCategory.pull.length === 0 || byCategory.legs.length === 0) {
    throw new Error("Your Lift Bank needs at least one Push, Pull, and Legs exercise before AI can build a plan.");
  }

  const allowedNames = visible.map(l => l.name);

  const liftBankSummary = (['push', 'pull', 'legs', 'core', 'cardio'] as const)
    .map(cat => {
      const items = byCategory[cat];
      if (items.length === 0) return '';
      const lines = items.map(l => {
        const equip = l.equipment ? ` [${l.equipment}]` : '';
        const sr = l.defaultSets ? ` — default ${l.defaultSets}×${l.defaultReps || '8-12'}` : '';
        const muscles = l.muscleGroups?.length ? ` — targets: ${l.muscleGroups.join(', ')}` : '';
        return `  - ${l.name}${equip}${sr}${muscles}`;
      });
      return `${cat.toUpperCase()}:\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const prompt = `Build a 7-day PPLR (Push/Pull/Legs/Rest) plan for:
Weight: ${weight} lbs, Body Fat: ${bodyFat}%, Goal: ${profile.goalBodyFat}% BF.

HARD CONSTRAINTS — read carefully:
- Use the PPLR rotation that REPEATS across the week. The exact 7-day schedule is:
    Monday: Push
    Tuesday: Pull
    Wednesday: Legs
    Thursday: Rest
    Friday: Push
    Saturday: Pull
    Sunday: Legs
  That's 6 training days and exactly 1 rest day. Do NOT add extra rest days.
- Each training day must contain 4–6 exercises pulled ONLY from the Lift Bank below. Do NOT invent exercises.
- "Push" days only use PUSH lifts. "Pull" days only use PULL lifts. "Legs" days only use LEGS lifts. You MAY optionally add at most ONE core or cardio finisher to a training day.
- Use the EXACT exercise names from the bank (case-sensitive, no paraphrasing).
- Vary exercise selection between the two Push days (and between the two Pull days, and between the two Legs days) so they aren't identical sessions.
- The Rest day has an empty exercises array and a short recovery note.

LIFT BANK (the only allowed exercise names):

${liftBankSummary}

Return JSON with a "days" array of 7 entries in Monday→Sunday order.`;

  const text = await callAI(
    "gemini-2.5-pro",
    prompt,
    {
      systemInstruction: "You are a strength coach. Output JSON only. Each exercise.name MUST be an exact, character-for-character match of a name from the provided Lift Bank — never invent or rename exercises.",
      thinkingBudget: 1024,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["days"],
        properties: {
          days: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["day", "title", "exercises", "notes"],
              properties: {
                day: { type: Type.STRING, enum: DAY_NAMES },
                title: { type: Type.STRING, enum: ['Push', 'Pull', 'Legs', 'Rest'] },
                notes: { type: Type.STRING },
                exercises: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["name", "sets", "reps", "notes", "prescribedWeight"],
                    properties: {
                      name: { type: Type.STRING, enum: allowedNames },
                      sets: { type: Type.NUMBER },
                      reps: { type: Type.STRING },
                      prescribedWeight: { type: Type.NUMBER },
                      notes: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  );

  const parsed = JSON.parse(text);

  type LiftCategory = LiftBankItem['category'];
  const allowedCatForTitle = (title: string): LiftCategory | null => {
    if (title === 'Push') return 'push';
    if (title === 'Pull') return 'pull';
    if (title === 'Legs') return 'legs';
    return null;
  };
  const liftByName = new Map(visible.map(l => [l.name.toLowerCase().trim(), l] as const));

  if (!Array.isArray(parsed.days) || parsed.days.length !== 7) {
    throw new Error('AI returned a malformed week. Try again.');
  }

  // Force the PPLR rotation regardless of what the model returned for titles.
  const PPLR_TITLES = ['Push', 'Pull', 'Legs', 'Rest', 'Push', 'Pull', 'Legs'];

  for (let i = 0; i < parsed.days.length; i++) {
    const day = parsed.days[i];
    day.day = DAY_NAMES[i];
    day.title = PPLR_TITLES[i];

    if (day.title === 'Rest') {
      day.exercises = [];
      day.notes = day.notes || 'Active recovery and mobility.';
      continue;
    }

    if (!Array.isArray(day.exercises)) day.exercises = [];
    const okCat = allowedCatForTitle(day.title);
    const cleaned: any[] = [];
    const seen = new Set<string>();
    for (const ex of day.exercises) {
      const key = (ex?.name || '').toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      const match = liftByName.get(key);
      if (!match) continue;
      // On-theme exercises only; one core/cardio finisher is allowed.
      if (match.category !== okCat && match.category !== 'core' && match.category !== 'cardio') continue;
      seen.add(key);
      cleaned.push({
        name: match.name,
        sets: ex.sets || match.defaultSets || 3,
        reps: ex.reps || match.defaultReps || '8-12',
        prescribedWeight: ex.prescribedWeight || 0,
        notes: ex.notes || match.notes || '',
        setReps: [],
        setWeights: [],
      });
    }
    day.exercises = cleaned;
  }

  return parsed;
}
