import { Type } from '@google/genai';
import type { DayPlan, FoodBankItem, Meal, MealIngredient } from '../types';
import { categorizeFood } from './foodCategory';
import { callAI } from './aiService';

export interface DayTargets {
  dailyCalories: number;
  macros: { protein: number; carbs: number; fats: number; fiber: number };
}

const MEAL_SLOT_LABELS = ['Breakfast', 'Lunch', 'Dinner'] as const;

const SYSTEM_INSTRUCTION = `You are a meal-planning engine. Build meals using ONLY the pantry items provided, referenced by their integer pantryId.

Hard rules (violating any voids the plan):
1. Protein anchor: every meal contains exactly ONE pantry item with category="protein" as the anchor, in realistic portions:
   - servingUnit "g" (meat/fish/tofu): 100-250g total
   - servingUnit "unit" (eggs): 2-4 units total
   - yogurt-like proteins: 150-400g total
2. Carb support: every meal contains at least one pantry item with category="carb" sized to balance calories.
3. No ingredient appears twice in the same meal. Meals have 2-5 ingredients.
4. mealTypes tags are strict. An item tagged only ["B"] may appear only in Breakfast. Only ["L"] only in Lunch. Only ["D"] only in Dinner. Untagged items are allowed in any slot.
5. Portion sanity: no single ingredient exceeds 400g (yogurt may go to 500g). No ingredient below 5g. Condiment-category items stay small (5-40g).
6. Variety across days: no protein anchor appears in more than 5 meals across the 7 days. No two days share the exact same meal composition. Rotate proteins and carbs day to day.
7. Coherence: do not mix multiple category="fat" items in one meal (e.g., butter + cream cheese + olive oil together = no). Use ingredients that belong together: breakfast can pair bagel + cream cheese + eggs; lunch/dinner can pair a protein + carb + vegetable or condiment.
8. Targets per day: calories within ±50 kcal of target, protein within ±15 g of target. Carbs and fats may deviate up to ±25%.

Output: return ONLY JSON matching the schema. Reference items by integer pantryId (the provided index, 0..N-1). amount is numeric in the item's servingUnit (whole integers for "unit" items, decimals allowed otherwise).`;

interface PantryEntry {
  pantryId: number;
  name: string;
  category: string;
  servingSize: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  mealTypes: ('B' | 'L' | 'D')[];
}

function buildPantry(foodBank: FoodBankItem[]): { entries: PantryEntry[]; byId: Map<number, FoodBankItem> } {
  const visible = foodBank.filter(f => !f.hidden);
  const entries: PantryEntry[] = [];
  const byId = new Map<number, FoodBankItem>();
  visible.forEach((food, idx) => {
    byId.set(idx, food);
    entries.push({
      pantryId: idx,
      name: food.name,
      category: categorizeFood(food),
      servingSize: food.servingSize,
      servingUnit: food.servingUnit,
      calories: food.calories || 0,
      protein: food.protein || 0,
      carbs: food.carbs || 0,
      fats: food.fats || 0,
      fiber: food.fiber || 0,
      mealTypes: food.mealTypes ?? [],
    });
  });
  return { entries, byId };
}

function buildUserPrompt(targets: DayTargets, pantry: PantryEntry[], days: string[], retryNote?: string): string {
  return [
    `Daily targets per day:`,
    `  Calories: ${targets.dailyCalories} kcal`,
    `  Protein:  ${targets.macros.protein} g`,
    `  Carbs:    ${targets.macros.carbs} g`,
    `  Fats:     ${targets.macros.fats} g`,
    `  Fiber:    ${targets.macros.fiber} g`,
    ``,
    `Pantry (pantryId -> item). Use these and only these:`,
    JSON.stringify(pantry, null, 2),
    ``,
    `Generate ${days.length} day(s): ${days.join(', ')}. Each day has Breakfast, Lunch, Dinner in that order.`,
    retryNote ? `\nRetry note: ${retryNote}` : '',
  ].join('\n');
}

const responseSchema = {
  type: Type.OBJECT,
  required: ['days'],
  properties: {
    days: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['day', 'meals'],
        properties: {
          day: { type: Type.STRING },
          meals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ['slot', 'ingredients'],
              properties: {
                slot: { type: Type.STRING },
                ingredients: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ['pantryId', 'amount'],
                    properties: {
                      pantryId: { type: Type.NUMBER },
                      amount: { type: Type.NUMBER },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

interface AIDay {
  day: string;
  meals: Array<{ slot: string; ingredients: Array<{ pantryId: number; amount: number }> }>;
}

function formatAmount(food: FoodBankItem, amount: number): string {
  const unit = food.servingUnit || 'unit';
  if (unit === 'unit') {
    const rounded = Math.max(1, Math.round(amount));
    return `${rounded} ${rounded === 1 ? 'unit' : 'units'}`;
  }
  return `${amount} ${unit}`;
}

function buildMealFromAI(
  slotLabel: string,
  rawIngredients: Array<{ pantryId: number; amount: number }>,
  byId: Map<number, FoodBankItem>,
): Meal | null {
  const ingredientsWithAmounts: MealIngredient[] = [];
  const seenIds = new Set<number>();
  let calories = 0, protein = 0, carbs = 0, fats = 0, fiber = 0;

  for (const raw of rawIngredients) {
    if (!raw || typeof raw.pantryId !== 'number' || typeof raw.amount !== 'number') continue;
    if (seenIds.has(raw.pantryId)) continue;
    const food = byId.get(raw.pantryId);
    if (!food) continue;

    let amount = raw.amount;
    if (food.servingUnit === 'unit') amount = Math.max(1, Math.round(amount));
    if (amount <= 0) continue;

    const serving = food.servingSize || 1;
    const ratio = serving > 0 ? amount / serving : 0;
    calories += (food.calories || 0) * ratio;
    protein += (food.protein || 0) * ratio;
    carbs += (food.carbs || 0) * ratio;
    fats += (food.fats || 0) * ratio;
    fiber += (food.fiber || 0) * ratio;

    seenIds.add(raw.pantryId);
    ingredientsWithAmounts.push({
      name: food.name,
      amount: formatAmount(food, amount),
    });
  }

  if (ingredientsWithAmounts.length === 0) return null;

  return {
    name: slotLabel,
    recipe: '',
    ingredients: ingredientsWithAmounts.map(i => `${i.amount} ${i.name}`),
    ingredientsWithAmounts,
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fats: Math.round(fats * 10) / 10,
    fiber: Math.round(fiber * 10) / 10,
    status: 'pending',
  };
}

function parseResponse(
  raw: string,
  days: string[],
  byId: Map<number, FoodBankItem>,
): DayPlan[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const data = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  const aiDays: AIDay[] = Array.isArray(data?.days) ? data.days : [];

  return days.map(dayLabel => {
    const aiDay = aiDays.find(d => (d.day || '').toLowerCase() === dayLabel.toLowerCase());
    const meals: Meal[] = [];
    for (const slotLabel of MEAL_SLOT_LABELS) {
      const aiMeal = aiDay?.meals?.find(m => (m.slot || '').toLowerCase() === slotLabel.toLowerCase());
      if (!aiMeal) continue;
      const meal = buildMealFromAI(slotLabel, aiMeal.ingredients || [], byId);
      if (meal) meals.push(meal);
    }
    return { day: dayLabel, meals };
  });
}

function dayGapIsBad(day: DayPlan, targets: DayTargets): boolean {
  const totals = day.meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein: acc.protein + (m.protein || 0),
    }),
    { calories: 0, protein: 0 },
  );
  const calorieGap = Math.abs(totals.calories - targets.dailyCalories) / Math.max(1, targets.dailyCalories);
  const proteinGap = Math.abs(totals.protein - targets.macros.protein) / Math.max(1, targets.macros.protein);
  return calorieGap > 0.10 || proteinGap > 0.15;
}

function validate(days: DayPlan[], targets: DayTargets): { ok: boolean; note?: string } {
  if (days.length === 0) return { ok: false, note: 'no days returned' };
  const allEmpty = days.every(d => d.meals.length === 0);
  if (allEmpty) return { ok: false, note: 'every day was empty' };

  const badDays = days.filter(d => d.meals.length > 0 && dayGapIsBad(d, targets));
  if (badDays.length >= Math.max(3, Math.ceil(days.length / 2))) {
    const sample = badDays[0];
    const totals = sample.meals.reduce(
      (a, m) => ({
        calories: a.calories + (m.calories || 0),
        protein: a.protein + (m.protein || 0),
      }),
      { calories: 0, protein: 0 },
    );
    return {
      ok: false,
      note: `${sample.day} came in at ${totals.calories} kcal (target ${targets.dailyCalories}) and ${totals.protein}g protein (target ${targets.macros.protein}g); tighten amounts on this day and the other ${badDays.length - 1} off days.`,
    };
  }
  return { ok: true };
}

async function callMealAI(systemInstruction: string, userPrompt: string): Promise<string> {
  return callAI('gemini-2.5-flash', userPrompt, {
    systemInstruction,
    responseMimeType: 'application/json',
    responseSchema,
    thinkingBudget: 512,
  });
}

export async function aiGenerate(
  targets: DayTargets,
  foodBank: FoodBankItem[],
  days: string[],
): Promise<DayPlan[]> {
  const { entries, byId } = buildPantry(foodBank);
  if (entries.length === 0) {
    throw new Error('All your Food Bank items are hidden or the Food Bank is empty.');
  }

  const userPrompt = buildUserPrompt(targets, entries, days);
  const firstRaw = await callMealAI(SYSTEM_INSTRUCTION, userPrompt);
  let parsed = parseResponse(firstRaw, days, byId);
  const firstCheck = validate(parsed, targets);
  if (firstCheck.ok) return parsed;

  console.warn('[aiGenerate] first pass invalid, retrying once:', firstCheck.note);
  const retryPrompt = buildUserPrompt(targets, entries, days, firstCheck.note);
  const retryRaw = await callMealAI(SYSTEM_INSTRUCTION, retryPrompt);
  parsed = parseResponse(retryRaw, days, byId);
  const retryCheck = validate(parsed, targets);
  if (retryCheck.ok) return parsed;

  throw new Error(`AI plan failed validation after retry: ${retryCheck.note}`);
}
