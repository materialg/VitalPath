import { collection, addDoc, query, where, getDocs, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { GoogleGenAI, Type } from "@google/genai";
import { sanitizeMeal, stripUndefined, SLOT_TAGS } from './mealSanitizer';
import type { Meal } from '../types';

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
      responseSchema: config.responseSchema
    })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server AI error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}

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

  const protein = Math.round(weight * 1.0); 
  const fats = Math.round((targetCalories * 0.25) / 9); 
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

async function generateDay(dayName: string, prompt: string, cleanFoodBank: any[], foodBankNames: string[]) {
  const text = await callAI(
    "gemini-2.5-flash",
    prompt,
    {
      systemInstruction: "You are a strict meal planning engine. Return exactly 3 meals in this order with these exact names: \"Breakfast\", \"Lunch\", \"Dinner\". Do NOT add adjectives or dish names to the meal name field. Balance protein and calories evenly across all 3 meals. Max 300g of meat per meal. Hit daily targets +/- 20kcal. No hallucinations. RETURN ONLY JSON. IMPORTANT: Use whole numbers (integers) ONLY for items with unit-based serving sizes.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["meals"],
        properties: {
          meals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["name", "calories", "protein", "carbs", "fats", "fiber", "ingredientsWithAmounts"],
              properties: {
                name: { type: Type.STRING },
                calories: { type: Type.NUMBER },
                protein: { type: Type.NUMBER },
                carbs: { type: Type.NUMBER },
                fats: { type: Type.NUMBER },
                fiber: { type: Type.NUMBER },
                ingredientsWithAmounts: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["name", "amount"],
                    properties: {
                      name: { type: Type.STRING },
                      amount: { type: Type.STRING }
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

  if (!text) throw new Error(`Empty response for ${dayName}`);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  const data = JSON.parse(jsonStr);

  const rawMeals = Array.isArray(data?.meals) ? data.meals : [];
  const MEAL_SLOTS = ["Breakfast", "Lunch", "Dinner"];
  const meals: Meal[] = [];
  for (let idx = 0; idx < MEAL_SLOTS.length; idx++) {
    const raw = rawMeals[idx];
    if (!raw) continue;
    const sanitized =
      sanitizeMeal(raw, cleanFoodBank as any, SLOT_TAGS[idx]) ||
      sanitizeMeal(raw, cleanFoodBank as any);
    if (sanitized) meals.push({ ...sanitized, name: MEAL_SLOTS[idx] });
  }

  if (meals.length === 0) {
    throw new Error(`No valid meals could be built for ${dayName} from your Food Bank.`);
  }

  return { day: dayName, meals };
}

export async function generateMealPlan(profile: any, weight: number, bodyFat: number, foodBankItems: any[] = []) {
  const availableItems = foodBankItems.filter(i => !i.hidden);
  if (availableItems.length === 0) {
    throw new Error("All your Food Bank items are hidden or the Food Bank is empty.");
  }

  const targets = calculateDailyTargets(profile, weight, bodyFat);
  const cleanFoodBank = availableItems.map(i => ({
    name: i.name.trim(),
    servingSize: i.servingSize,
    servingUnit: i.servingUnit,
    calories: i.calories,
    protein: i.protein,
    carbs: i.carbs,
    fats: i.fats,
    fiber: i.fiber,
    mealTypes: i.mealTypes || []
  }));

  const foodBankNames = Array.from(new Set(cleanFoodBank.map(i => i.name)));

  const fmtItem = (i: typeof cleanFoodBank[number]) => {
    const constraint = i.servingUnit === 'unit' ? ' (WHOLE UNIT ONLY)' : '';
    return `- ${i.name}: ${i.calories} cal, ${i.protein}g P per ${i.servingSize}${i.servingUnit}${constraint}`;
  };

  const isUntagged = (i: typeof cleanFoodBank[number]) => !i.mealTypes || i.mealTypes.length === 0;
  const untagged = cleanFoodBank.filter(isUntagged);
  const forSlot = (tag: 'B' | 'L' | 'D') =>
    cleanFoodBank.filter(i => (i.mealTypes || []).includes(tag)).concat(untagged);

  const slotList = (label: string, items: typeof cleanFoodBank) =>
    items.length > 0
      ? `${label} INVENTORY (use ONLY these for ${label.toLowerCase()}):\n${items.map(fmtItem).join('\n')}`
      : `${label} INVENTORY: (empty — skip this meal)`;

  const foodBankContext = `
${slotList('BREAKFAST', forSlot('B'))}

${slotList('LUNCH', forSlot('L'))}

${slotList('DINNER', forSlot('D'))}

CRITICAL:
1. Meal 1 uses ONLY items from BREAKFAST INVENTORY.
2. Meal 2 uses ONLY items from LUNCH INVENTORY.
3. Meal 3 uses ONLY items from DINNER INVENTORY.
4. Divide nutrients evenly across 3 meals. Hit targets +/- 20 kcal.
5. RETURN ONLY JSON.`;

  const daysLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayPromises = daysLabels.map(dayName => {
    const prompt = `Generate a 1-day meal plan for ${dayName}:
      Target Calories: ${targets.dailyCalories} kcal
      Macros: P ${targets.macros.protein}g, C ${targets.macros.carbs}g, F ${targets.macros.fats}g
      ${foodBankContext}`;
    return generateDay(dayName, prompt, cleanFoodBank, foodBankNames);
  });

  const generatedDays = await Promise.all(dayPromises);
  return {
    days: generatedDays,
    dailyCalories: targets.dailyCalories,
    macros: targets.macros
  };
}

export async function generateAndSaveMealPlan(profile: any, weight: number, bodyFat: number, foodBankItems: any[]) {
  const plan = await generateMealPlan(profile, weight, bodyFat, foodBankItems);
  const today = new Date().toLocaleDateString('en-CA');
  const newPlan = stripUndefined({ ...plan, weekStartDate: today, updatedAt: new Date().toISOString() });
  const q = query(collection(db, 'users', profile.uid, 'mealPlans'), where('weekStartDate', '==', today), limit(1));
  const snap = await getDocs(q);
  let planId = '';
  if (!snap.empty) {
    planId = snap.docs[0].id;
    await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', planId), newPlan);
  } else {
    const docRef = await addDoc(collection(db, 'users', profile.uid, 'mealPlans'), newPlan);
    planId = docRef.id;
  }
  await updateDoc(doc(db, 'users', profile.uid), { activeMealPlanId: planId });
  return planId;
}

export async function regenerateDayPlan(profile: any, weight: number, bodyFat: number, foodBankItems: any[], currentDayMeals: any[]) {
  const cleanName = (n: string) => n?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';
  const dailyTargets = calculateDailyTargets(profile, weight, bodyFat);
  const fixedMeals = currentDayMeals.filter(m => m.status === 'completed');
  const mealsToRebalance = currentDayMeals.filter(m => m.status !== 'completed');
  if (mealsToRebalance.length === 0) return currentDayMeals;

  const totalFixed = fixedMeals.reduce((acc, m) => ({
    calories: acc.calories + (m.calories || 0),
    protein: acc.protein + (m.protein || 0),
    carbs: acc.carbs + (m.carbs || 0),
    fats: acc.fats + (m.fats || 0),
    fiber: acc.fiber + (m.fiber || 0),
  }), { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 });

  let currentRemaining = {
    calories: dailyTargets.dailyCalories - totalFixed.calories,
    protein: dailyTargets.macros.protein - totalFixed.protein,
    carbs: dailyTargets.macros.carbs - totalFixed.carbs,
    fats: dailyTargets.macros.fats - totalFixed.fats,
    fiber: dailyTargets.macros.fiber - totalFixed.fiber,
  };

  const rebalancedMeals = mealsToRebalance.map((meal, index) => {
    const mealsLeft = mealsToRebalance.length - index;
    const mealTarget = { calories: currentRemaining.calories / mealsLeft };
    let originalMealCals = 0;
    const ings = meal.ingredientsWithAmounts || [];
    ings.forEach((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name));
      if (food) {
        const amt = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || food.servingSize;
        originalMealCals += (food.calories || 0) * (amt / food.servingSize);
      }
    });

    const scalingFactor = originalMealCals > 0 ? mealTarget.calories / originalMealCals : 1.0;
    const processedIngredients = ings.map((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name));
      if (!food) return ing;
      const currentAmt = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || food.servingSize;
      let newAmt = currentAmt * scalingFactor;
      if (food.servingUnit === 'unit') newAmt = Math.round(newAmt);
      const unit = food.servingUnit || 'g';
      return { ...ing, amount: `${Math.max(1, Math.round(newAmt))}${unit}` };
    });

    let cal = 0, p = 0, c = 0, f = 0, fib = 0;
    processedIngredients.forEach((ing: any) => {
      const food = foodBankItems.find(fi => cleanName(fi.name) === cleanName(ing.name));
      if (food) {
        const amt = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || 0;
        const r = amt / (food.servingSize || 1);
        cal += (food.calories || 0) * r;
        p += (food.protein || 0) * r;
        c += (food.carbs || 0) * r;
        f += (food.fats || 0) * r;
        fib += (food.fiber || 0) * r;
      }
    });

    currentRemaining.calories -= cal;
    return {
      ...meal,
      ingredientsWithAmounts: processedIngredients,
      ingredients: processedIngredients.map((i: any) => `${i.amount} ${i.name}`),
      calories: Math.round(cal),
      protein: Math.round(p * 10) / 10,
      carbs: Math.round(c * 10) / 10,
      fats: Math.round(f * 10) / 10,
      fiber: Math.round(fib * 10) / 10
    };
  });

  let rebalanceIdx = 0;
  const merged = currentDayMeals.map((original) => {
    if (original?.status === 'completed') {
      return fixedMeals.find(m => m.name === original.name) || original;
    }
    const next = rebalancedMeals[rebalanceIdx++];
    return next || original;
  });

  return merged
    .map((m: any) => sanitizeMeal(m, foodBankItems) ?? m)
    .filter((m: any) => m && typeof m.name === 'string');
}

export async function generateWorkoutPlan(profile: any, weight: number, bodyFat: number, previousPlan?: any) {
  const prompt = `Generate a 7-day PPLR workout schedule for:
    Weight: ${weight} lbs, Body Fat: ${bodyFat}%, Goal: ${profile.goalBodyFat}% BF.
    Return JSON with "days" array.`;

  const text = await callAI(
    "gemini-2.5-pro",
    prompt,
    {
      systemInstruction: "You are a strength coach. Return JSON. Days: Monday-Sunday. Title: Push, Pull, Legs, or Rest.",
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
                day: { type: Type.STRING },
                title: { type: Type.STRING },
                notes: { type: Type.STRING },
                exercises: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["name", "sets", "reps", "notes", "prescribedWeight"],
                    properties: {
                      name: { type: Type.STRING },
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

  return JSON.parse(text);
}
