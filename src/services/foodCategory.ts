import { collection, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import type { FoodBankItem } from '../types';

export type FoodCategory = 'protein' | 'carb' | 'veg' | 'fat' | 'condiment';

export function inferCategory(food: Pick<FoodBankItem, 'calories' | 'protein' | 'carbs' | 'fats' | 'servingSize' | 'servingUnit'>): FoodCategory {
  const cal = food.calories || 1;
  const proteinShare = ((food.protein || 0) * 4) / cal;
  const carbShare = ((food.carbs || 0) * 4) / cal;
  const fatShare = ((food.fats || 0) * 9) / cal;

  if (proteinShare >= 0.30) return 'protein';
  if (fatShare >= 0.65) return 'fat';

  const isSmallWeightServing =
    (food.servingUnit === 'g' || food.servingUnit === 'ml') &&
    food.servingSize > 0 &&
    food.servingSize <= 30;
  if (carbShare >= 0.55 && isSmallWeightServing) return 'condiment';

  if (carbShare >= 0.55) return 'carb';

  const calPerGram =
    food.servingUnit === 'g' && food.servingSize > 0
      ? (food.calories || 0) / food.servingSize
      : Infinity;
  if (calPerGram < 0.6 && food.servingSize >= 50) return 'veg';

  return 'carb';
}

export function categorizeFood(food: FoodBankItem): FoodCategory {
  return food.category ?? inferCategory(food);
}

export async function backfillFoodCategories(uid: string): Promise<{ updated: number; skipped: number }> {
  const snap = await getDocs(collection(db, 'users', uid, 'foodBank'));
  let updated = 0;
  let skipped = 0;
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as FoodBankItem;
    if (data.category) {
      skipped++;
      continue;
    }
    const category = inferCategory(data);
    await updateDoc(doc(db, 'users', uid, 'foodBank', docSnap.id), { category });
    updated++;
  }
  return { updated, skipped };
}
