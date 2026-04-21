import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import type { LiftBankItem, LiftCategory, LiftEquipment } from '../types';

function inferCategoryFromDayTitle(title: string): LiftCategory {
  const lower = (title || '').toLowerCase();
  if (lower.includes('pull')) return 'pull';
  if (lower.includes('leg')) return 'legs';
  if (lower.includes('core') || lower.includes('abs')) return 'core';
  if (lower.includes('cardio')) return 'cardio';
  return 'push';
}

function inferEquipmentFromName(name: string): LiftEquipment {
  const lower = name.toLowerCase();
  if (lower.includes('barbell')) return 'barbell';
  if (lower.includes('dumbbell')) return 'dumbbell';
  if (lower.includes('kettlebell')) return 'kettlebell';
  if (lower.includes('cable')) return 'cable';
  if (lower.includes('pull-up') || lower.includes('pullup') || lower.includes('chin-up') || lower.includes('dip') || lower.includes('push-up') || lower.includes('pushup')) return 'bodyweight';
  if (
    lower.includes('machine') ||
    lower.includes('leg press') ||
    lower.includes('leg extension') ||
    lower.includes('hamstring curl') ||
    lower.includes('hyper extension')
  ) {
    return 'machine';
  }
  return 'other';
}

const canon = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function importLiftsFromWorkouts(
  uid: string,
  existingLifts: LiftBankItem[],
): Promise<number> {
  const workoutSnap = await getDocs(collection(db, 'users', uid, 'workouts'));
  if (workoutSnap.empty) return 0;

  const existingKeys = new Set(existingLifts.map(l => canon(l.name)));
  const seen = new Map<
    string,
    { name: string; category: LiftCategory; equipment: LiftEquipment; defaultSets?: number; defaultReps?: string }
  >();

  workoutSnap.docs.forEach(d => {
    const plan: any = d.data();
    if (!Array.isArray(plan.days)) return;
    plan.days.forEach((day: any) => {
      if (!day || !Array.isArray(day.exercises)) return;
      if ((day.title || '').toLowerCase() === 'rest') return;
      const category = inferCategoryFromDayTitle(day.title || '');
      day.exercises.forEach((ex: any) => {
        const name = String(ex?.name || '').trim();
        if (!name) return;
        const key = canon(name);
        if (existingKeys.has(key) || seen.has(key)) return;
        seen.set(key, {
          name,
          category,
          equipment: inferEquipmentFromName(name),
          defaultSets: typeof ex.sets === 'number' && ex.sets > 0 ? ex.sets : undefined,
          defaultReps: typeof ex.reps === 'string' && ex.reps.trim() ? ex.reps.trim() : undefined,
        });
      });
    });
  });

  if (seen.size === 0) return 0;

  const batch = writeBatch(db);
  const collRef = collection(db, 'users', uid, 'liftBank');
  const now = new Date().toISOString();
  seen.forEach(item => {
    const payload: any = {
      name: item.name,
      category: item.category,
      equipment: item.equipment,
      updatedAt: now,
    };
    if (item.defaultSets) payload.defaultSets = item.defaultSets;
    if (item.defaultReps) payload.defaultReps = item.defaultReps;
    batch.set(doc(collRef), payload);
  });
  await batch.commit();
  return seen.size;
}
