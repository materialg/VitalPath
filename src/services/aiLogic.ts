import { GoogleGenAI } from "@google/genai";

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

async function callAI(model: string, contents: any, config: any) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'undefined' || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error("Gemini API key is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const text = typeof contents === 'string' ? contents : contents[0]?.parts?.[0]?.text || "Generate a meal plan";
  
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

async function generateDay(dayName: string, prompt: string, cleanFoodBank: any[], foodBankNames: string[]) {
  const text = await callAI(
    "gemini-3-flash-preview",
    prompt,
    {
      systemInstruction: "You are a strict meal planning engine. Balance protein and calories evenly across all 3 meals. Max 300g of meat per meal. Hit daily targets +/- 20kcal. No hallucinations. RETURN ONLY JSON. IMPORTANT: Use whole numbers (integers) ONLY for items with unit-based serving sizes.",
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
    meal.ingredientsWithAmounts = (meal.ingredientsWithAmounts || []).filter((i: any) => 
      foodBankNames.some(name => cleanName(name) === cleanName(i.name))
    ).map((i: any) => {
      const food = cleanFoodBank.find(f => cleanName(f.name) === cleanName(i.name));
      if (food) {
        const fbUnit = food.servingUnit || 'unit';
        let amountNum = parseFloat(i.amount) || 0;
        
        if (fbUnit === 'unit') {
          amountNum = Math.round(amountNum);
        }

        let formattedUnit = fbUnit;
        if (fbUnit === 'unit') {
          formattedUnit = amountNum === 1 ? 'unit' : 'units';
        }
        
        const formattedAmount = `${amountNum} ${formattedUnit}`;
        return { ...i, name: food.name, amount: formattedAmount };
      }
      return i;
    });

    meal.ingredients = meal.ingredientsWithAmounts.map((i: any) => `${i.amount} ${i.name}`);

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

export async function generateMealPlanLogic(targets: any, cleanFoodBank: any[]) {
  const foodBankNames = Array.from(new Set(cleanFoodBank.map(i => i.name)));

  const foodBankContext = `
STRICT INVENTORY - YOU MUST ONLY USE THESE ITEMS:
${cleanFoodBank.map(i => {
  const constraint = i.servingUnit === 'unit' ? ' (WHOLE UNIT ONLY - NO FRACTIONS)' : '';
  const tags = i.mealTypes.length > 0 ? ` [STRICTLY FOR: ${i.mealTypes.map((t: string) => t === 'B' ? 'Breakfast' : t === 'L' ? 'Lunch' : 'Dinner').join(', ')}]` : ' [UNIVERSAL - ANY MEAL]';
  return `- ${i.name}: ${i.calories} cal, ${i.protein}g P, ${i.carbs}g C, ${i.fats}g F, ${i.fiber}g Fiber per ${i.servingSize}${i.servingUnit}${constraint}${tags}`;
}).join('\n')}

CRITICAL INSTRUCTIONS:
1. PROTEIN DISTRIBUTION: Each meal MUST have roughly 1/3 of daily protein (${targets.macros.protein}g). Max 300g meat per meal.
2. CALORIE DISTRIBUTION: Breakfast, Lunch, and Dinner should each be roughly 33% of daily calories (${targets.dailyCalories} kcal).
3. ZERO HALLUCINATION: Only use listed items.
4. WHOLE UNIT: unit-based items must be integers.
5. SUM: Meals MUST hit Daily Target +/- 20kcal.`;

  const daysLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  
  const dayPromises = daysLabels.map(dayName => {
    const prompt = `Generate a 1-day meal plan for ${dayName} with these targets:
      Daily Calories: ${targets.dailyCalories} kcal
      Protein: ${targets.macros.protein}g, Carbs: ${targets.macros.carbs}g, Fats: ${targets.macros.fats}g
      
      ${foodBankContext}
      
      Return JSON with a "meals" array containing Breakfast, Lunch, and Dinner.`;
      
    return generateDay(dayName, prompt, cleanFoodBank, foodBankNames);
  });

  const generatedDays = await Promise.all(dayPromises);

  return {
    days: generatedDays,
    dailyCalories: targets.dailyCalories,
    macros: targets.macros
  };
}

export async function generateWorkoutPlanLogic(profile: any, weight: number, bodyFat: number, previousPlan?: any) {
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

  const text = await callAI(
    "gemini-3-pro-preview",
    prompt,
    {
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
  );

  return JSON.parse(text);
}
