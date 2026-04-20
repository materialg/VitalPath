import type { FoodBankItem, Meal, DayPlan } from '../types';

const SLOTS: Array<{ label: string; tag: 'B' | 'L' | 'D' }> = [
  { label: 'Breakfast', tag: 'B' },
  { label: 'Lunch', tag: 'L' },
  { label: 'Dinner', tag: 'D' },
];

export interface DayTargets {
  dailyCalories: number;
  macros: { protein: number; carbs: number; fats: number; fiber: number };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function proteinDensity(f: FoodBankItem): number {
  const cals = f.calories || 1;
  return ((f.protein || 0) * 4) / cals;
}

function carbDensity(f: FoodBankItem): number {
  const cals = f.calories || 1;
  return ((f.carbs || 0) * 4) / cals;
}

function eligibleForSlot(foodBank: FoodBankItem[], tag: 'B' | 'L' | 'D'): FoodBankItem[] {
  return foodBank.filter(f => {
    if (!f.mealTypes || f.mealTypes.length === 0) return true;
    return f.mealTypes.includes(tag);
  });
}

function pickIngredients(eligible: FoodBankItem[], rng: () => number): FoodBankItem[] {
  if (eligible.length === 0) return [];

  const picked: FoodBankItem[] = [];

  const byProtein = [...eligible].sort((a, b) => proteinDensity(b) - proteinDensity(a));
  const topProtein = byProtein.slice(0, Math.min(3, byProtein.length));
  picked.push(shuffled(topProtein, rng)[0]);

  const afterProtein = eligible.filter(f => !picked.includes(f));
  if (afterProtein.length > 0) {
    const byCarb = [...afterProtein].sort((a, b) => carbDensity(b) - carbDensity(a));
    const topCarb = byCarb.slice(0, Math.min(3, byCarb.length));
    picked.push(shuffled(topCarb, rng)[0]);
  }

  const afterCarb = eligible.filter(f => !picked.includes(f));
  if (afterCarb.length > 0 && rng() < 0.6) {
    picked.push(shuffled(afterCarb, rng)[0]);
  }

  return picked;
}

function roundAmount(food: FoodBankItem, amount: number): number {
  const unit = food.servingUnit || 'unit';
  if (unit === 'unit') return Math.max(1, Math.round(amount));
  if (amount < 50) return Math.max(5, Math.round(amount / 5) * 5);
  if (amount < 200) return Math.max(10, Math.round(amount / 10) * 10);
  return Math.max(25, Math.round(amount / 25) * 25);
}

function computeTotals(entries: Array<{ food: FoodBankItem; amount: number }>) {
  let calories = 0, protein = 0, carbs = 0, fats = 0, fiber = 0;
  for (const { food, amount } of entries) {
    const serving = food.servingSize || 1;
    const ratio = serving > 0 ? amount / serving : 0;
    calories += (food.calories || 0) * ratio;
    protein += (food.protein || 0) * ratio;
    carbs += (food.carbs || 0) * ratio;
    fats += (food.fats || 0) * ratio;
    fiber += (food.fiber || 0) * ratio;
  }
  return { calories, protein, carbs, fats, fiber };
}

function formatAmount(food: FoodBankItem, amount: number): string {
  const unit = food.servingUnit || 'unit';
  if (unit === 'unit') return `${amount} ${amount === 1 ? 'unit' : 'units'}`;
  return `${amount} ${unit}`;
}

function buildMeal(label: string, picked: FoodBankItem[], slotCalories: number): Meal | null {
  if (picked.length === 0) return null;

  let entries = picked.map(food => ({ food, amount: food.servingSize || 1 }));

  const initial = computeTotals(entries);
  if (initial.calories > 0 && slotCalories > 0) {
    const scale = Math.max(0.25, Math.min(4, slotCalories / initial.calories));
    entries = entries.map(({ food, amount }) => ({
      food,
      amount: roundAmount(food, amount * scale),
    }));
  }

  const flexibleIdx = entries.findIndex(e => (e.food.servingUnit || 'unit') !== 'unit');
  if (flexibleIdx >= 0) {
    const afterRound = computeTotals(entries);
    const gap = slotCalories - afterRound.calories;
    if (Math.abs(gap) > 20) {
      const flex = entries[flexibleIdx];
      const serving = flex.food.servingSize || 1;
      const calPerUnit = serving > 0 ? (flex.food.calories || 0) / serving : 0;
      if (calPerUnit > 0) {
        const targetAmount = flex.amount + gap / calPerUnit;
        const rounded = roundAmount(flex.food, Math.max(0, targetAmount));
        if (rounded > 0) entries[flexibleIdx] = { food: flex.food, amount: rounded };
      }
    }
  }

  const finalTotals = computeTotals(entries);

  const ingredientsWithAmounts = entries.map(({ food, amount }) => ({
    name: food.name,
    amount: formatAmount(food, amount),
  }));

  return {
    name: label,
    recipe: '',
    ingredients: ingredientsWithAmounts.map(i => `${i.amount} ${i.name}`),
    ingredientsWithAmounts,
    calories: Math.round(finalTotals.calories),
    protein: Math.round(finalTotals.protein * 10) / 10,
    carbs: Math.round(finalTotals.carbs * 10) / 10,
    fats: Math.round(finalTotals.fats * 10) / 10,
    fiber: Math.round(finalTotals.fiber * 10) / 10,
    status: 'pending',
  };
}

export function composeDay(
  dayName: string,
  targets: DayTargets,
  foodBankItems: FoodBankItem[],
  rng: () => number = Math.random,
): DayPlan {
  const available = foodBankItems.filter(f => !f.hidden);
  if (available.length === 0) {
    throw new Error('All your Food Bank items are hidden or the Food Bank is empty.');
  }

  const slotCalories = targets.dailyCalories / SLOTS.length;
  const meals: Meal[] = [];

  for (const slot of SLOTS) {
    const eligible = eligibleForSlot(available, slot.tag);
    if (eligible.length === 0) continue;
    const picked = pickIngredients(eligible, rng);
    const meal = buildMeal(slot.label, picked, slotCalories);
    if (meal) meals.push(meal);
  }

  if (meals.length === 0) {
    throw new Error(`No meals could be composed from your Food Bank for ${dayName}.`);
  }

  return { day: dayName, meals };
}
