import React, { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, addDoc, where, getDocs, deleteDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, VitalLog, MealPlan, WorkoutPlan, Meal, FoodBankItem, LiftBankItem, Exercise } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingDown, Target, Calendar, Check, X, Pencil, ListTodo, Scale, Plus, Activity, ChefHat, Timer, Zap, CheckCircle2, History, RotateCcw, PlusCircle, Trash2, Search } from 'lucide-react';
import { logDailyTarget, calculateDailyTargets } from '../services/aiService';
import { safeMeals, stripUndefined } from '../services/mealSanitizer';

interface Props {
  profile: UserProfile;
  onNavigate: (tab: string) => void;
}

function normalizeLiftTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(t => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

function resolveLiftName(name: string, bank: LiftBankItem[]): string {
  if (!bank.length) return name;
  const exTokens = new Set(normalizeLiftTokens(name));
  let best: { name: string; score: number } | null = null;
  for (const lift of bank) {
    if (lift.hidden) continue;
    const bTokens = normalizeLiftTokens(lift.name);
    if (!bTokens.length) continue;
    const allMatch = bTokens.every(t => exTokens.has(t));
    if (allMatch && (!best || bTokens.length > best.score)) {
      best = { name: lift.name, score: bTokens.length };
    }
  }
  return best?.name || name;
}

export function Dashboard({ profile, onNavigate }: Props) {
  const [vitals, setVitals] = useState<VitalLog[]>([]);
  const [latestMealPlan, setLatestMealPlan] = useState<MealPlan | null>(null);
  const [latestWorkout, setLatestWorkout] = useState<WorkoutPlan | null>(null);
  const [showVitalsModal, setShowVitalsModal] = useState(false);
  const [showMealModal, setShowMealModal] = useState(false);
  const [showWorkoutModal, setShowWorkoutModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<{ mIdx: number; meal: Meal } | null>(null);
  const [editingExercise, setEditingExercise] = useState<{ eIdx: number; exercise: Exercise } | null>(null);
  const [foodBankItems, setFoodBankItems] = useState<FoodBankItem[]>([]);
  const [liftBankItems, setLiftBankItems] = useState<LiftBankItem[]>([]);

  useEffect(() => {
    const vitalsQuery = query(
      collection(db, 'users', profile.uid, 'vitals'),
      orderBy('date', 'desc'),
      limit(7)
    );
    const unsubscribeVitals = onSnapshot(vitalsQuery, (snap) => {
      setVitals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as VitalLog)).reverse());
    });

    const mealQuery = profile.activeMealPlanId 
      ? query(collection(db, 'users', profile.uid, 'mealPlans'), where('__name__', '==', profile.activeMealPlanId))
      : query(collection(db, 'users', profile.uid, 'mealPlans'), orderBy('updatedAt', 'desc'), limit(1));

    const unsubscribeMeals = onSnapshot(mealQuery, (snap) => {
      if (!snap.empty) {
        setLatestMealPlan({ id: snap.docs[0].id, ...snap.docs[0].data() } as MealPlan);
      } else if (profile.activeMealPlanId) {
        // Fallback if active plan not found
        const fallbackQuery = query(collection(db, 'users', profile.uid, 'mealPlans'), orderBy('updatedAt', 'desc'), limit(1));
        getDocs(fallbackQuery).then(s => {
          if (!s.empty) setLatestMealPlan({ id: s.docs[0].id, ...s.docs[0].data() } as MealPlan);
        });
      }
    });

    const workoutQuery = query(
      collection(db, 'users', profile.uid, 'workouts'),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );

    const unsubscribeWorkouts = onSnapshot(workoutQuery, (snap) => {
      if (snap.empty) return;
      const plans = snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutPlan));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const planCoversToday = (p: WorkoutPlan) => {
        if (!p.weekStartDate) return false;
        const ws = new Date(p.weekStartDate + 'T00:00:00');
        ws.setHours(0, 0, 0, 0);
        const we = new Date(ws);
        we.setDate(ws.getDate() + 7);
        return today >= ws && today < we;
      };
      const isPlanStub = (p: WorkoutPlan) =>
        !Array.isArray(p.days) || !p.days.some(d => Array.isArray(d.exercises) && d.exercises.length > 0);
      const planForToday = plans.find(p => planCoversToday(p) && !isPlanStub(p))
        || plans.find(planCoversToday)
        || plans.find(p => p.id === profile.activeWorkoutId)
        || plans[0];
      if (planForToday) setLatestWorkout(planForToday);
    });

    const foodBankQuery = query(collection(db, 'users', profile.uid, 'foodBank'));
    const unsubscribeFoodBank = onSnapshot(foodBankQuery, (snap) => {
      setFoodBankItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FoodBankItem)));
    });

    const liftBankQuery = query(collection(db, 'users', profile.uid, 'liftBank'));
    const unsubscribeLiftBank = onSnapshot(liftBankQuery, (snap) => {
      setLiftBankItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LiftBankItem)));
    });

    return () => {
      unsubscribeVitals();
      unsubscribeMeals();
      unsubscribeWorkouts();
      unsubscribeFoodBank();
      unsubscribeLiftBank();
    };
  }, [profile.uid]);

  const reconcileInFlight = useRef(false);
  useEffect(() => {
    if (!latestWorkout || liftBankItems.length === 0) return;
    if (reconcileInFlight.current) return;

    let changed = false;
    const newDays = latestWorkout.days.map(day => {
      if (!Array.isArray(day.exercises)) return day;
      const newExercises = day.exercises.map(ex => {
        const resolved = resolveLiftName(ex.name, liftBankItems);
        if (resolved !== ex.name) {
          changed = true;
          return { ...ex, name: resolved };
        }
        return ex;
      });
      return { ...day, exercises: newExercises };
    });

    if (!changed) return;
    reconcileInFlight.current = true;
    updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), {
      days: newDays,
      updatedAt: new Date().toISOString(),
    })
      .catch(err => console.error('Failed to reconcile workout names:', err))
      .finally(() => {
        reconcileInFlight.current = false;
      });
  }, [latestWorkout, liftBankItems, profile.uid]);

  const currentWeight = vitals.length > 0 ? vitals[vitals.length - 1].weight : 180;
  const startWeight = vitals.length > 0 ? vitals[0].weight : 180;
  const weightDiff = currentWeight - startWeight;
  
  const daysLeft = profile.targetDate 
    ? Math.max(0, Math.ceil((new Date(profile.targetDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  
  const totalDays = profile.targetDate && profile.createdAt
    ? Math.ceil((new Date(profile.targetDate).getTime() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    : 90;
  
  const timelineProgress = totalDays > 0 ? Math.round(Math.min(100, Math.max(0, ((totalDays - daysLeft) / totalDays) * 100))) : 0;

  const currentBF = vitals.length > 0 ? (vitals[vitals.length - 1].bodyFat || 20) : 20;
  
  const currentTargets = calculateDailyTargets(profile, currentWeight, currentBF);

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayName = dayNames[new Date().getDay()];
  
  const todayMealPlan = latestMealPlan?.days.find(d => d.day === todayName) || latestMealPlan?.days[0];
  const todayWorkout = latestWorkout?.days.find(d => d.day === todayName) || latestWorkout?.days[0];

  const isToday = (dateString: string) => {
    try {
      const d = new Date(dateString);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() &&
             d.getMonth() === now.getMonth() &&
             d.getDate() === now.getDate();
    } catch (e) {
      return false;
    }
  };

  const todayEntry = vitals.find(v => isToday(v.date));
  const vitalsLoggedToday = !!todayEntry;
  const bfProgress = profile.goalBodyFat && currentBF ? Math.min(100, Math.round((profile.goalBodyFat / currentBF) * 100)) : 0;
  const weightProgress = currentTargets.targetWeight && currentWeight
    ? Math.min(100, Math.round((currentTargets.targetWeight / currentWeight) * 100))
    : 0;

  const handleMealStatusToggle = async (mIdx: number) => {
    if (!latestMealPlan || !todayMealPlan) return;
    const updatedDays = [...latestMealPlan.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayMealPlan.day);
    if (dayIndex !== -1) {
      const meals = [...updatedDays[dayIndex].meals];
      const currentStatus = meals[mIdx].status;
      meals[mIdx] = { 
        ...meals[mIdx], 
        status: currentStatus === 'completed' ? 'none' : 'completed' 
      };
      updatedDays[dayIndex].meals = meals;
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', latestMealPlan.id), stripUndefined({
        days: updatedDays,
        updatedAt: new Date().toISOString()
      }));
    }
  };

  const handleUpdateMeal = async (mIdx: number, updatedMeal: any) => {
    if (!latestMealPlan || !todayMealPlan) return;
    setEditingMeal(null);
    const updatedDays = [...latestMealPlan.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayMealPlan.day);
    if (dayIndex !== -1) {
      const slotNames = ["Breakfast", "Lunch", "Dinner", "Snack"];
      const meals = [...(updatedDays[dayIndex].meals || [])];
      while (meals.length <= mIdx) {
        meals.push({
          name: slotNames[meals.length] || `Meal ${meals.length + 1}`,
          calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0,
          ingredients: [], ingredientsWithAmounts: [], status: 'none',
        } as any);
      }
      meals[mIdx] = updatedMeal;
      updatedDays[dayIndex] = { ...updatedDays[dayIndex], meals };
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', latestMealPlan.id), stripUndefined({
        days: updatedDays,
        updatedAt: new Date().toISOString()
      }));
    }
  };

  const handleAllMealsToggle = async () => {
    if (!latestMealPlan || !todayMealPlan) return;
    const updatedDays = [...latestMealPlan.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayMealPlan.day);
    if (dayIndex !== -1) {
      const isCompleted = updatedDays[dayIndex].status === 'completed';
      updatedDays[dayIndex] = {
        ...updatedDays[dayIndex],
        status: isCompleted ? 'pending' : 'completed',
      };

      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', latestMealPlan.id), stripUndefined({
        days: updatedDays,
        updatedAt: new Date().toISOString()
      }));
    }
  };

  const handleWorkoutToggle = async () => {
    if (!latestWorkout || !todayWorkout) return;
    const updatedDays = [...latestWorkout.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayWorkout.day);
    if (dayIndex !== -1) {
      const currentStatus = updatedDays[dayIndex].status;
      updatedDays[dayIndex].status = currentStatus === 'completed' ? 'none' : 'completed';
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), {
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    }
  };

  const handleUpdateExercise = async (eIdx: number, updatedExercise: Exercise) => {
    if (!latestWorkout || !todayWorkout) return;
    const updatedDays = [...latestWorkout.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayWorkout.day);
    if (dayIndex !== -1) {
      const exercises = [...(updatedDays[dayIndex].exercises || [])];
      exercises[eIdx] = updatedExercise;
      updatedDays[dayIndex] = { ...updatedDays[dayIndex], exercises };
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), stripUndefined({
        days: updatedDays,
        updatedAt: new Date().toISOString()
      }));
    }
  };

  const handleRemoveExercise = async (eIdx: number) => {
    if (!latestWorkout || !todayWorkout) return;
    setEditingExercise(null);
    const updatedDays = [...latestWorkout.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayWorkout.day);
    if (dayIndex !== -1) {
      const exercises = (updatedDays[dayIndex].exercises || []).filter((_, i) => i !== eIdx);
      updatedDays[dayIndex] = { ...updatedDays[dayIndex], exercises };
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), stripUndefined({
        days: updatedDays,
        updatedAt: new Date().toISOString()
      }));
    }
  };

  const handleRestToday = async () => {
    if (!latestWorkout || !todayWorkout) return;
    const calendarOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const todayCal = calendarOrder.indexOf(todayWorkout.day);
    if (todayCal === -1) return;

    const newDays = latestWorkout.days.map(d => {
      const dCal = calendarOrder.indexOf(d.day);
      if (dCal < todayCal) return d;
      if (dCal === todayCal) {
        return { day: d.day, title: 'Rest', exercises: [], status: 'completed' as const };
      }
      const sourceName = calendarOrder[dCal - 1];
      const source = latestWorkout.days.find(x => x.day === sourceName);
      if (!source) return d;
      const next: any = {
        day: d.day,
        title: source.title,
        exercises: source.exercises ?? [],
      };
      if (source.notes !== undefined) next.notes = source.notes;
      if (source.status !== undefined) next.status = source.status;
      return next;
    });

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), stripUndefined({
        days: newDays,
        restBackup: { day: todayWorkout.day, days: latestWorkout.days },
        updatedAt: new Date().toISOString(),
      }));
    } catch (err) {
      console.error('Failed to rest today:', err);
    }
  };

  const handleUndoRest = async () => {
    if (!latestWorkout || !latestWorkout.restBackup?.days?.length) return;
    const restoredDays = latestWorkout.restBackup.days;
    try {
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), stripUndefined({
        days: restoredDays,
        restBackup: deleteField(),
        updatedAt: new Date().toISOString(),
      } as any));
    } catch (err) {
      console.error('Failed to undo rest:', err);
    }
  };

  const handleVitalsToggle = async () => {
    if (vitalsLoggedToday) {
      if (todayEntry) {
        await deleteDoc(doc(db, 'users', profile.uid, 'vitals', todayEntry.id));
      }
      return;
    }
    if (vitals.length === 0) {
      setShowVitalsModal(true);
      return;
    }
    const isoDate = new Date().toISOString();
    await addDoc(collection(db, 'users', profile.uid, 'vitals'), {
      date: isoDate,
      weight: currentWeight,
      bodyFat: currentBF,
      createdAt: isoDate,
      updatedAt: isoDate
    });
    await logDailyTarget(profile.uid, profile, currentWeight, currentBF, isoDate);
  };

  return (
    <div className="space-y-8">
      <header className="text-center lg:text-left">
        <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight">👋 Welcome back!</h1>
      </header>

      <div className="space-y-4">

      <div className="flex items-center justify-center lg:justify-start gap-3 bg-white p-2 rounded-2xl border border-[#141414]/5 shadow-sm">
        <div className="w-10 h-10 bg-[#141414]/5 rounded-xl flex items-center justify-center">
          <Calendar className="text-[#141414]/40" size={20} />
        </div>
        <div className="pr-4">
          <p className="text-xs font-medium text-[#141414]/40 uppercase tracking-wider">Today</p>
          <p className="font-bold text-[#141414]">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 lg:gap-6 max-w-6xl mx-auto w-full">
        <StatCard
          progress={timelineProgress}
          label="Timeline"
          value={`${daysLeft} Days`}
          color="text-emerald-500"
        />
        <StatCard
          progress={weightProgress}
          label="Weight"
          value={`${currentWeight} lbs`}
          color="text-blue-500"
        />
        <StatCard
          progress={bfProgress}
          label="Body Fat"
          value={`${currentBF}%`}
          color="text-orange-500"
        />
      </div>

      <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
        <div className="space-y-4">
          <TodoItem
            icon={<span className="text-xl leading-none">📈</span>}
            title="Vitals"
            status={vitalsLoggedToday ? 'completed' : 'none'}
            onAction={(action) => {
              if (action === 'approve') handleVitalsToggle();
              if (action === 'view') setShowVitalsModal(true);
            }}
          />

          <TodoItem
            icon={<span className="text-xl leading-none">💪</span>}
            title="Lift"
            status={todayWorkout?.status || 'none'}
            onAction={(action) => {
              if (action === 'approve') handleWorkoutToggle();
              if (action === 'view') setShowWorkoutModal(true);
            }}
          />

          {todayMealPlan ? (
            <TodoItem
              icon={<span className="text-xl leading-none">🍴</span>}
              title="Meals"
              status={todayMealPlan.status === 'completed' ? 'completed' : 'none'}
              onAction={(action) => {
                if (action === 'approve') handleAllMealsToggle();
                if (action === 'view') setShowMealModal(true);
              }}
            />
          ) : (
            <TodoItem
              icon={<span className="text-xl leading-none">🍴</span>}
              title="Meals"
              status="none"
              onAction={() => onNavigate('meals')}
            />
          )}
        </div>
      </div>

      </div>

      <AnimatePresence>
        {showVitalsModal && (
          <VitalsModal
            key="vitals-modal"
            profile={profile}
            currentWeight={todayEntry?.weight ?? NaN}
            currentBodyFat={todayEntry?.bodyFat ?? NaN}
            existingId={todayEntry?.id}
            onClose={() => setShowVitalsModal(false)}
          />
        )}
        {showMealModal && todayMealPlan && (
          <MealModal
             key="meal-modal"
             meals={safeMeals(todayMealPlan.meals, foodBankItems)}
             dayName={todayMealPlan.day}
             targetCalories={currentTargets.dailyCalories}
             onClose={() => setShowMealModal(false)}
             onEditMeal={(mIdx) => {
               const safe = safeMeals(todayMealPlan.meals, foodBankItems);
               const slotName = ["Breakfast", "Lunch", "Dinner", "Snack"][mIdx] || `Meal ${mIdx + 1}`;
               const meal = safe[mIdx] ?? {
                 name: slotName,
                 calories: 0,
                 protein: 0,
                 carbs: 0,
                 fats: 0,
                 fiber: 0,
                 ingredients: [],
                 ingredientsWithAmounts: [],
                 status: 'none',
               };
               setEditingMeal({ mIdx, meal });
             }}
             onConfirm={async () => {
               if (!latestMealPlan || !todayMealPlan) return;
               const updatedDays = [...latestMealPlan.days];
               const dayIndex = updatedDays.findIndex(d => d.day === todayMealPlan.day);
               if (dayIndex !== -1) {
                 updatedDays[dayIndex].meals = updatedDays[dayIndex].meals.map(m => ({ ...m, status: 'completed' }));
                 await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', latestMealPlan.id), stripUndefined({
                   days: updatedDays,
                   updatedAt: new Date().toISOString()
                 }));
               }
             }}
             onToggleMeal={async (mIdx) => {
               if (!latestMealPlan || !todayMealPlan) return;
               const updatedDays = [...latestMealPlan.days];
               const dayIndex = updatedDays.findIndex(d => d.day === todayMealPlan.day);
               if (dayIndex !== -1) {
                 const meals = [...updatedDays[dayIndex].meals];
                 const currentStatus = meals[mIdx].status;
                 meals[mIdx] = {
                   ...meals[mIdx],
                   status: currentStatus === 'completed' ? 'none' : 'completed'
                 };
                 updatedDays[dayIndex].meals = meals;
                 await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', latestMealPlan.id), stripUndefined({
                   days: updatedDays,
                   updatedAt: new Date().toISOString()
                 }));
               }
             }}
          />
        )}
        {showWorkoutModal && latestWorkout && (
          <WorkoutModal
            key="workout-modal"
            workout={latestWorkout}
            liftBank={liftBankItems}
            onClose={() => setShowWorkoutModal(false)}
            onConfirm={() => handleWorkoutToggle()}
            onRest={() => handleRestToday()}
            onUndoRest={() => handleUndoRest()}
            onEditExercise={(eIdx) => {
              if (!todayWorkout) return;
              const exercise = todayWorkout.exercises?.[eIdx];
              if (!exercise) return;
              setEditingExercise({ eIdx, exercise: JSON.parse(JSON.stringify(exercise)) });
            }}
          />
        )}
        {editingMeal && (
          <EditMealModal
             key="edit-meal-modal"
             meal={editingMeal.meal}
             mealName={["Breakfast", "Lunch", "Dinner", "Snack"][editingMeal.mIdx] || editingMeal.meal.name}
             targetCalories={currentTargets.dailyCalories}
             foodBank={foodBankItems}
             onClose={() => setEditingMeal(null)}
             onSave={(updatedMeal) => handleUpdateMeal(editingMeal.mIdx, updatedMeal)}
          />
        )}
        {editingExercise && (() => {
          const liveExercise = todayWorkout?.exercises?.[editingExercise.eIdx] ?? editingExercise.exercise;
          return (
            <EditExerciseModal
               key="edit-exercise-modal"
               exercise={liveExercise}
               liftBank={liftBankItems}
               onClose={() => setEditingExercise(null)}
               onUpdate={(updatedExercise) => handleUpdateExercise(editingExercise.eIdx, updatedExercise)}
               onRemove={() => handleRemoveExercise(editingExercise.eIdx)}
            />
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function VitalsModal({ profile, currentWeight, currentBodyFat, existingId, onClose }: { profile: UserProfile, currentWeight: number, currentBodyFat: number, existingId?: string, onClose: () => void, key?: React.Key }) {
  const [weight, setWeight] = useState(currentWeight);
  const [bodyFat, setBodyFat] = useState(currentBodyFat);
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Number.isNaN(weight) || Number.isNaN(bodyFat)) return;
    setIsSubmitting(true);
    try {
      // Create a date object that represents the selected day at current local time
      // to avoid jumping to the next/previous day when converted to ISO
      const [year, month, day] = date.split('-').map(Number);
      const now = new Date();
      const selectedDate = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds());
      
      const isoDate = selectedDate.toISOString();

      if (existingId) {
        await updateDoc(doc(db, 'users', profile.uid, 'vitals', existingId), {
          date: isoDate,
          weight,
          bodyFat,
          updatedAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'users', profile.uid, 'vitals'), {
          date: isoDate,
          weight,
          bodyFat,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      // Log daily target snapshot
      await logDailyTarget(profile.uid, profile, weight, bodyFat, isoDate);
      
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-md p-6 lg:p-8 rounded-3xl shadow-2xl border border-[#141414]/5"
      >
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold text-[#141414] flex items-center gap-2">
            <span className="text-2xl leading-none">📈</span>
            Vitals
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20 pointer-events-none" size={18} />
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              aria-label="Date"
              className="w-full h-12 pl-12 pr-4 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] appearance-none"
            />
          </div>

          <div className="relative">
            <Scale className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
            <input
              type="number"
              step="1"
              value={Number.isNaN(weight) ? '' : weight}
              onChange={e => setWeight(parseFloat(e.target.value))}
              placeholder="Weight (lbs)"
              aria-label="Weight (lbs)"
              className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
            />
          </div>

          <div className="relative">
            <Activity className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
            <input
              type="number"
              step="1"
              value={Number.isNaN(bodyFat) ? '' : bodyFat}
              onChange={e => setBodyFat(parseFloat(e.target.value))}
              placeholder="Body Fat (%)"
              aria-label="Body Fat (%)"
              className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
            />
          </div>

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Log Vitals'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function MealModal({ meals, dayName, targetCalories, onClose, onConfirm, onToggleMeal, onEditMeal }: { meals: Meal[], dayName: string, targetCalories?: number, onClose: () => void, onConfirm?: () => void, onToggleMeal?: (idx: number) => void, onEditMeal?: (idx: number) => void, key?: React.Key }) {
  const safe = (meals || []).filter(Boolean);
  const totalCalories = safe.reduce((sum, m) => sum + (m?.calories || 0), 0);
  const MEAL_SLOT_NAMES = ["Breakfast", "Lunch", "Dinner", "Snack"];
  const slots = MEAL_SLOT_NAMES.map((_, i) => safe[i] ?? null);
  
  return (
    <div 
      className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-3xl p-6 lg:p-8 rounded-3xl shadow-2xl border border-[#141414]/5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-50 rounded-xl flex items-center justify-center">
              <span className="text-2xl leading-none">🍴</span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-[#141414]">Today's Meals</h3>
              <p className={`text-[#141414]/60 ${targetCalories && totalCalories > targetCalories ? 'text-red-500' : ''}`}>
                {targetCalories
                  ? (totalCalories > targetCalories
                      ? `${totalCalories - targetCalories} cal over`
                      : `${targetCalories - totalCalories} cal remaining`)
                  : `${totalCalories} cal total`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          {slots.map((meal, mIdx) => {
            const slotName = MEAL_SLOT_NAMES[mIdx];
            const isEmpty = !meal || !((meal as any).ingredientsWithAmounts?.length);
            const isCompleted = !isEmpty && meal?.status === 'completed';
            return (
              <div
                key={mIdx}
                onClick={() => onEditMeal?.(mIdx)}
                role={onEditMeal ? 'button' : undefined}
                tabIndex={onEditMeal ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!onEditMeal) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEditMeal(mIdx);
                  }
                }}
                className={`p-5 rounded-2xl transition-all ${onEditMeal ? 'cursor-pointer hover:ring-2 hover:ring-[#141414]/10' : ''} ${isCompleted ? 'bg-green-50/50 border border-green-100' : 'bg-[#141414]/5'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isEmpty ? (
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs bg-white text-[#141414]/40 shadow-sm">
                        {slotName[0]}
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleMeal?.(mIdx); }}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs transition-all ${
                          isCompleted ? 'bg-green-500 text-white shadow-lg shadow-green-500/20' : 'bg-white text-[#141414]/60 shadow-sm'
                        }`}
                      >
                        {isCompleted ? <Check size={16} /> : (slotName[0])}
                      </button>
                    )}
                    <h4 className={`text-lg font-bold transition-all ${isCompleted ? 'text-green-700' : isEmpty ? 'text-[#141414]/60' : 'text-[#141414]'}`}>{slotName}</h4>
                    {isCompleted && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold uppercase rounded-md">Logged</span>
                    )}
                    {isEmpty && (
                      <span className="px-2 py-0.5 bg-[#141414]/5 text-[#141414]/40 text-[10px] font-bold uppercase rounded-md">Empty</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-sm font-bold transition-all ${isCompleted ? 'text-green-600' : isEmpty ? 'text-[#141414]/40' : 'text-[#141414]/70'}`}>{meal?.calories || 0} cal</span>
                  </div>
                </div>
              </div>
            );
          })}

        </div>
      </motion.div>
    </div>
  );
}

function WorkoutModal({ workout, liftBank = [], onClose, onConfirm, onRest, onUndoRest, onEditExercise }: { workout: WorkoutPlan, liftBank?: LiftBankItem[], onClose: () => void, onConfirm?: () => void, onRest?: () => void, onUndoRest?: () => void, onEditExercise?: (idx: number) => void, key?: React.Key }) {
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayName = dayNames[new Date().getDay()];
  const todayWorkout = workout.days.find(d => d.day === todayName) || workout.days[0];

  return (
    <div 
      className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-3xl p-6 lg:p-8 rounded-3xl shadow-2xl border border-[#141414]/5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${todayWorkout.title === 'Rest' ? 'bg-blue-50' : 'bg-purple-50'}`}>
              <span className="text-2xl leading-none">{todayWorkout.title === 'Rest' ? '😴' : '💪'}</span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-[#141414]">{todayWorkout.title}</h3>
              <p className="text-[#141414]/60">
                {todayWorkout.day}
                {todayWorkout.title !== 'Rest' && ` • ${todayWorkout.exercises.length} Exercises`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        {todayWorkout.title !== 'Rest' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="flex items-center gap-3 p-4 bg-[#141414]/5 rounded-2xl">
              <Timer className="text-[#141414]/40" size={20} />
              <div>
                <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Duration</p>
                <p className="font-bold text-[#141414]">45-60 mins</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-[#141414]/5 rounded-2xl">
              <Zap className="text-[#141414]/40" size={20} />
              <div>
                <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Intensity</p>
                <p className="font-bold text-[#141414]">Moderate-High</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-2 mb-6">
          {todayWorkout.title === 'Rest' ? (
            <div className="p-8 bg-blue-50 rounded-2xl text-center">
              <Zap className="text-blue-500 mx-auto mb-4" size={32} />
              <h5 className="font-bold text-blue-900 mb-2">Rest & Recovery Day</h5>
              <p className="text-sm text-blue-700">{todayWorkout.notes || "Focus on active recovery and mobility today."}</p>
            </div>
          ) : (
            todayWorkout.exercises.map((ex, idx) => (
              <div
                key={`ex-${idx}-${ex.name}`}
                onClick={() => onEditExercise?.(idx)}
                role={onEditExercise ? 'button' : undefined}
                tabIndex={onEditExercise ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!onEditExercise) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onEditExercise(idx);
                  }
                }}
                className={`flex items-center gap-3 p-3 bg-[#141414]/5 rounded-2xl border border-transparent transition-all ${onEditExercise ? 'cursor-pointer hover:ring-2 hover:ring-[#141414]/10' : 'hover:border-[#141414]/10'}`}
              >
                <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {idx + 1}
                </div>
                <h5 className="flex-1 font-bold text-[#141414] truncate">{resolveLiftName(ex.name, liftBank)}</h5>
              </div>
            ))
          )}
        </div>

        {todayWorkout.title !== 'Rest' && onRest && (
          <button
            onClick={onRest}
            aria-label="Rest"
            className="w-full py-3 bg-[#141414]/5 text-[#141414] rounded-2xl hover:bg-[#141414]/10 transition-all flex items-center justify-center"
          >
            <span className="text-lg leading-none">😴</span>
          </button>
        )}

        {todayWorkout.title === 'Rest' && onUndoRest && workout.restBackup?.day === todayWorkout.day && (
          <button
            onClick={onUndoRest}
            aria-label="Undo Rest"
            className="w-full py-3 bg-[#141414]/5 text-[#141414] rounded-2xl hover:bg-[#141414]/10 transition-all flex items-center justify-center"
          >
            <span className="text-lg leading-none">↩️</span>
          </button>
        )}

      </motion.div>
    </div>
  );
}

interface TodoItemProps {
  icon: React.ReactNode;
  title: string;
  status: 'completed' | 'skipped' | 'none' | 'pending';
  onAction: (action: 'approve' | 'deny' | 'view') => void;
}

const TodoItem: React.FC<TodoItemProps> = ({ icon, title, status, onAction }) => {
  const isCompleted = status === 'completed';

  return (
    <div
      onClick={() => onAction('view')}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAction('view');
        }
      }}
      className={`flex items-center justify-between p-4 rounded-2xl border transition-all group cursor-pointer ${
        isCompleted ? 'bg-green-50/50 border-green-100' : 'bg-white border-[#141414]/5 hover:border-[#141414]/10'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <h4 className="font-bold text-[#141414]">{title}</h4>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction('approve');
          }}
          aria-label={isCompleted ? 'Mark pending' : 'Mark completed'}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
            isCompleted
              ? 'bg-green-500 text-white hover:bg-green-600'
              : 'bg-[#141414]/5 text-[#141414]/50 hover:bg-green-500 hover:text-white'
          }`}
        >
          <Check size={18} />
        </button>
      </div>
    </div>
  );
}

function EditMealModal({ meal, mealName, targetCalories, foodBank, onClose, onSave }: { meal: any, mealName?: string, targetCalories?: number, foodBank: FoodBankItem[], onClose: () => void, onSave: (updatedMeal: any) => void, key?: React.Key }) {
  const [currentMeal, setCurrentMeal] = useState(meal);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFoodBank, setShowFoodBank] = useState(false);

  const filteredFoodBank = searchQuery.trim()
    ? foodBank.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  const cleanName = (name: string) => name?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';

  const findFoodItem = (name: string) => {
    const cleaned = cleanName(name);
    if (!cleaned) return null;
    return foodBank
      .sort((a, b) => (a.hidden === b.hidden ? 0 : a.hidden ? 1 : -1))
      .find(f => cleanName(f.name) === cleaned);
  };

  const calculateTotals = (ingredients: any[]) => {
    let calories = 0, protein = 0, carbs = 0, fats = 0, fiber = 0;
    ingredients.forEach(ing => {
      const food = findFoodItem(ing.name);
      if (food) {
        const amount = parseFloat(ing.amount) || 0;
        const ratio = food.servingSize > 0 ? amount / food.servingSize : 0;
        calories += (food.calories || 0) * ratio;
        protein += (food.protein || 0) * ratio;
        carbs += (food.carbs || 0) * ratio;
        fats += (food.fats || 0) * ratio;
        fiber += (food.fiber || 0) * ratio;
      }
    });
    return {
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      fats: Math.round(fats * 10) / 10,
      fiber: Math.round(fiber * 10) / 10
    };
  };

  const updateIngredientAmount = (idx: number, newAmount: string) => {
    const newIngredients = [...currentMeal.ingredientsWithAmounts];
    const ing = newIngredients[idx];
    const food = findFoodItem(ing.name);
    const val = parseFloat(newAmount) || 0;
    const unit = (food?.servingUnit || 'unit').toLowerCase();
    
    newIngredients[idx].amount = `${val} ${unit === 'unit' ? (val === 1 ? 'unit' : 'units') : unit}`;
    newIngredients[idx].name = food?.name || ing.name;
    const totals = calculateTotals(newIngredients);
    setCurrentMeal({
      ...currentMeal,
      ingredientsWithAmounts: newIngredients,
      ingredients: newIngredients.map((i: any) => `${i.amount} ${i.name}`),
      ...totals
    });
  };

  const removeIngredient = (idx: number) => {
    const newIngredients = currentMeal.ingredientsWithAmounts.filter((_: any, i: number) => i !== idx);
    const totals = calculateTotals(newIngredients);
    setCurrentMeal({
      ...currentMeal,
      ingredientsWithAmounts: newIngredients,
      ingredients: newIngredients.map((i: any) => `${i.amount} ${i.name}`),
      ...totals
    });
  };

  const handleSave = () => {
    onSave(currentMeal);
  };

  const addIngredient = (food: FoodBankItem) => {
    let unit = (food.servingUnit || 'unit').toLowerCase();
    if (unit === 'units') unit = 'unit';
    const newIngredients = [
      ...currentMeal.ingredientsWithAmounts || [],
      { name: food.name, amount: `${food.servingSize} ${unit === 'unit' ? (food.servingSize === 1 ? 'unit' : 'units') : unit}` }
    ];
    const totals = calculateTotals(newIngredients);
    setCurrentMeal({
      ...currentMeal,
      ingredientsWithAmounts: newIngredients,
      ingredients: newIngredients.map((i: any) => `${i.amount} ${i.name}`),
      ...totals
    });
    setShowFoodBank(false);
    setSearchQuery('');
  };

  return (
    <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-stretch md:items-center justify-center md:p-4" onClick={handleSave}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-2xl rounded-none md:rounded-3xl shadow-2xl border-0 md:border md:border-[#141414]/5 h-[100dvh] md:h-auto md:max-h-[90vh] overflow-y-auto overscroll-contain"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 md:p-8 pb-0 md:pb-0">
        <div className="flex items-start justify-between gap-3 mb-4 md:mb-6">
          <div className="flex-1 min-w-0">
            <h3 className="text-xl md:text-2xl font-bold text-[#141414] truncate tracking-tight">Edit {mealName || currentMeal.name}</h3>
            <p className="hidden md:block text-sm text-[#141414]/40">Customize ingredients and portions.</p>
          </div>
          <button
            onClick={handleSave}
            aria-label="Close"
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#141414]/5 text-[#141414]/40 hover:text-[#141414] hover:bg-[#141414]/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 md:mb-8 p-3 md:p-4 bg-[#141414]/5 rounded-2xl flex items-center gap-2 md:gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center shrink-0">
            <span className="text-2xl md:text-3xl leading-none">🔥</span>
          </div>
          <div className="flex-1 grid grid-cols-5 gap-1 md:gap-4 min-w-0">
            {[
              { label: 'Target', value: targetCalories ?? '—', className: 'text-green-500' },
              { label: 'Kcal', value: Math.round(currentMeal.calories) },
              { label: 'P', value: Math.round(currentMeal.protein), unit: 'g' },
              { label: 'C', value: Math.round(currentMeal.carbs), unit: 'g' },
              { label: 'F', value: Math.round(currentMeal.fats), unit: 'g' },
            ].map((stat, i) => (
              <div key={i} className="text-center min-w-0">
                <p className="text-[9px] md:text-[10px] font-bold text-[#141414]/40 uppercase tracking-wider md:tracking-widest mb-1">{stat.label}</p>
                <p className={`text-sm md:text-lg font-black whitespace-nowrap ${stat.className ?? 'text-[#141414]'}`}>
                  {stat.value}{stat.unit && <span className="hidden md:inline">{stat.unit}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 md:space-y-4 mb-4 md:mb-6">
          {(currentMeal.ingredientsWithAmounts || []).map((ing: any, idx: number) => {
            const food = findFoodItem(ing.name);
            const unit = (food?.servingUnit || 'unit').toLowerCase();
            return (
              <div key={idx} className="p-3 md:p-4 bg-white border border-[#141414]/5 rounded-2xl">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#141414] truncate">{food?.name || ing.name}</p>
                    <p className="text-xs text-[#141414]/40 truncate">
                      {food ? `${food.calories} cal / ${food.servingSize} ${unit === 'unit' ? (food.servingSize === 1 ? 'unit' : 'units') : unit}` : 'Custom item'}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center bg-[#141414]/5 rounded-xl p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const val = parseFloat(ing.amount) || 0;
                        updateIngredientAmount(idx, `${Math.max(0, val - 1)}`);
                      }}
                      className="w-7 h-8 flex items-center justify-center hover:bg-[#141414]/10 rounded-lg text-[#141414]/60 hover:text-[#141414] transition-colors text-lg font-bold shrink-0"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={unit === 'unit' ? Math.round(parseFloat(ing.amount) || 0) : Math.ceil(parseFloat(ing.amount) || 0)}
                      step="1"
                      onChange={(e) => updateIngredientAmount(idx, e.target.value)}
                      className="w-12 bg-transparent border-none text-sm font-bold text-center focus:ring-0 p-0 appearance-none"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const val = parseFloat(ing.amount) || 0;
                        updateIngredientAmount(idx, `${val + 1}`);
                      }}
                      className="w-7 h-8 flex items-center justify-center hover:bg-[#141414]/10 rounded-lg text-[#141414]/60 hover:text-[#141414] transition-colors text-lg font-bold shrink-0"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeIngredient(idx)}
                    className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          {showFoodBank ? (
            <div className="p-4 border-2 border-dashed border-[#141414]/10 rounded-2xl space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search food bank..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                {filteredFoodBank.map(food => (
                  <button
                    key={food.id}
                    onClick={() => addIngredient(food)}
                    className="flex items-center justify-between p-3 hover:bg-[#141414]/5 rounded-xl text-left transition-colors"
                  >
                    <div>
                      <p className="font-bold text-sm text-[#141414]">{food.name}</p>
                      <p className="text-[10px] text-[#141414]/40">{food.calories} cal / {food.servingSize}{food.servingUnit}</p>
                    </div>
                    <Plus size={16} className="text-[#141414]/20" />
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowFoodBank(false)}
                className="w-full py-2 text-sm font-bold text-[#141414]/40 hover:text-[#141414]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowFoodBank(true)}
              aria-label="Add food"
              className="w-full py-2.5 rounded-xl border-2 border-[#141414]/10 hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-center"
            >
              <span className="text-xl leading-none">＋</span>
            </button>
          )}
        </div>

        </div>
      </motion.div>
    </div>
  );
}

function EditExerciseModal({ exercise, liftBank, onClose, onUpdate, onRemove }: { exercise: Exercise, liftBank: LiftBankItem[], onClose: () => void, onUpdate: (updatedExercise: Exercise) => void, onRemove: () => void, key?: React.Key }) {
  const sets = Math.max(1, exercise.sets || 1);
  const setReps = exercise.setReps || [];
  const setWeights = exercise.setWeights || [];

  const updateSet = (sIdx: number, field: 'reps' | 'weight', value: number) => {
    const key = field === 'reps' ? 'setReps' : 'setWeights';
    const source = field === 'reps' ? setReps : setWeights;
    const next = source.length >= sets ? [...source] : [...source, ...Array(sets - source.length).fill(0)];
    next[sIdx] = Number.isFinite(value) ? value : 0;
    onUpdate({ ...exercise, sets, [key]: next });
  };

  const addSet = () => {
    onUpdate({
      ...exercise,
      sets: sets + 1,
      setReps: [...setReps, ...Array(Math.max(0, sets - setReps.length)).fill(0), 0],
      setWeights: [...setWeights, ...Array(Math.max(0, sets - setWeights.length)).fill(0), 0],
    });
  };

  const removeSet = (sIdx: number) => {
    if (sets <= 1) return;
    onUpdate({
      ...exercise,
      sets: sets - 1,
      setReps: setReps.filter((_, i) => i !== sIdx),
      setWeights: setWeights.filter((_, i) => i !== sIdx),
    });
  };

  const displayName = resolveLiftName(exercise.name, liftBank);

  return (
    <div
      className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-md p-6 rounded-3xl shadow-2xl border border-[#141414]/5 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="flex-1 min-w-0">
            <h3 className="text-2xl font-bold text-[#141414] truncate">{displayName}</h3>
            {exercise.notes && (
              <p className="text-sm text-[#141414]/60 leading-relaxed mt-2">{exercise.notes}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#141414]/5 text-[#141414]/40 hover:text-[#141414] hover:bg-[#141414]/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2">
          {Array.from({ length: sets }).map((_, sIdx) => (
            <div
              key={sIdx}
              className="flex items-center gap-2 md:gap-4 p-2 md:p-3 bg-[#141414]/[0.03] rounded-xl"
            >
              <div className="w-7 h-7 md:w-8 md:h-8 bg-white rounded-lg flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-[#141414]/40">{sIdx + 1}</span>
              </div>

              <div className="flex-1 grid grid-cols-2 gap-2 md:gap-4">
                <div className="relative">
                  <input
                    type="number"
                    value={setReps[sIdx] || ''}
                    onChange={(e) => updateSet(sIdx, 'reps', parseInt(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full pl-3 pr-10 py-2 rounded-lg text-base font-bold transition-all bg-white border border-[#141414]/10 focus:ring-2 focus:ring-[#141414]/10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase text-[#141414]/20">reps</span>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    value={setWeights[sIdx] || ''}
                    onChange={(e) => updateSet(sIdx, 'weight', parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full pl-3 pr-10 py-2 rounded-lg text-base font-bold transition-all bg-white border border-[#141414]/10 focus:ring-2 focus:ring-[#141414]/10"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase text-[#141414]/20">lbs</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeSet(sIdx)}
                disabled={sets <= 1}
                title={sets <= 1 ? 'At least one set is required' : 'Remove set'}
                className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-[#141414]/30 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#141414]/30 transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={addSet}
            title="Add set"
            aria-label="Add set"
            className="w-full py-2.5 rounded-xl border-2 border-[#141414]/10 hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-center"
          >
            <span className="text-xl leading-none">＋</span>
          </button>
          <button
            onClick={onRemove}
            title="Delete exercise"
            aria-label="Delete exercise"
            className="w-full py-2.5 rounded-xl border-2 border-red-200 hover:border-red-300 hover:bg-red-50 transition-all flex items-center justify-center"
          >
            <span className="text-xl leading-none">🗑️</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function StatCard({ progress, label, value, color }: { progress?: number, label: React.ReactNode, value: string, color?: string }) {
  return (
    <div className="bg-white p-4 lg:p-6 rounded-2xl lg:rounded-3xl border border-[#141414]/5 shadow-sm flex flex-col lg:flex-row items-center lg:items-start gap-3 lg:gap-4 text-center lg:text-left">
      {progress !== undefined && (
        <div className="w-12 h-12 lg:w-14 lg:h-14 bg-[#141414]/5 rounded-xl lg:rounded-2xl flex items-center justify-center shrink-0 relative">
          <svg viewBox="0 0 56 56" className="w-full h-full -rotate-90">
            <circle
              cx="28"
              cy="28"
              r="22"
              fill="transparent"
              stroke="currentColor"
              strokeWidth="4"
              className="text-[#141414]/5"
            />
            <motion.circle
              cx="28"
              cy="28"
              r="22"
              fill="transparent"
              stroke="currentColor"
              strokeWidth="4"
              strokeDasharray={138}
              initial={{ strokeDashoffset: 138 }}
              animate={{ strokeDashoffset: 138 - (138 * progress) / 100 }}
              className={color}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] lg:text-[10px] font-bold text-[#141414]">
            {progress}%
          </span>
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[10px] lg:text-sm font-medium text-[#141414]/40 uppercase tracking-wider mb-0.5 lg:mb-1">{label}</p>
        <p className="text-base lg:text-2xl font-bold text-[#141414] tracking-tight whitespace-nowrap">{value}</p>
      </div>
    </div>
  );
}

function ActionButton({ icon, color, isDark = false, isActive = false, onClick }: { icon: React.ReactNode, color: string, isDark?: boolean, isActive?: boolean, onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button 
      onClick={onClick}
      className={`p-2 rounded-lg transition-all ${isActive ? '' : (isDark ? 'text-white/40' : 'text-[#141414]/20')} ${color}`}
    >
      {icon}
    </button>
  );
}
