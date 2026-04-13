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

export function calculateDailyTargets(profile: any) {
  if (!profile || !profile.currentWeight || !profile.height || !profile.age) {
    return {
      dailyCalories: 2000,
      macros: { protein: 150, carbs: 200, fats: 65 },
      tdee: 2500,
      dailyDeficit: 500,
      daysLeft: 90,
      targetWeight: profile?.currentWeight || 180
    };
  }

  const weightKg = profile.currentWeight / 2.20462;
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
  const leanBodyMass = profile.currentWeight * (1 - (profile.currentBodyFat / 100));
  // Target Weight = Lean Body Mass / (1 - Target BF%)
  const targetWeight = leanBodyMass / (1 - (profile.goalBodyFat / 100));
  const weightToLose = profile.currentWeight - targetWeight;
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
  const protein = Math.round(profile.currentWeight * 1.0); // 1g per lb
  const fats = Math.round((targetCalories * 0.25) / 9); // 25% of calories
  const carbs = Math.round((targetCalories - (protein * 4) - (fats * 9)) / 4);

  return {
    dailyCalories: targetCalories,
    macros: { protein, carbs, fats },
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

export async function logDailyTarget(uid: string, profile: any, date?: string) {
  const targets = calculateDailyTargets(profile);
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

export async function generateMealPlan(profile: any) {
  const targets = calculateDailyTargets(profile);
  
  const prompt = `Generate a 7-day meal plan for a user with the following targets:
    Daily Calories: ${targets.dailyCalories} kcal
    Macros: Protein ${targets.macros.protein}g, Carbs ${targets.macros.carbs}g, Fats ${targets.macros.fats}g
    
    Context:
    Current Weight: ${profile.currentWeight} lbs
    Current Body Fat: ${profile.currentBodyFat}%
    Goal Body Fat: ${profile.goalBodyFat}%
    Days until target: ${targets.daysLeft}
    
    Provide 3 meals per day that strictly adhere to these daily calorie and macro targets.
    Each day should have a variety of healthy, whole-food recipes.
    Include ingredients list for each meal.`;

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
                    properties: {
                      name: { type: Type.STRING },
                      calories: { type: Type.NUMBER },
                      recipe: { type: Type.STRING },
                      ingredients: { type: Type.ARRAY, items: { type: Type.STRING } }
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
  return {
    ...plan,
    dailyCalories: targets.dailyCalories,
    macros: targets.macros
  };
}

export async function generateWorkoutPlan(profile: any) {
  const prompt = `Generate a customized workout plan for a user with the following profile:
    Age: ${profile.age}
    Current Weight: ${profile.currentWeight} lbs
    Current Body Fat: ${profile.currentBodyFat}%
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
