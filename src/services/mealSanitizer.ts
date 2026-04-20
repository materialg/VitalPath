import type { FoodBankItem, Meal, MealIngredient } from '../types';

const cleanName = (n: string) => (n || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

const toNumber = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const formatAmount = (amount: number, unit: string) => {
  if (unit === 'unit') {
    const rounded = Math.max(0, Math.round(amount));
    return `${rounded} ${rounded === 1 ? 'unit' : 'units'}`;
  }
  return `${amount} ${unit}`;
};

export function sanitizeMeal(rawMeal: any, foodBank: FoodBankItem[]): Meal | null {
  if (!rawMeal || typeof rawMeal !== 'object') return null;

  const name = typeof rawMeal.name === 'string' ? rawMeal.name.trim() : '';
  if (!name) return null;

  const rawIngs: any[] = Array.isArray(rawMeal.ingredientsWithAmounts)
    ? rawMeal.ingredientsWithAmounts
    : [];

  const ingredientsWithAmounts: MealIngredient[] = [];
  let calories = 0, protein = 0, carbs = 0, fats = 0, fiber = 0;

  for (const ing of rawIngs) {
    if (!ing || typeof ing !== 'object') continue;
    const ingName = typeof ing.name === 'string' ? ing.name : '';
    if (!ingName) continue;

    const food = foodBank.find(f => cleanName(f.name) === cleanName(ingName));
    if (!food) continue;

    let amountNum = toNumber(ing.amount, 0);
    const unit = food.servingUnit || 'unit';
    if (unit === 'unit') amountNum = Math.round(amountNum);
    if (amountNum <= 0) continue;

    const servingSize = toNumber(food.servingSize, 0);
    const ratio = servingSize > 0 ? amountNum / servingSize : 0;

    calories += toNumber(food.calories) * ratio;
    protein += toNumber(food.protein) * ratio;
    carbs += toNumber(food.carbs) * ratio;
    fats += toNumber(food.fats) * ratio;
    fiber += toNumber(food.fiber) * ratio;

    ingredientsWithAmounts.push({
      name: food.name,
      amount: formatAmount(amountNum, unit),
    });
  }

  if (ingredientsWithAmounts.length === 0) return null;

  const ingredients = ingredientsWithAmounts.map(i => `${i.amount} ${i.name}`);
  const status: Meal['status'] =
    rawMeal.status === 'completed' || rawMeal.status === 'skipped' || rawMeal.status === 'pending'
      ? rawMeal.status
      : 'pending';

  return {
    name,
    recipe: typeof rawMeal.recipe === 'string' ? rawMeal.recipe : '',
    ingredients,
    ingredientsWithAmounts,
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fats: Math.round(fats * 10) / 10,
    fiber: Math.round(fiber * 10) / 10,
    status,
  };
}

const placeholder = (): Meal => ({
  name: 'Unavailable meal',
  recipe: '',
  ingredients: [],
  ingredientsWithAmounts: [],
  calories: 0,
  protein: 0,
  carbs: 0,
  fats: 0,
  fiber: 0,
  status: 'pending',
});

export function safeMeals(meals: any[] | undefined, foodBank: FoodBankItem[]): Meal[] {
  if (!Array.isArray(meals)) return [];
  return meals.map(m => sanitizeMeal(m, foodBank) ?? placeholder());
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter(v => v !== undefined)
      .map(v => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
