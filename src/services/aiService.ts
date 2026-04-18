import { GoogleGenAI, Type } from "@google/genai";
import { collection, addDoc, query, where, getDocs, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';

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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
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
  throw new Error(JSON.stringify(errInfo));
}

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || '';
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
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

  const tdee = bmr * (activityMultipliers[profile.activityLevel as keyof typeof activityMultipliers] || 1.2);

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

export async function generateMealPlan(profile: any, weight: number, bodyFat: number, foodBankItems: any[] = []) {
  // Filter out hidden items
  const availableItems = foodBankItems.filter(i => !i.hidden);

  if (availableItems.length === 0) {
    throw new Error("All your Food Bank items are hidden or the Food Bank is empty. Please unhide or add items before generating a meal plan.");
  }

  const targets = calculateDailyTargets(profile, weight, bodyFat);
  
  // Clean and deduplicate food bank items
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

  const foodBankContext = `
STRICT INVENTORY - YOU MUST ONLY USE THESE ITEMS:
${cleanFoodBank.map(i => {
  const constraint = i.servingUnit === 'unit' ? ' (WHOLE UNITS ONLY - NO FRACTIONS)' : '';
  const tags = i.mealTypes.length > 0 ? ` [STRICTLY FOR: ${i.mealTypes.map(t => t === 'B' ? 'Breakfast' : t === 'L' ? 'Lunch' : 'Dinner').join(', ')}]` : ' [UNIVERSAL - ANY MEAL]';
  return `- ${i.name}: ${i.calories} cal, ${i.protein}g P, ${i.carbs}g C, ${i.fats}g F, ${i.fiber}g Fiber per ${i.servingSize}${i.servingUnit}${constraint}${tags}`;
}).join('\n')}

CRITICAL INSTRUCTIONS:
1. ZERO HALLUCINATION POLICY: You are FORBIDDEN from using any food, condiment, seasoning, or ingredient not in the list above. If it's not in the list, it doesn't exist.
2. MEAL TYPE ENFORCEMENT: 
   - If a food is tagged [STRICTLY FOR: Breakfast], it can ONLY appear in "Breakfast".
   - If a food is tagged [STRICTLY FOR: Lunch], it can ONLY appear in "Lunch".
   - If a food is tagged [STRICTLY FOR: Dinner], it can ONLY appear in "Dinner".
   - If a food is tagged [UNIVERSAL], you can use it in any meal.
   - DO NOT put "Lunch" or "Dinner" tagged items in "Breakfast".
3. WHOLE UNIT RULE: Items with unit "unit" MUST be used in whole number multiples of their base serving. No 0.5 eggs, no 1.2 protein bars.
4. MACRO CALCULATION: The meal-level calories and macros MUST be the exact sum of the ingredients used, calculated proportionally from the base servings provided. Calculate the exact gram amount (e.g., '142g') needed to hit the targets.
5. MATHEMATICAL PRECISION: The sum of (Breakfast + Lunch + Dinner) calories MUST equal the Daily Target (${targets.dailyCalories}) within a +/- 20 calorie margin. If you use high-calorie whole units (like a Bagel or Egg), you MUST reduce the gram-based portions (like Chicken or Rice) in that same meal or other meals to stay under the limit.
6. If you cannot hit the targets exactly using only the provided inventory and respecting meal types, prioritize inventory and meal-type integrity over target accuracy. However, you should NEVER exceed the target by more than 50 calories. It is better to have a slightly smaller meal than to overshoot.
7. MEAL BALANCE AND PROPORTION:
   - CALORIE DISTRIBUTION: Distribute the daily calories (${targets.dailyCalories} kcal) as evenly as possible across Breakfast, Lunch, and Dinner (~33% each). Each meal should ideally be within +/- 15% of the average meal calorie count (Daily Target / 3). Avoid having a small breakfast and massive lunch/dinner unless the inventory strictly forces it.
   - PROTEIN DISTRIBUTION: Distribute the daily protein target (${targets.macros.protein}g) as evenly as possible across all three meals (~33% each). NEVER consolidate more than 50% of the daily protein into a single meal.
   - REASONABLE PORTIONS: Do not prescribe extreme portions of a single item (e.g., avoid >300g of meat in one meal). If more protein is needed, spread the servings across other meals or use multiple protein sources.
   - NUTRITIONAL ARCHITECTURE: Each meal should ideally contain a protein, a carb, and a fat source from the inventory. Avoid "mono-ingredient" meals (e.g., don't have a meal that is just 500g of chicken).`;

  const prompt = `Generate a 7-day meal plan for a user with these targets:
    Daily Calories: ${targets.dailyCalories} kcal
    Macros: Protein ${targets.macros.protein}g, Carbs ${targets.macros.carbs}g, Fats ${targets.macros.fats}g, Fiber ${targets.macros.fiber}g
    
    User Context:
    Weight: ${weight} lbs, Body Fat: ${bodyFat}%, Goal BF: ${profile.goalBodyFat}%
    
    ${foodBankContext}
    
    Return a 7-day plan in JSON format. Each day must have "Breakfast", "Lunch", and "Dinner". Days: "Monday" through "Sunday".`;

  const ai = getAI();
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("AI generation timed out. The calculation is complex—please try one more time.")), 120000)
    );

    const responsePromise = ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "You are a strict meal planning engine. ONLY use provided inventory. Hit calorie target +/- 20kcal. No hallucinations. Respect meal tags. Distribute calories as evenly as possible across Breakfast, Lunch, and Dinner.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            days: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
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
          }
        }
      }
    });

    const response = await Promise.race([responsePromise, timeoutPromise]) as any;

    if (!response.text) {
      throw new Error("AI returned an empty response. Please try again.");
    }

    // Extract JSON from response text (handles potential markdown wrapping)
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : response.text;
    const plan = JSON.parse(jsonStr);
    
    if (!plan.days || !Array.isArray(plan.days)) {
      throw new Error("Invalid meal plan format received from AI.");
    }

    // POST-GENERATION FAIL-SAFE: Strictly filter out any hallucinated ingredients
    plan.days.forEach((day: any) => {
      day.meals.forEach((meal: any) => {
        // Filter ingredients to ensure they exist in the food bank
        meal.ingredientsWithAmounts = (meal.ingredientsWithAmounts || []).filter((i: any) => 
          foodBankNames.includes(i.name)
        );

        // Map to display string
        meal.ingredients = meal.ingredientsWithAmounts.map((i: any) => {
          return `${i.amount} ${i.name}`;
        });

        // Recalculate meal totals based on filtered ingredients for absolute accuracy
        let totalCal = 0, totalP = 0, totalC = 0, totalF = 0, totalFib = 0;
        
        meal.ingredientsWithAmounts.forEach((ing: any) => {
          const food = cleanFoodBank.find(f => f.name === ing.name);
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
        meal.protein = Math.round(totalP);
        meal.carbs = Math.round(totalC);
        meal.fats = Math.round(totalF);
        meal.fiber = Math.round(totalFib);
      });
    });

    return {
      ...plan,
      dailyCalories: targets.dailyCalories,
      macros: targets.macros
    };
  } catch (error: any) {
    console.error("Meal Plan Generation Error:", error);
    if (error instanceof SyntaxError) {
      throw new Error("Failed to parse AI response. The AI might have returned an invalid format. Please try again.");
    }
    throw error;
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
  fixedMeal: any
) {
  const availableItems = foodBankItems.filter(i => !i.hidden);
  if (availableItems.length === 0) throw new Error("Food Bank is empty.");

  const dailyTargets = calculateDailyTargets(profile, weight, bodyFat);
  
  const remainingTargets = {
    calories: dailyTargets.dailyCalories - (fixedMeal.calories || 0),
    protein: dailyTargets.macros.protein - (fixedMeal.protein || 0),
    carbs: dailyTargets.macros.carbs - (fixedMeal.carbs || 0),
    fats: dailyTargets.macros.fats - (fixedMeal.fats || 0),
    fiber: dailyTargets.macros.fiber - (fixedMeal.fiber || 0),
  };

  const mealsToGenerate = ["Breakfast", "Lunch", "Dinner"].filter(m => m !== fixedMeal.name);

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

  const foodBankContext = `
STRICT INVENTORY - YOU MUST ONLY USE THESE ITEMS:
${cleanFoodBank.map(i => {
  const constraint = i.servingUnit === 'unit' ? ' (WHOLE UNITS ONLY - NO FRACTIONS)' : '';
  const tags = i.mealTypes.length > 0 ? ` [STRICTLY FOR: ${i.mealTypes.map(t => t === 'B' ? 'Breakfast' : t === 'L' ? 'Lunch' : 'Dinner').join(', ')}]` : ' [UNIVERSAL - ANY MEAL]';
  return `- ${i.name}: ${i.calories} cal, ${i.protein}g P, ${i.carbs}g C, ${i.fats}g F, ${i.fiber}g Fiber per ${i.servingSize}${i.servingUnit}${constraint}${tags}`;
}).join('\n')}`;

  const prompt = `
    The user has FIXED their ${fixedMeal.name} to the following:
    ${fixedMeal.ingredients.join(', ')}
    Fixed Meal Macros: ${fixedMeal.calories} cal, ${fixedMeal.protein}g P, ${fixedMeal.carbs}g C, ${fixedMeal.fats}g F.

    Remaining Daily Targets to hit with the OTHER meals:
    Calories: ${remainingTargets.calories} kcal
    Protein: ${remainingTargets.protein}g
    Carbs: ${remainingTargets.carbs}g
    Fats: ${remainingTargets.fats}g
    
    ${foodBankContext}

    Generate the following meals for this day: ${mealsToGenerate.join(', ')}.
    The combined totals of the FIXED meal and these NEW meals MUST equal the Daily Target (${dailyTargets.dailyCalories} kcal) within +/- 20kcal.
    
    Return a JSON object with a "meals" array containing the ${mealsToGenerate.length} regenerated meals.`;

  const ai = getAI();
  const responsePromise = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are a meal planning engine. Regenerate the requested meals to hit the remaining macro targets. ONLY use provided inventory.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          meals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["name", "calories", "protein", "carbs", "fats", "fiber", "ingredientsWithAmounts"],
              properties: {
                name: { type: Type.STRING, enum: mealsToGenerate },
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
  });

  const response = await responsePromise as any;
  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : response.text;
  const result = JSON.parse(jsonStr);

  // Apply same filtering and recalculation logic as global generation
  result.meals.forEach((meal: any) => {
    meal.ingredientsWithAmounts = (meal.ingredientsWithAmounts || []).filter((i: any) => 
      foodBankNames.includes(i.name)
    );
    meal.ingredients = meal.ingredientsWithAmounts.map((i: any) => `${i.amount} ${i.name}`);
    let totalCal = 0, totalP = 0, totalC = 0, totalF = 0, totalFib = 0;
    meal.ingredientsWithAmounts.forEach((ing: any) => {
      const food = cleanFoodBank.find(f => f.name === ing.name);
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
    meal.protein = Math.round(totalP);
    meal.carbs = Math.round(totalC);
    meal.fats = Math.round(totalF);
    meal.fiber = Math.round(totalFib);
  });

  // Re-combine into a full day (ensuring original order: Breakfast, Lunch, Dinner)
  const fullDay = ["Breakfast", "Lunch", "Dinner"].map(name => {
    if (name === fixedMeal.name) return fixedMeal;
    return result.meals.find((m: any) => m.name === name);
  });

  return fullDay;
}

export async function generateWorkoutPlan(profile: any, weight: number, bodyFat: number, previousPlan?: any) {
  const previousPerformanceContext = previousPlan ? `
    PREVIOUS PERFORMANCE DATA:
    ${previousPlan.days.map((d: any) => `
      Day: ${d.day} (${d.title})
      Exercises:
      ${d.exercises.map((e: any) => `- ${e.name}: Prescribed Weight: ${e.prescribedWeight || 'N/A'}, Actual Weights: ${e.setWeights?.join(', ') || 'N/A'}, Actual Reps: ${e.setReps?.join(', ') || 'N/A'}, Target Reps: ${e.reps}`).join('\n')}
    `).join('\n')}
  ` : '';

  const prompt = `Generate a 7-day weekly workout schedule (Monday to Sunday) following a strict PPLR rotation:
    Rotation Order:
    1. Push (Chest/Shoulders/Triceps)
    2. Pull (Back/Biceps)
    3. Legs: Posterior Chain
    4. Rest
    5. Push (Chest/Shoulders/Triceps)
    6. Pull (Back/Biceps)
    7. Legs: Anterior Chain
    8. Rest

    STRICT EXERCISE LISTS:
    - Push: Barbell Bench Press, Dumbbell Overhead Press, Dips
    - Pull: Deadlifts, Pull-Ups, Bent-Over Barbell Rows
    - Legs: Posterior Chain: Hyper extension, Hamstring curls, Calve raises
    - Legs: Anterior Chain: Barbell Back Squat, Leg Press, Leg Extensions
    - Rest: No exercises, just coaching tips for recovery.

    User Profile:
    Age: ${profile.age}, Weight: ${weight} lbs, Body Fat: ${bodyFat}%, Goal: ${profile.goalBodyFat}% BF.

    ${previousPerformanceContext}

    PROGRESSIVE OVERLOAD LOGIC:
    1. If the user hit 2+ reps OVER their target for 2 consecutive workouts, INCREASE the prescribed weight by 5-10 lbs.
    2. If performance dropped significantly (2+ reps BELOW the lower bound of the range) twice consecutively, REDUCE the weight by 10%.
    3. Otherwise, maintain the weight.
    4. If no previous data exists, provide appropriate starting weights based on the user's profile.

    Return a 7-day plan in JSON format. The days MUST be named "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", and "Sunday".
    
    Since this is a 7-day plan and the rotation is 8 days, start Monday with "Push" and follow the sequence.
    
    Adjust sets and reps based on the user's goal of reaching ${profile.goalBodyFat}% body fat.`;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are a world-class strength coach. You MUST follow the PPLR rotation strictly across the 7 days. You MUST ONLY use the exercises provided for each day. You MUST apply the progressive overload logic based on the provided previous performance data. For 'Rest' days, return an empty exercises array and recovery-focused notes.",
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
                title: { type: Type.STRING, enum: ["Push", "Pull", "Legs: Posterior Chain", "Legs: Anterior Chain", "Rest"] },
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
                      consecutiveHits: { type: Type.NUMBER },
                      consecutiveDrops: { type: Type.NUMBER },
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
  });

  return JSON.parse(response.text);
}
