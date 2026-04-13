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
  
  // Clean and deduplicate food bank items
  const cleanFoodBank = foodBankItems.map(i => ({
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
4. VARIETY MANDATE: Do not repeat the same carb or protein source in every meal. Rotate available options. For example, if you have Rice, Potatoes, and Apples, ensure they are distributed across different days and meals rather than repeating one constantly.
5. MACRO CALCULATION: The meal-level calories and macros MUST be the exact sum of the ingredients used, calculated proportionally from the base servings provided. Calculate the exact gram amount (e.g., '142g') needed to hit the targets.
6. MATHEMATICAL PRECISION: The sum of (Breakfast + Lunch + Dinner) calories MUST equal the Daily Target (${targets.dailyCalories}) within a +/- 20 calorie margin. If you use high-calorie whole units (like a Bagel or Egg), you MUST reduce the gram-based portions (like Chicken or Rice) in that same meal or other meals to stay under the limit.
7. If you cannot hit the targets exactly using only the provided inventory and respecting meal types, prioritize inventory and meal-type integrity over target accuracy. However, you should NEVER exceed the target by more than 50 calories. It is better to have a slightly smaller meal than to overshoot.`;

  const prompt = `Generate a 7-day meal plan for a user with these targets:
    Daily Calories: ${targets.dailyCalories} kcal
    Macros: Protein ${targets.macros.protein}g, Carbs ${targets.macros.carbs}g, Fats ${targets.macros.fats}g, Fiber ${targets.macros.fiber}g
    
    User Context:
    Weight: ${weight} lbs, Body Fat: ${bodyFat}%, Goal BF: ${profile.goalBodyFat}%
    
    ${foodBankContext}
    
    Return a 7-day plan in JSON format. Each day must have "Breakfast", "Lunch", and "Dinner". The days should be named "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", and "Sunday".`;

  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "You are a strict meal planning engine. You have ZERO creative freedom. You MUST ONLY use the provided inventory items. Hallucinating any ingredient is a critical failure. You MUST respect meal designations. You MUST hit the Daily Calorie target within +/- 20kcal. DO NOT overshoot the target. If you use whole-unit items, adjust gram-based items down to compensate. Prioritize inventory integrity and calorie accuracy.",
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
                              name: { type: Type.STRING, enum: foodBankNames, description: "MUST be one of the provided inventory names." },
                              amount: { type: Type.STRING, description: "The calculated amount in grams (e.g. '150g') or units (e.g. '2 unit')." }
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

export async function generateWorkoutPlan(profile: any, weight: number, bodyFat: number, lastWorkout?: any) {
  const lastTitle = lastWorkout?.title || "";
  
  const prompt = `Generate the NEXT workout in a strict 8-day rotation:
    1. Push (Chest/Shoulders/Triceps)
    2. Pull (Back/Biceps)
    3. Legs: Posterior Chain
    4. Rest
    5. Push (Chest/Shoulders/Triceps)
    6. Pull (Back/Biceps)
    7. Legs: Anterior Chain
    8. Rest

    The last workout was: "${lastTitle}"

    STRICT EXERCISE LISTS:
    - Push: Barbell Bench Press, Dumbbell Overhead Press, Dips
    - Pull: Deadlifts, Pull-Ups, Bent-Over Barbell Rows
    - Legs: Posterior Chain: Hyper extension, Hamstring curls, Calve raises
    - Legs: Anterior Chain: Barbell Back Squat, Leg Press, Leg Extensions
    - Rest: No exercises, just coaching tips for recovery.

    User Profile:
    Age: ${profile.age}, Weight: ${weight} lbs, Body Fat: ${bodyFat}%, Goal: ${profile.goalBodyFat}% BF.

    Return the NEXT logical workout in the sequence. If the last was "Legs: Posterior Chain", the next is "Rest". If the last was "Rest" and the one before that was "Legs: Posterior Chain", the next is "Push".
    
    Adjust sets and reps based on the user's goal of reaching ${profile.goalBodyFat}% body fat (usually higher reps/shorter rest for fat loss, or heavy for muscle retention).`;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction: "You are a world-class strength coach. You MUST follow the 8-day PPLR rotation strictly. You MUST ONLY use the exercises provided for each day. For 'Rest' days, return an empty exercises array and recovery-focused notes.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["title", "exercises", "notes"],
        properties: {
          title: { type: Type.STRING, enum: ["Push", "Pull", "Legs: Posterior Chain", "Legs: Anterior Chain", "Rest"] },
          notes: { type: Type.STRING, description: "Coaching tips or recovery advice" },
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["name", "sets", "reps", "notes"],
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

export async function parseNutritionLabel(base64Image: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image
        }
      },
      {
        text: "Extract the nutrition information from this label. Focus on: Product Name, Serving Size, Calories, Protein, Carbs, Fats, and Fiber. If a value is missing, use 0. Return the data in the specified JSON format."
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["name", "servingSize", "servingUnit", "calories", "protein", "carbs", "fats", "fiber"],
        properties: {
          name: { type: Type.STRING, description: "Name of the food product" },
          servingSize: { type: Type.NUMBER, description: "Numeric value of the serving size" },
          servingUnit: { type: Type.STRING, enum: ["g", "oz", "unit", "ml"], description: "Unit of the serving size" },
          calories: { type: Type.NUMBER },
          protein: { type: Type.NUMBER },
          carbs: { type: Type.NUMBER },
          fats: { type: Type.NUMBER },
          fiber: { type: Type.NUMBER }
        }
      }
    }
  });

  return JSON.parse(response.text);
}
