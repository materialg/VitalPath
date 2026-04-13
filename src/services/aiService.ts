import { GoogleGenAI, Type } from "@google/genai";
import { collection, addDoc, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

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
  return target.toISOString().split('T')[0];
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
  if (foodBankItems.length === 0) {
    throw new Error("Your Food Bank is empty. Please add items to your Food Bank before generating a meal plan.");
  }

  const targets = calculateDailyTargets(profile, weight, bodyFat);
  
    const foodBankContext = `\nSTRICT REQUIREMENT: You MUST ONLY use the following items from the user's Food Bank to construct the meals. DO NOT suggest any foods, ingredients, or items not explicitly listed below.
  
  USER'S FOOD BANK ITEMS (Use these and ONLY these):
  ${foodBankItems.map(i => `- ${i.name} (Base Serving: ${i.servingSize}${i.servingUnit}): ${i.calories} cal, ${i.protein}g P, ${i.carbs}g C, ${i.fats}g F, ${i.fiber}g Fiber`).join('\n')}
  
  IMPORTANT: The macros above are for the "Base Serving" listed. You must calculate the specific amount needed for each item to hit the daily targets.`;

  const prompt = `Generate a 7-day meal plan for a user with the following DAILY targets:
    Daily Calories: ${targets.dailyCalories} kcal
    Macros: Protein ${targets.macros.protein}g, Carbs ${targets.macros.carbs}g, Fats ${targets.macros.fats}g, Fiber ${targets.macros.fiber}g
    
    Context:
    Current Weight: ${weight} lbs
    Current Body Fat: ${bodyFat}%
    Goal Body Fat: ${profile.goalBodyFat}%
    Days until target: ${targets.daysLeft}
    ${foodBankContext}
    
    STRICT RULES (FAILURE TO FOLLOW RESULTS IN ERROR):
    1. ONLY use items from the Food Bank list provided above. NO OUTSIDE FOODS.
    2. Meal names MUST be exactly "Breakfast", "Lunch", or "Dinner". NO OTHER NAMES.
    3. Breakfast: MUST use eggs or yogurt from the list if available.
    4. Lunch: MUST use lighter meats (chicken, fish, etc.) from the list if available.
    5. Dinner: MUST use heavier proteins (beef, etc.) from the list if available.
    6. Each meal MUST specify the exact amount. 
       - If the Food Bank item unit is "g", "oz", or "ml", include the unit (e.g., "150g Chicken Breast").
       - If the Food Bank item unit is "unit", just include the number (e.g., "3 Eggs").
    7. The sum of all 3 meals for a day MUST hit the daily calorie and macro targets as closely as possible.
    8. The "recipe" field should be empty as we are only showing ingredients.
    9. The "ingredientsWithAmounts" list MUST contain the name and the specific amount (with unit if applicable) for each item.
    10. ALL macro fields (protein, carbs, fats, fiber) MUST be numbers, not null or undefined. Use 0 if a value is missing.`;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
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
                    required: ["name", "calories", "protein", "carbs", "fats", "fiber", "recipe", "ingredientsWithAmounts"],
                    properties: {
                      name: { type: Type.STRING, enum: ["Breakfast", "Lunch", "Dinner"] },
                      calories: { type: Type.NUMBER },
                      protein: { type: Type.NUMBER },
                      carbs: { type: Type.NUMBER },
                      fats: { type: Type.NUMBER },
                      fiber: { type: Type.NUMBER },
                      recipe: { type: Type.STRING },
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

  const plan = JSON.parse(response.text);
  // Map ingredientsWithAmounts back to ingredients array for compatibility if needed
  plan.days.forEach((day: any) => {
    day.meals.forEach((meal: any) => {
      meal.ingredients = meal.ingredientsWithAmounts.map((i: any) => {
        // If amount already contains the unit (like '150g'), just use it.
        // If it's just a number and the item was a 'unit' type, it should be fine.
        return `${i.amount} ${i.name}`;
      });
    });
  });

  return {
    ...plan,
    dailyCalories: targets.dailyCalories,
    macros: targets.macros
  };
}

export async function generateWorkoutPlan(profile: any, weight: number, bodyFat: number) {
  const prompt = `Generate a customized workout plan for a user with the following profile:
    Age: ${profile.age}
    Current Weight: ${weight} lbs
    Current Body Fat: ${bodyFat}%
    Goal: Reach ${profile.goalBodyFat}% body fat
    Activity Level: ${profile.activityLevel}
    
    Provide a list of exercises with sets, reps, and notes.`;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                sets: { type: Type.NUMBER },
                reps: { type: Type.STRING },
                notes: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text);
}
