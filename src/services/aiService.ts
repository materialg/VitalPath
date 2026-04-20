import { collection, addDoc, query, where, getDocs, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { GoogleGenAI } from "@google/genai";

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
export const checkIsAIConfigured = async (): Promise<boolean> => {
  try {
    const res = await fetch("/api/ai/config");
    const data = await res.json();
    return data.isConfigured;
  } catch (e) {
    // Fallback for dev or other issues
    const apiKey = process.env.GEMINI_API_KEY;
    return !!(apiKey && apiKey !== 'undefined' && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim() !== '');
  }
};

// Internal helper to call Gemini directly (Used on server, but logic moved to aiLogic.ts)
// This is kept here to avoid breaking other potential direct imports if they exist
async function callAI(model: string, contents: any, config: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error("Gemini API key is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const text = contents[0]?.parts?.[0]?.text || "Generate a meal plan";

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text }] }],
    config: {
      systemInstruction: config.systemInstruction,
      responseMimeType: config.responseMimeType,
      responseSchema: config.responseSchema,
    }
  });

  return response.text;
}

export function calculateDailyTargets(profile: any, weight: number, bodyFat: number) {
  if (!profile || !weight || !profile.height || !profile.age) {
    return {
      dailyCalories: 2000,
      macros: { protein: 150, carbs: 200, fats: 65 },
      tdee: 2500,
      dailyDeficit: 500,
      daysLeft: 90,
      targetWeight: weight || 180
    };
  }

  const weightKg = weight / 2.20462;
  const heightCm = profile.height * 2.54;
  const age = profile.age;
  
  // BMR (Mifflin-St Jeor)
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

  // Add steps calories: approx 0.04 per step
  const stepCalories = (profile.dailyStepsGoal || 0) * 0.04;
  tdee += stepCalories;

  // Target Weight Calculation
  // Lean Body Mass = Current Weight * (1 - Current BF%)
  const leanBodyMass = weight * (1 - (bodyFat / 100));
  // Target Weight = Lean Body Mass / (1 - Target BF%)
  const targetWeight = leanBodyMass / (1 - (profile.goalBodyFat / 100));
  const weightToLose = weight - targetWeight;
  const totalDeficitNeeded = weightToLose * 3500;

  const targetDate = new Date(profile.targetDate);
  const today = new Date();
  const daysLeft = Math.max(1, Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  
  const dailyDeficit = totalDeficitNeeded / daysLeft;
  let targetCalories = Math.round(tdee - dailyDeficit);

  // Safety floors
  const minCalories = profile.gender === 'male' ? 1500 : 1200;
  targetCalories = Math.max(minCalories, targetCalories);

  // Macros
  const protein = Math.round(weight * 1.0); // 1g per lb
  const fats = Math.round((targetCalories * 0.25) / 9); // 25% of calories
  const carbs = Math.round((targetCalories - (protein * 4) - (fats * 9)) / 4);
  const fiber = Math.round((targetCalories / 1000) * 14); // 14g per 1000 kcal

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
  
  if (isNaN(weeksNeeded) || !isFinite(weeksNeeded)) return new Date().toISOString().split('T')[0];

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
  
  // Check if target for this date already exists (simplified check by date string)
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

export enum Type {
  OBJECT = "object",
  ARRAY = "array",
  STRING = "string",
  NUMBER = "number",
  INTEGER = "integer",
  BOOLEAN = "boolean"
}

export enum ThinkingLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high"
}

async function generateDay(dayName: string, prompt: string, cleanFoodBank: any[], foodBankNames: string[]) {
  const text = await callAI(
    "gemini-3-flash-preview",
    prompt,
    {
      systemInstruction: "You are a strict meal planning engine. Balance protein and calories evenly across all 3 meals. Max 300g of meat per meal. Hit daily targets +/- 20kcal. No hallucinations. RETURN ONLY JSON. IMPORTANT: Use whole numbers (integers) ONLY for items with unit-based serving sizes.",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
                name: { type: Type.STRING, enum: ["Breakfast", "Lunch", "Dinner"] },
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

  const cleanName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

  const meals = data.meals.map((meal: any) => {
    // Filter ingredients to ensure they exist in the food bank
    meal.ingredientsWithAmounts = (meal.ingredientsWithAmounts || []).filter((i: any) => 
      foodBankNames.some(name => cleanName(name) === cleanName(i.name))
    ).map((i: any) => {
      const food = cleanFoodBank.find(f => cleanName(f.name) === cleanName(i.name));
      if (food) {
        // ALWAYS use the food bank's unit, regardless of what the AI returned
        const fbUnit = food.servingUnit || 'unit';
        let amountNum = parseFloat(i.amount) || 0;
        
        // Final safety check: if unit-based, MUST be whole number
        if (fbUnit === 'unit') {
          amountNum = Math.round(amountNum);
        }

        // Add a space for readability, and handle plurals for unit
        let formattedUnit = fbUnit;
        if (fbUnit === 'unit') {
          formattedUnit = amountNum === 1 ? 'unit' : 'units';
        }
        
        const formattedAmount = `${amountNum} ${formattedUnit}`;
        return { ...i, name: food.name, amount: formattedAmount };
      }
      return i;
    });

    // Map to display string
    meal.ingredients = meal.ingredientsWithAmounts.map((i: any) => {
      return `${i.amount} ${i.name}`;
    });

    // Recalculate meal totals based on filtered ingredients for absolute accuracy
    let totalCal = 0, totalP = 0, totalC = 0, totalF = 0, totalFib = 0;
    
    meal.ingredientsWithAmounts.forEach((ing: any) => {
      const food = cleanFoodBank.find(f => cleanName(f.name) === cleanName(ing.name));
      if (food) {
        const amountNum = parseFloat(ing.amount) || 0;
        const ratio = food.servingSize > 0 ? amountNum / food.servingSize : 0;
        totalCal += (food.calories || 0) * ratio;
        totalP += (food.protein || 0) * ratio;
        totalC += (food.carbs || 0) * ratio;
        totalF += (food.fats || 0) * ratio;
        totalFib += (food.fiber || 0) * ratio;
      }
    });

    meal.calories = Math.round(totalCal);
    meal.protein = Math.round(totalP * 10) / 10;
    meal.carbs = Math.round(totalC * 10) / 10;
    meal.fats = Math.round(totalF * 10) / 10;
    meal.fiber = Math.round(totalFib * 10) / 10;

    return meal;
  });

  return { day: dayName, meals };
}

export async function generateMealPlan(profile: any, weight: number, bodyFat: number, foodBankItems: any[] = []) {
  const availableItems = foodBankItems.filter(i => !i.hidden);
  if (availableItems.length === 0) {
    throw new Error("All your Food Bank items are hidden or the Food Bank is empty. Please unhide or add items before generating a meal plan.");
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

  try {
    const response = await fetch("/api/ai/generate-meal-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets, cleanFoodBank })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || "Failed to generate meal plan on server.");
    }

    return await response.json();
  } catch (error: any) {
    console.error("Meal Plan Generation Error:", error);
    throw new Error(error.message || "Failed to generate meal plan. Please try again.");
  }
}

export async function generateAndSaveMealPlan(profile: any, weight: number, bodyFat: number, foodBankItems: any[]) {
  console.log("Starting generateAndSaveMealPlan...");
  const plan = await generateMealPlan(profile, weight, bodyFat, foodBankItems);
  console.log("Meal plan generated by AI.");
  
  const today = new Date().toLocaleDateString('en-CA');
  const now = new Date().toISOString();
  const newPlan = {
    ...plan,
    weekStartDate: today,
    updatedAt: now,
  };
  
  const mealPlansPath = `users/${profile.uid}/mealPlans`;
  let planId = '';
  
  try {
    // Check for existing plan for today to avoid duplicates
    const q = query(
      collection(db, 'users', profile.uid, 'mealPlans'),
      where('weekStartDate', '==', today),
      limit(1)
    );
    const snap = await getDocs(q);
    
    if (!snap.empty) {
      // Overwrite existing plan
      planId = snap.docs[0].id;
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', planId), newPlan);
    } else {
      // Save new plan
      const docRef = await addDoc(collection(db, 'users', profile.uid, 'mealPlans'), newPlan);
      planId = docRef.id;
    }

    // Persist active plan selection to profile
    await updateDoc(doc(db, 'users', profile.uid), {
      activeMealPlanId: planId
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, mealPlansPath);
  }
  
  console.log("Meal plan saved to Firestore.");

  // Also generate/update grocery list
  const items: any[] = [];
  plan.days.forEach((day: any) => {
    day.meals.forEach((meal: any) => {
      meal.ingredients.forEach((ing: string) => {
        if (!items.find((i: any) => i.name === ing)) {
          items.push({ name: ing, category: 'General', amount: 'As needed', checked: false });
        }
      });
    });
  });

  const groceryListsPath = `users/${profile.uid}/groceryLists`;
  try {
    const gq = query(
      collection(db, 'users', profile.uid, 'groceryLists'),
      where('weekStartDate', '==', today),
      limit(1)
    );
    const gSnap = await getDocs(gq);

    if (!gSnap.empty) {
      await updateDoc(doc(db, 'users', profile.uid, 'groceryLists', gSnap.docs[0].id), { items });
    } else {
      await addDoc(collection(db, 'users', profile.uid, 'groceryLists'), {
        weekStartDate: today,
        items,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, groceryListsPath);
  }

  console.log("Grocery list updated.");
  return planId;
}

export async function regenerateDayPlan(
  profile: any, 
  weight: number, 
  bodyFat: number, 
  foodBankItems: any[], 
  currentDayMeals: any[]
) {
  const cleanName = (n: string) => n?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';
  const dailyTargets = calculateDailyTargets(profile, weight, bodyFat);
  
  // 1. Identify "fixed" vs "flexible" meals
  const fixedMeals = currentDayMeals.filter(m => m.status === 'completed');
  const mealsToRebalance = currentDayMeals.filter(m => m.status !== 'completed');
  
  if (mealsToRebalance.length === 0) return currentDayMeals;

  // 2. Calculate what's already consumed
  const totalFixed = fixedMeals.reduce((acc, m) => ({
    calories: acc.calories + (m.calories || 0),
    protein: acc.protein + (m.protein || 0),
    carbs: acc.carbs + (m.carbs || 0),
    fats: acc.fats + (m.fats || 0),
    fiber: acc.fiber + (m.fiber || 0),
  }), { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 });

  // 3. Targets for the remaining meals
  let currentRemaining = {
    calories: dailyTargets.dailyCalories - totalFixed.calories,
    protein: dailyTargets.macros.protein - totalFixed.protein,
    carbs: dailyTargets.macros.carbs - totalFixed.carbs,
    fats: dailyTargets.macros.fats - totalFixed.fats,
    fiber: dailyTargets.macros.fiber - totalFixed.fiber,
  };

  // 4. Rebalance each internal meal mathematically (Near Instant)
  const rebalancedMeals = mealsToRebalance.map((meal, index) => {
    const mealsLeft = mealsToRebalance.length - index;
    const mealTarget = {
      calories: currentRemaining.calories / mealsLeft,
      protein: currentRemaining.protein / mealsLeft,
      carbs: currentRemaining.carbs / mealsLeft,
      fats: currentRemaining.fats / mealsLeft,
      fiber: currentRemaining.fiber / mealsLeft,
    };

    let originalMealCals = 0;
    const ings = meal.ingredientsWithAmounts || [];
    
    ings.forEach((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name));
      if (food) {
        const amountNum = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || food.servingSize;
        const ratio = food.servingSize > 0 ? amountNum / food.servingSize : 0;
        originalMealCals += (food.calories || 0) * ratio;
      }
    });

    const scalingFactor = originalMealCals > 0 ? mealTarget.calories / originalMealCals : 1.0;

    // Split items into discrete (units) and continuous (g, oz, ml)
    const unitItems = ings.filter((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name));
      return food?.servingUnit === 'unit';
    });
    const contItems = ings.filter((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name));
      return food?.servingUnit !== 'unit';
    });

    // 1. Process Unit Items (Chunky)
    let calFromUnits = 0;
    const processedUnitItems = unitItems.map((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name))!;
      const currentAmount = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || food.servingSize;
      const newAmount = Math.max(1, Math.round(currentAmount * scalingFactor));
      const ratio = food.servingSize > 0 ? newAmount / food.servingSize : 0;
      calFromUnits += (food.calories || 0) * ratio;
      return { ...ing, name: food.name, amount: `${newAmount} ${newAmount === 1 ? 'unit' : 'units'}` };
    });

    // 2. Process Continuous Items (Fine-tuning)
    const remainingMealCal = Math.max(0, mealTarget.calories - calFromUnits);
    let originalContCals = 0;
    contItems.forEach((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name))!;
      const currentAmount = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || food.servingSize;
      const ratio = food.servingSize > 0 ? currentAmount / food.servingSize : 0;
      originalContCals += (food.calories || 0) * ratio;
    });

    // Use a specific scaling factor for continuous items to hit the EXACT remaining calorie target
    const contScalingFactor = originalContCals > 0 ? remainingMealCal / originalContCals : scalingFactor;

    const processedContItems = contItems.map((ing: any) => {
      const food = foodBankItems.find(f => cleanName(f.name) === cleanName(ing.name))!;
      const currentAmount = parseFloat(ing.amount.toString().replace(/[^0-9.]/g, '')) || food.servingSize;
      const newAmount = Math.max(1, Math.round(currentAmount * contScalingFactor));
      const fbUnit = food.servingUnit || 'g';
      return { ...ing, name: food.name, amount: `${newAmount}${fbUnit}` };
    });

    const finalIngredients = [...processedUnitItems, ...processedContItems];
    
    // Sort to maintain original order
    const orderedIngredients = ings.map((orig: any) => 
      finalIngredients.find(updated => cleanName(updated.name) === cleanName(orig.name)) || orig
    );

    // Recalculate accurate totals
    let cal = 0, p = 0, c = 0, f = 0, fib = 0;
    orderedIngredients.forEach((ing: any) => {
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

    // Update error carry-over for next meal
    currentRemaining.calories -= cal;
    currentRemaining.protein -= p;
    currentRemaining.carbs -= c;
    currentRemaining.fats -= f;
    currentRemaining.fiber -= fib;

    return {
      ...meal,
      ingredientsWithAmounts: orderedIngredients,
      ingredients: orderedIngredients.map((i: any) => `${i.amount} ${i.name}`),
      calories: Math.round(cal),
      protein: Math.round(p * 10) / 10,
      carbs: Math.round(c * 10) / 10,
      fats: Math.round(f * 10) / 10,
      fiber: Math.round(fib * 10) / 10
    };
  });

  // 5. Build final day plan
  return ["Breakfast", "Lunch", "Dinner"].map(name => {
    return fixedMeals.find(m => m.name === name) || 
           rebalancedMeals.find(m => m.name === name) || 
           currentDayMeals.find(m => m.name === name);
  });
}

export async function generateWorkoutPlan(profile: any, weight: number, bodyFat: number, previousPlan?: any) {
  try {
    const response = await fetch("/api/ai/generate-workout-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, weight, bodyFat, previousPlan })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || "Failed to generate workout plan on server.");
    }

    return await response.json();
  } catch (error: any) {
    console.error("Workout Plan Generation Error:", error);
    throw new Error(error.message || "Failed to generate workout plan. Please try again.");
  }
}
