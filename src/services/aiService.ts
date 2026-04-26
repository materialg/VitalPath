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
const PPLR_TITLES = ['Push', 'Pull', 'Legs', 'Rest', 'Push', 'Pull', 'Legs'] as const;
const EXERCISES_PER_DAY = 3;

// Build the week deterministically from the user's Lift Bank — no AI call,
// no hallucinated exercises. Each training day samples lifts tagged with the
// matching category. Same-category days within the same week are sampled
// without replacement when the bank is large enough, so the two Push days
// (and Pull, Legs) get different exercises.
export async function generateWorkoutPlan(
  _profile: any,
  _weight: number,
  _bodyFat: number,
  liftBank: LiftBankItem[],
  _previousPlan?: any
) {
  const visible = (liftBank || []).filter(l => !l.hidden);
  const byCategory = {
    push: visible.filter(l => l.category === 'push'),
    pull: visible.filter(l => l.category === 'pull'),
    legs: visible.filter(l => l.category === 'legs'),
  };

  if (byCategory.push.length === 0 || byCategory.pull.length === 0 || byCategory.legs.length === 0) {
    throw new Error("Your Lift Bank needs at least one Push, Pull, and Legs exercise before a plan can be built.");
  }

  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const pools = {
    push: shuffle(byCategory.push),
    pull: shuffle(byCategory.pull),
    legs: shuffle(byCategory.legs),
  };
  const used: Record<'push' | 'pull' | 'legs', Set<string>> = {
    push: new Set(),
    pull: new Set(),
    legs: new Set(),
  };

  const pickFor = (cat: 'push' | 'pull' | 'legs', count: number): LiftBankItem[] => {
    const pool = pools[cat];
    const fresh = pool.filter(l => !used[cat].has(l.id));
    const picks = fresh.slice(0, count);
    if (picks.length < count) {
      // Bank too small to fill this day with fresh lifts — refill from the top
      // of the (still shuffled) pool, allowing repeats across the two same-cat days.
      const refill = pool.filter(l => !picks.some(p => p.id === l.id));
      picks.push(...refill.slice(0, count - picks.length));
    }
    picks.forEach(p => used[cat].add(p.id));
    return picks;
  };

  const exerciseFromLift = (lift: LiftBankItem) => {
    const sets = lift.defaultSets || 4;
    return {
      name: lift.name,
      sets,
      reps: lift.defaultReps || '8-12',
      prescribedWeight: 0,
      notes: lift.notes || '',
      setReps: Array(sets).fill(0),
      setWeights: Array(sets).fill(0),
    };
  };

  const days = PPLR_TITLES.map((title, i) => {
    if (title === 'Rest') {
      return {
        day: DAY_NAMES[i],
        title: 'Rest',
        exercises: [],
        notes: 'Active recovery and mobility.',
      };
    }
    const cat = title.toLowerCase() as 'push' | 'pull' | 'legs';
    const lifts = pickFor(cat, EXERCISES_PER_DAY);
    return {
      day: DAY_NAMES[i],
      title,
      exercises: lifts.map(exerciseFromLift),
      notes: '',
    };
  });

  return { days };
}
