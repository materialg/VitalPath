import React, { useState, useEffect, useCallback, useRef } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkoutPlan, VitalLog, WorkoutDay, LiftBankItem, LiftCategory } from '../types';
import { generateWorkoutPlan, calculateDailyTargets, checkIsAIConfigured } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { Dumbbell, Sparkles, CheckCircle2, Info, Timer, Zap, ChevronRight, Calendar, X, Flame, Target, TrendingDown, Clock, Plus, Trash2, Check } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

export function WorkoutCoach({ profile }: Props) {
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(profile.activeWorkoutId || null);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [selectedDay, setSelectedDay] = useState(todayIdx);
  const selectedDayRef = useCallback((el: HTMLButtonElement | null) => {
    if (el) el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, inline: 'center', block: 'nearest' });
  }, []);
  const [latestVital, setLatestVital] = useState<VitalLog | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAIReady, setIsAIReady] = useState<boolean | null>(null);
  const [aiConfigInfo, setAiConfigInfo] = useState<{ foundKeys?: string[] }>({});
  const [liftBank, setLiftBank] = useState<LiftBankItem[]>([]);
  const [isPickingLift, setIsPickingLift] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (!profile.uid) return;

    const qVitals = query(
      collection(db, 'users', profile.uid, 'vitals'),
      orderBy('date', 'desc'),
      limit(1)
    );
    const unsubscribeVitals = onSnapshot(qVitals, (snap) => {
      if (!snap.empty) {
        setLatestVital({ id: snap.docs[0].id, ...snap.docs[0].data() } as VitalLog);
      }
    });

    const qPlans = query(
      collection(db, 'users', profile.uid, 'workouts'),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );
    const unsubscribePlans = onSnapshot(qPlans, (snap) => {
      const plans = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkoutPlan));
      setWorkoutPlans(plans);

      if (plans.length === 0) return;

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
        !Array.isArray(p.days) || !p.days.some(d =>
          Array.isArray((d as any).exercises) && (d as any).exercises.length > 0
        );
      // Prefer a real (non-stub) plan covering today; fall back to a stub if it's
      // all we have so the wheel still has something selected.
      const planForToday = plans.find(p => planCoversToday(p) && !isPlanStub(p))
        || plans.find(planCoversToday);

      // First snapshot after mount: prefer the plan that covers today,
      // so the wheel can highlight + center on the current day.
      if (initialLoadRef.current) {
        initialLoadRef.current = false;
        setActivePlanId(planForToday?.id || profile.activeWorkoutId || plans[0].id);
        return;
      }

      if (!activePlanId || !plans.find(p => p.id === activePlanId)) {
        setActivePlanId(planForToday?.id || profile.activeWorkoutId || plans[0].id);
      }
    });

    const qLifts = query(collection(db, 'users', profile.uid, 'liftBank'), orderBy('name', 'asc'));
    const unsubscribeLifts = onSnapshot(qLifts, (snap) => {
      setLiftBank(snap.docs.map(d => ({ id: d.id, ...d.data() } as LiftBankItem)));
    });

    return () => {
      unsubscribeVitals();
      unsubscribePlans();
      unsubscribeLifts();
    };
  }, [profile.uid, activePlanId]);

  useEffect(() => {
    checkIsAIConfigured().then(info => {
      console.log("[WorkoutCoach] AI Ready status:", info);
      setIsAIReady(info.isConfigured);
      setAiConfigInfo({ foundKeys: info.foundKeys });
    });
  }, []);

  const activePlan = workoutPlans.find(p => p.id === activePlanId) || workoutPlans[0];
  const targets = latestVital ? calculateDailyTargets(profile, latestVital.weight, latestVital.bodyFat) : null;

  const mondayOfDate = (d: Date) => {
    const m = new Date(d);
    m.setHours(0, 0, 0, 0);
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  };

  // A "stub" is a placeholder plan with no real exercises — created when an
  // older version of the wheel auto-built an empty rest-week. We treat them
  // as missing so AI generation can replace them.
  const isStubPlan = (p: WorkoutPlan) =>
    !Array.isArray(p.days) || !p.days.some(day =>
      Array.isArray((day as any).exercises) && (day as any).exercises.length > 0
    );

  const handleGenerate = async (weekStartOverride?: string): Promise<string | null> => {
    setIsGenerating(true);
    setError(null);
    try {
      const wsStr = weekStartOverride || mondayOfDate(new Date()).toLocaleDateString('en-CA');

      // Drop any empty stub plans for this week so we don't accumulate orphans.
      const stubsForWeek = workoutPlans.filter(p => p.weekStartDate === wsStr && isStubPlan(p));
      for (const stub of stubsForWeek) {
        try {
          await deleteDoc(doc(db, 'users', profile.uid, 'workouts', stub.id));
        } catch (err) {
          console.warn('Failed to delete stub plan, continuing:', err);
        }
      }

      const plan = await generateWorkoutPlan(profile, latestVital?.weight || 180, latestVital?.bodyFat || 20, liftBank, activePlan);
      const newPlan = {
        ...plan,
        weekStartDate: wsStr,
        updatedAt: new Date().toISOString(),
      };
      const docRef = await addDoc(collection(db, 'users', profile.uid, 'workouts'), newPlan);

      setActivePlanId(docRef.id);
      await updateDoc(doc(db, 'users', profile.uid), {
        activeWorkoutId: docRef.id
      });
      return docRef.id;
    } catch (err: any) {
      setError(err.message || "Failed to generate workout plan");
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!activePlan || !activePlanId) return;
    if (isGenerating) return;
    const ok = window.confirm("Regenerate this week's workouts? Your current plan will be replaced.");
    if (!ok) return;
    const wsStr = activePlan.weekStartDate;
    try {
      await deleteDoc(doc(db, 'users', profile.uid, 'workouts', activePlanId));
    } catch (err) {
      console.warn('Failed to delete current plan, continuing:', err);
    }
    await handleGenerate(wsStr);
  };

  // Auto-generate the current week's plan once per session if the user
  // already has prior plans but none cover today with real content (a new
  // week rolled over, or only an empty stub exists). First-time users still
  // see the empty state with a manual Generate button.
  const autoGenAttemptedRef = useRef(false);
  useEffect(() => {
    if (isGenerating) return;
    if (autoGenAttemptedRef.current) return;
    if (workoutPlans.length === 0) return;

    // Lift bank must be loaded with at least one Push, Pull, and Legs lift.
    const visible = liftBank.filter(l => !l.hidden);
    const hasPPL =
      visible.some(l => l.category === 'push') &&
      visible.some(l => l.category === 'pull') &&
      visible.some(l => l.category === 'legs');
    if (!hasPPL) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const hasRealPlanForToday = workoutPlans.some(p => {
      if (!p.weekStartDate) return false;
      const ws = new Date(p.weekStartDate + 'T00:00:00');
      ws.setHours(0, 0, 0, 0);
      const we = new Date(ws);
      we.setDate(ws.getDate() + 7);
      if (!(today >= ws && today < we)) return false;
      return !isStubPlan(p);
    });
    if (hasRealPlanForToday) return;

    autoGenAttemptedRef.current = true;
    handleGenerate();
  }, [workoutPlans, liftBank, isGenerating]);

  const handlePlanSelect = async (id: string) => {
    setActivePlanId(id);
    setIsHistoryOpen(false);
    setExpandedExercise(null);
    await updateDoc(doc(db, 'users', profile.uid), {
      activeWorkoutId: id
    });
  };

  const updateSetData = async (exerciseIdx: number, setIdx: number, field: 'weight' | 'reps', value: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const updatedExercises = [...updatedDays[selectedDay].exercises];
    const exercise = { ...updatedExercises[exerciseIdx] };
    
    if (field === 'weight') {
      const weights = exercise.setWeights ? [...exercise.setWeights] : Array(exercise.sets).fill(0);
      weights[setIdx] = value;
      exercise.setWeights = weights;
    } else {
      const reps = exercise.setReps ? [...exercise.setReps] : Array(exercise.sets).fill(0);
      reps[setIdx] = value;
      exercise.setReps = reps;
    }
    
    updatedExercises[exerciseIdx] = exercise;
    updatedDays[selectedDay].exercises = updatedExercises;

    try {
      const planRef = doc(db, 'users', profile.uid, 'workouts', activePlanId);
      await updateDoc(planRef, { 
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to update set data:", err);
      setError("Failed to save data. Please try again.");
    }
  };

  const inferCategoryFromTitle = (title: string): LiftCategory | null => {
    const lower = (title || '').toLowerCase();
    if (lower === 'rest') return null;
    if (lower.includes('pull')) return 'pull';
    if (lower.includes('leg')) return 'legs';
    if (lower.includes('push')) return 'push';
    return null;
  };

  const addExerciseFromLift = async (lift: LiftBankItem) => {
    if (!activePlan || !activePlanId) return;
    const updatedDays = [...activePlan.days];
    const day = { ...updatedDays[selectedDay] };
    const newExercise = {
      name: lift.name,
      sets: lift.defaultSets || 3,
      reps: lift.defaultReps || '8-12',
      notes: lift.notes || '',
      prescribedWeight: 0,
      setReps: [],
      setWeights: [],
    };
    day.exercises = [...(day.exercises || []), newExercise];
    updatedDays[selectedDay] = day;

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString(),
      });
      setIsPickingLift(false);
      setPickerSearch('');
    } catch (err) {
      console.error('Failed to add exercise:', err);
      setError('Failed to add exercise. Please try again.');
    }
  };

  const addSet = async (exerciseIdx: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const updatedExercises = [...updatedDays[selectedDay].exercises];
    const exercise = { ...updatedExercises[exerciseIdx] };
    const currentCount = exercise.sets || 0;
    exercise.sets = currentCount + 1;
    exercise.setReps = [...(exercise.setReps || Array(currentCount).fill(0)), 0];
    exercise.setWeights = [...(exercise.setWeights || Array(currentCount).fill(0)), 0];

    updatedExercises[exerciseIdx] = exercise;
    updatedDays[selectedDay].exercises = updatedExercises;

    try {
      const planRef = doc(db, 'users', profile.uid, 'workouts', activePlanId);
      await updateDoc(planRef, {
        days: updatedDays,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Failed to add set:", err);
      setError("Failed to add set. Please try again.");
    }
  };

  const removeSet = async (exerciseIdx: number, setIdx: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const updatedExercises = [...updatedDays[selectedDay].exercises];
    const exercise = { ...updatedExercises[exerciseIdx] };
    const currentCount = exercise.sets || 0;
    if (currentCount <= 1) return;

    exercise.sets = currentCount - 1;
    exercise.setReps = (exercise.setReps || []).filter((_, i) => i !== setIdx);
    exercise.setWeights = (exercise.setWeights || []).filter((_, i) => i !== setIdx);

    updatedExercises[exerciseIdx] = exercise;
    updatedDays[selectedDay].exercises = updatedExercises;

    try {
      const planRef = doc(db, 'users', profile.uid, 'workouts', activePlanId);
      await updateDoc(planRef, {
        days: updatedDays,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to remove set:', err);
      setError('Failed to remove set. Please try again.');
    }
  };

  const toggleExerciseStatus = async (exerciseIdx: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const day = { ...updatedDays[selectedDay] };
    const exercises = [...(day.exercises || [])];
    const existing = exercises[exerciseIdx];
    if (!existing) return;
    const isCompleted = existing.status === 'completed';
    exercises[exerciseIdx] = { ...existing, status: isCompleted ? 'pending' : 'completed' };
    day.exercises = exercises;
    const allDone = exercises.length > 0 && exercises.every(e => e.status === 'completed');
    day.status = allDone ? 'completed' : 'pending';
    updatedDays[selectedDay] = day;

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to toggle exercise status:', err);
      setError('Failed to update exercise. Please try again.');
    }
  };

  const removeExercise = async (exerciseIdx: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const currentExercises = updatedDays[selectedDay].exercises || [];
    updatedDays[selectedDay] = {
      ...updatedDays[selectedDay],
      exercises: currentExercises.filter((_, i) => i !== exerciseIdx),
    };

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'workouts', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to remove exercise:', err);
      setError('Failed to remove exercise. Please try again.');
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center justify-center md:justify-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center shrink-0">
            <span className="text-2xl leading-none">💪</span>
          </div>
          <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight">Workout Coach</h1>
        </div>
      </header>

      <div className="space-y-4">

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-sm font-medium">
          {error}
        </div>
      )}

      {isGenerating && workoutPlans.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-100 text-blue-700 rounded-2xl flex items-center gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
            <Sparkles size={18} />
          </motion.div>
          <p className="font-medium text-sm">Building this week's plan from your Lift Bank…</p>
        </div>
      )}

      {/* Daily Target Header (Consistent with Meal Planner) */}
      <div className="hidden md:block bg-[#141414] p-5 lg:p-8 rounded-3xl lg:rounded-[2.5rem] shadow-2xl text-white relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl transition-all group-hover:bg-white/10" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-5 lg:mb-8">
            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
              <Target className="text-white" size={20} />
            </div>
            <h2 className="text-xl font-bold">Training Target</h2>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-5 gap-3 lg:gap-8">
            <TargetStat label="Frequency" value="5-6 Days" subValue="PPLR Split" icon={<Dumbbell className="text-blue-400" />} />
            <TargetStat label="Intensity" value="RPE 8-9" subValue="High Effort" icon={<Zap className="text-yellow-400" />} />
            <TargetStat label="Duration" value="45-60m" subValue="Per Session" icon={<Clock className="text-purple-400" />} />
            <TargetStat label="Goal" value={`${profile.goalBodyFat}% BF`} subValue="Target" icon={<TrendingDown className="text-green-400" />} />
            <TargetStat label="Days Left" value={targets?.daysLeft.toString() || "0"} subValue="To Goal" />
          </div>
        </div>
      </div>

      {workoutPlans.length > 0 ? (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Day Selector */}
          <div className="lg:col-span-1 space-y-8">
            <div className="space-y-4">
              <div className="flex flex-col gap-4 lg:mt-8">
                {/* Mobile: 28-day wheel (2 weeks back + 2 weeks forward from today's Monday)
                    with cross-week plan navigation, matching the Meal Planner. */}
                {(() => {
                  const todayMonday = mondayOfDate(new Date());
                  const startMonday = new Date(todayMonday);
                  startMonday.setDate(todayMonday.getDate() - 14);
                  const wheelDates = Array.from({ length: 28 }, (_, i) => {
                    const d = new Date(startMonday);
                    d.setDate(startMonday.getDate() + i);
                    return d;
                  });
                  const planForDate = (date: Date) => {
                    for (const p of workoutPlans) {
                      if (!p.weekStartDate || !Array.isArray(p.days)) continue;
                      const ws = new Date(p.weekStartDate + 'T00:00:00');
                      ws.setHours(0, 0, 0, 0);
                      const we = new Date(ws);
                      we.setDate(ws.getDate() + 7);
                      if (date >= ws && date < we) return p;
                    }
                    return null;
                  };
                  const selectedAbs = activePlan?.weekStartDate ? (() => {
                    const ws = new Date(activePlan.weekStartDate + 'T00:00:00');
                    ws.setHours(0, 0, 0, 0);
                    ws.setDate(ws.getDate() + selectedDay);
                    return ws;
                  })() : null;
                  const handlePick = async (d: Date) => {
                    const p = planForDate(d);
                    if (!p) {
                      const monday = mondayOfDate(d);
                      const wsLabel = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      const ok = window.confirm(`No workout plan for the week of ${wsLabel}. Generate one with AI?`);
                      if (!ok) return;
                      const wsStr = monday.toLocaleDateString('en-CA');
                      const newId = await handleGenerate(wsStr);
                      if (!newId) return;
                      const dayInPlan = Math.round((d.getTime() - new Date(wsStr + 'T00:00:00').getTime()) / 86400000);
                      setSelectedDay(dayInPlan);
                      return;
                    }
                    if (p.id !== activePlanId) await handlePlanSelect(p.id);
                    const ws = new Date(p.weekStartDate + 'T00:00:00');
                    ws.setHours(0, 0, 0, 0);
                    const dayInPlan = Math.round((d.getTime() - ws.getTime()) / 86400000);
                    setSelectedDay(dayInPlan);
                  };
                  return (
                    <div className="lg:hidden -mx-4 px-4">
                      <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        <div aria-hidden className="shrink-0 w-[calc(50vw-2.75rem)]" />
                        {wheelDates.map((d, idx) => {
                          const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                          const dayNum = d.getDate();
                          const isSelected = selectedAbs ? d.getTime() === selectedAbs.getTime() : false;
                          const hasPlan = !!planForDate(d);
                          return (
                            <button
                              key={idx}
                              ref={isSelected ? selectedDayRef : undefined}
                              onClick={() => handlePick(d)}
                              className={`relative shrink-0 w-14 h-14 rounded-2xl flex flex-col items-center justify-center transition-colors duration-200 ${
                                isSelected
                                  ? 'text-[#141414]'
                                  : hasPlan
                                    ? 'text-[#141414]/40 hover:bg-white/50'
                                    : 'text-[#141414]/25 hover:bg-white/50'
                              }`}
                            >
                              {isSelected && (
                                <motion.div
                                  layoutId="workout-day-pill"
                                  className="absolute inset-0 bg-white border border-[#141414]/5 rounded-2xl"
                                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                />
                              )}
                              <span className="relative text-[9px] font-bold uppercase leading-none">{weekday}</span>
                              <span className="relative text-base font-black leading-tight">{dayNum}</span>
                            </button>
                          );
                        })}
                        <div aria-hidden className="shrink-0 w-[calc(50vw-2.75rem)]" />
                      </div>
                    </div>
                  );
                })()}

                {/* Desktop: vertical sidebar showing the active plan's 7 days */}
                <div className="hidden lg:flex lg:flex-col lg:gap-2">
                  {activePlan?.days.map((day, idx) => {
                    const isSelected = selectedDay === idx;
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedDay(idx)}
                        className={`relative w-full p-4 rounded-2xl flex items-center justify-between transition-colors duration-200 ${
                          isSelected
                            ? 'text-[#141414]'
                            : 'text-[#141414]/40 hover:bg-white/50'
                        }`}
                      >
                        {isSelected && (
                          <motion.div
                            layoutId="workout-day-pill-desktop"
                            className="absolute inset-0 bg-white border border-[#141414]/5 rounded-2xl"
                            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                          />
                        )}
                        <span className="relative font-bold">{day.day}</span>
                        <ChevronRight size={16} className={`relative transition-opacity duration-200 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Day Content */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white p-4 lg:p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
              <div className="mb-4 lg:mb-8 px-3 md:px-4 lg:px-6">
                <h3 className="text-xl lg:text-2xl font-bold text-[#141414]">{activePlan?.days[selectedDay]?.title}</h3>
                <p className="text-xs lg:text-sm text-[#141414]/40 font-medium">{activePlan?.days[selectedDay]?.day} Session</p>
              </div>

              <div className="space-y-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${activePlanId}-${selectedDay}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-6"
                  >
                    {activePlan?.days[selectedDay]?.title === 'Rest' ? (
                      <div className="py-12 text-center">
                        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                          <Zap className="text-blue-500" size={40} />
                        </div>
                        <h3 className="text-2xl font-bold text-[#141414] mb-2">Rest & Recovery</h3>
                        <p className="text-[#141414]/60 max-w-md mx-auto mb-8">
                          {activePlan?.days[selectedDay]?.notes || "Focus on active recovery, mobility, and high-quality sleep today."}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left max-w-xl mx-auto">
                          <div className="p-4 bg-blue-50 rounded-2xl">
                            <p className="font-bold text-blue-900 mb-1">Hydration</p>
                            <p className="text-sm text-blue-700">Drink at least 3-4 liters of water today.</p>
                          </div>
                          <div className="p-4 bg-purple-50 rounded-2xl">
                            <p className="font-bold text-purple-900 mb-1">Mobility</p>
                            <p className="text-sm text-purple-700">15 mins of light stretching or foam rolling.</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      activePlan?.days[selectedDay]?.exercises.map((ex, idx) => {
                        const isCompleted = ex.status === 'completed';
                        const isExpanded = expandedExercise === idx;
                        return (
                        <div key={idx} className="group">
                          <div
                            onClick={() => setExpandedExercise(isExpanded ? null : idx)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setExpandedExercise(isExpanded ? null : idx);
                              }
                            }}
                            className={`flex flex-col gap-4 p-3 md:p-4 lg:p-6 rounded-2xl border transition-all cursor-pointer ${
                              isCompleted
                                ? 'bg-green-50/50 border-green-100'
                                : isExpanded
                                  ? 'bg-[#141414]/5 ring-1 ring-[#141414]/10 border-transparent'
                                  : 'bg-white border-[#141414]/5 hover:border-[#141414]/10'
                            }`}
                          >
                            <div className="flex items-center md:items-start gap-3 lg:gap-4">
                              {/* Mobile: stacked name + sets × reps, capped to action-box height */}
                              <div className="flex-1 min-w-0 md:hidden flex flex-col justify-center h-10">
                                <h4 className="text-base font-bold truncate text-[#141414] leading-tight">{ex.name}</h4>
                                <p className="text-xs font-medium text-[#141414]/60 leading-tight">
                                  {ex.sets} × {ex.reps} reps
                                </p>
                              </div>

                              {/* Desktop: full header with badge, notes */}
                              <div className="flex-1 min-w-0 hidden md:block">
                                <h4 className="text-lg lg:text-xl font-bold text-[#141414] mb-2">
                                  {ex.name}
                                </h4>
                                <p className="text-sm text-[#141414]/60 leading-relaxed">{ex.notes}</p>
                              </div>

                              {/* Action icons — consistent across breakpoints */}
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExerciseStatus(idx);
                                  }}
                                  aria-label={isCompleted ? 'Mark exercise pending' : 'Mark exercise completed'}
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

                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="pt-4 mt-4 border-t border-[#141414]/10">
                                    <div className="flex items-center justify-between mb-4">
                                      <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Log Performance</p>
                                      <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Target: {ex.reps} Reps</p>
                                    </div>
                                    <div className="space-y-2">
                                      {Array.from({ length: ex.sets }).map((_, sIdx) => (
                                        <div
                                          key={sIdx}
                                          className="flex items-center gap-2 md:gap-4 p-2 md:p-3 bg-white rounded-xl border border-[#141414]/5"
                                        >
                                          <div className="w-7 h-7 md:w-8 md:h-8 bg-[#141414]/5 rounded-lg flex items-center justify-center shrink-0">
                                            <span className="text-xs font-bold text-[#141414]/40">{sIdx + 1}</span>
                                          </div>

                                          <div className="flex-1 grid grid-cols-2 gap-2 md:gap-4">
                                            <div className="relative">
                                              <input
                                                type="number"
                                                value={ex.setReps?.[sIdx] || ''}
                                                onChange={(e) => updateSetData(idx, sIdx, 'reps', parseInt(e.target.value) || 0)}
                                                onClick={(e) => e.stopPropagation()}
                                                placeholder="0"
                                                className="w-full pl-3 pr-10 py-2 rounded-lg text-sm font-bold transition-all bg-[#141414]/5 border-transparent focus:bg-white focus:ring-2 focus:ring-[#141414]/10"
                                              />
                                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase text-[#141414]/20">reps</span>
                                            </div>

                                            <div className="relative">
                                              <input
                                                type="number"
                                                value={ex.setWeights?.[sIdx] || ''}
                                                onChange={(e) => updateSetData(idx, sIdx, 'weight', parseFloat(e.target.value) || 0)}
                                                onClick={(e) => e.stopPropagation()}
                                                placeholder="0"
                                                className="w-full pl-3 pr-10 py-2 rounded-lg text-sm font-bold transition-all bg-[#141414]/5 border-transparent focus:bg-white focus:ring-2 focus:ring-[#141414]/10"
                                              />
                                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase text-[#141414]/20">lbs</span>
                                            </div>
                                          </div>

                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              removeSet(idx, sIdx);
                                            }}
                                            disabled={ex.sets <= 1}
                                            title={ex.sets <= 1 ? 'At least one set is required' : 'Remove set'}
                                            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-[#141414]/30 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#141414]/30 transition-colors"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      ))}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          addSet(idx);
                                        }}
                                        title="Add set"
                                        className="w-full py-2.5 rounded-xl border-2 border-[#141414]/10 text-[#141414]/40 hover:text-[#141414] hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-center"
                                      >
                                        <Plus size={16} />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeExercise(idx);
                                        }}
                                        title="Delete exercise"
                                        className="w-full py-2.5 rounded-xl border-2 border-red-200 text-red-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-all flex items-center justify-center"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                        );
                      })
                    )}
                    {activePlan?.days[selectedDay]?.title !== 'Rest' && (
                      <button
                        onClick={() => { setPickerSearch(''); setIsPickingLift(true); }}
                        aria-label="Add exercise from Lift Bank"
                        className="w-full p-4 lg:p-6 rounded-2xl border-2 border-[#141414]/10 text-[#141414]/40 hover:text-[#141414] hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-center"
                      >
                        <Plus size={20} />
                      </button>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleRegenerate}
            disabled={isGenerating || !activePlan}
            aria-label={isGenerating ? 'Regenerating workouts' : 'Regenerate workouts'}
            className="flex-1 p-3 flex items-center justify-center rounded-2xl transition-all text-[#141414]/40 hover:bg-[#141414]/5 border border-[#141414]/10 disabled:opacity-50 disabled:hover:bg-transparent"
          >
            {isGenerating ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                <Sparkles size={18} />
              </motion.div>
            ) : (
              <Sparkles size={18} />
            )}
          </button>

          <button
            onClick={() => setIsHistoryOpen(true)}
            aria-label="View history"
            className="flex-1 p-3 flex items-center justify-center rounded-2xl transition-all text-[#141414]/40 hover:bg-[#141414]/5 border border-[#141414]/10"
          >
            <Calendar size={18} />
          </button>
        </div>
        </>
      ) : (
        <div className="bg-white p-20 rounded-[3rem] border border-[#141414]/5 shadow-sm text-center">
          <div className="w-24 h-24 bg-[#141414]/5 rounded-full flex items-center justify-center mx-auto mb-8">
            <Dumbbell className="text-[#141414]/20" size={48} />
          </div>
          <h3 className="text-3xl font-bold text-[#141414] mb-4">No Workout Plan</h3>
          <p className="text-[#141414]/60 max-w-md mx-auto mb-10 text-lg leading-relaxed">
            Generate a custom 7-day PPLR routine designed to help you reach your body fat goals.
          </p>
          
          {isAIReady === false ? (
            <div className="max-w-md mx-auto p-6 bg-orange-50 border border-orange-200 rounded-2xl text-left space-y-3">
              <div className="flex items-center gap-3 text-orange-600">
                <Sparkles size={20} />
                <p className="font-bold text-sm">AI Features Unconfigured</p>
              </div>
              <p className="text-xs text-orange-800/80">
                Please add a valid <strong>GEMINI_API_KEY</strong> in the project settings (Settings - Secrets) to enable AI workout generation.
              </p>
              {aiConfigInfo.foundKeys && aiConfigInfo.foundKeys.length > 0 && (
                <div className="pt-2 border-t border-orange-200 mt-2">
                  <p className="text-[10px] text-orange-400 font-mono uppercase tracking-widest mb-1">Detected Keys (Verify Names):</p>
                  <div className="flex flex-wrap gap-1">
                    {aiConfigInfo.foundKeys.map(key => (
                      <span key={key} className="px-1.5 py-0.5 bg-orange-100 rounded text-[10px] font-mono text-orange-600">{key}</span>
                    ))}
                  </div>
                </div>
              ) || (
                <p className="text-[10px] text-orange-400 font-mono">No relevant API keys detected in environment.</p>
              )}
            </div>
          ) : (
            <button 
              onClick={handleGenerate}
              disabled={isGenerating || isAIReady === null}
              className="px-10 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/90 transition-all flex items-center gap-3 mx-auto disabled:opacity-50 shadow-xl shadow-[#141414]/20"
            >
              {isGenerating ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Sparkles size={20} /></motion.div>
              ) : <Sparkles size={20} />}
              Generate Weekly Plan
            </button>
          )}
        </div>
      )}

      </div>

      {/* Lift Bank Picker */}
      <AnimatePresence>
        {isPickingLift && (() => {
          const activeDayTitle = activePlan?.days[selectedDay]?.title || '';
          const preferredCategory = inferCategoryFromTitle(activeDayTitle);
          const visibleLifts = liftBank.filter(l => !l.hidden);
          const searchLower = pickerSearch.toLowerCase().trim();
          const matched = visibleLifts.filter(l => {
            if (searchLower && !l.name.toLowerCase().includes(searchLower)) return false;
            return true;
          });
          const preferred = preferredCategory
            ? matched.filter(l => l.category === preferredCategory)
            : matched;
          const others = preferredCategory
            ? matched.filter(l => l.category !== preferredCategory)
            : [];
          return (
            <div
              className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setIsPickingLift(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-lg p-8 rounded-3xl shadow-2xl border border-[#141414]/5 flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-[#141414]">Add Exercise</h3>
                    <p className="text-sm text-[#141414]/40">
                      {preferredCategory
                        ? `Showing ${preferredCategory} lifts first. Others below.`
                        : 'Pick any lift from your bank.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setIsPickingLift(false)}
                    className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <input
                  autoFocus
                  type="text"
                  placeholder="Search lift bank..."
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] mb-4"
                />

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                  {visibleLifts.length === 0 && (
                    <p className="text-sm text-[#141414]/40 text-center py-8">
                      Your Lift Bank is empty. Add lifts there first.
                    </p>
                  )}
                  {preferred.map(lift => (
                    <button
                      key={lift.id}
                      onClick={() => addExerciseFromLift(lift)}
                      className="w-full p-4 text-left rounded-xl border border-[#141414]/5 hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-[#141414]">{lift.name}</p>
                        <p className="text-[10px] text-[#141414]/40 uppercase tracking-wider">
                          {lift.category} · {lift.equipment || 'other'} · {lift.defaultSets ?? 3} × {lift.defaultReps || '8-12'}
                        </p>
                      </div>
                      <Plus size={18} className="text-[#141414]/20" />
                    </button>
                  ))}
                  {others.length > 0 && (
                    <>
                      <p className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-widest pt-4 pb-1">Other categories</p>
                      {others.map(lift => (
                        <button
                          key={lift.id}
                          onClick={() => addExerciseFromLift(lift)}
                          className="w-full p-4 text-left rounded-xl border border-[#141414]/5 hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-between opacity-70"
                        >
                          <div>
                            <p className="font-bold text-[#141414]">{lift.name}</p>
                            <p className="text-[10px] text-[#141414]/40 uppercase tracking-wider">
                              {lift.category} · {lift.equipment || 'other'} · {lift.defaultSets ?? 3} × {lift.defaultReps || '8-12'}
                            </p>
                          </div>
                          <Plus size={18} className="text-[#141414]/20" />
                        </button>
                      ))}
                    </>
                  )}
                  {matched.length === 0 && visibleLifts.length > 0 && (
                    <p className="text-sm text-[#141414]/40 text-center py-6">No lifts match your search.</p>
                  )}
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {isHistoryOpen && (() => {
          const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
          const todayKey = new Date().toLocaleDateString('en-CA');
          const workoutByDate = new Map<string, { workout: WorkoutDay; dayLabel: string; date: Date }>();

          const currentWeekMonday = new Date();
          currentWeekMonday.setHours(0, 0, 0, 0);
          currentWeekMonday.setDate(currentWeekMonday.getDate() - ((currentWeekMonday.getDay() + 6) % 7));

          for (const plan of workoutPlans) {
            if (!Array.isArray(plan.days)) continue;
            const isActive = plan.id === activePlanId;
            let base: Date;
            if (isActive) {
              base = new Date(currentWeekMonday);
            } else if (plan.weekStartDate) {
              base = new Date(plan.weekStartDate + 'T00:00:00');
              if (isNaN(base.getTime())) continue;
              base.setHours(0, 0, 0, 0);
              base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
            } else {
              continue;
            }
            plan.days.forEach((day, idx) => {
              const date = new Date(base);
              date.setDate(base.getDate() + idx);
              const key = date.toLocaleDateString('en-CA');
              if (key > todayKey) return;
              if (!workoutByDate.has(key)) {
                workoutByDate.set(key, { workout: day, dayLabel: DAY_NAMES[idx] || '', date });
              }
            });
          }

          const visibleEntries = Array.from(workoutByDate.entries())
            .map(([key, v]) => ({ key, date: v.date, dayLabel: v.dayLabel, workout: v.workout }))
            .sort((a, b) => b.date.getTime() - a.date.getTime());

          const selected = visibleEntries.find(e => e.key === selectedHistoryKey) || null;
          const workoutSummary = (workout: WorkoutDay) => {
            if (workout.title === 'Rest') return { label: 'Rest day', detail: '' };
            const exercises = workout.exercises || [];
            const completed = exercises.filter(e => e.status === 'completed').length;
            return {
              label: `${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'}`,
              detail: exercises.length > 0 ? `${completed}/${exercises.length} completed` : '',
            };
          };

          return (
          <div
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { setIsHistoryOpen(false); setSelectedHistoryKey(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-3xl p-8 rounded-3xl shadow-2xl border border-[#141414]/5 flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-[#141414]">Workout History</h3>
                  <p className="text-sm text-[#141414]/40">Every day you&apos;ve tracked, newest first.</p>
                </div>
                <button
                  onClick={() => { setIsHistoryOpen(false); setSelectedHistoryKey(null); }}
                  className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-hidden">
                <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                  {visibleEntries.length === 0 && (
                    <p className="text-sm text-[#141414]/40 text-center py-8">No workout history yet.</p>
                  )}
                  {visibleEntries.map(entry => {
                    const summary = workoutSummary(entry.workout);
                    const isSelected = selected?.key === entry.key;
                    return (
                      <button
                        key={entry.key}
                        onClick={() => setSelectedHistoryKey(entry.key)}
                        className={`w-full p-4 text-left rounded-2xl transition-all border ${
                          isSelected
                            ? 'bg-[#141414] text-white border-transparent shadow-lg'
                            : 'bg-white text-[#141414] border-[#141414]/5 hover:border-[#141414]/20'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold">
                            {entry.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                          <span className={`text-xs font-bold ${isSelected ? 'text-white/60' : 'text-[#141414]/40'}`}>
                            {entry.date.toLocaleDateString('en-US', { year: 'numeric' })}
                          </span>
                        </div>
                        <div className={`flex gap-3 text-[10px] font-medium ${isSelected ? 'text-white/60' : 'text-[#141414]/40'}`}>
                          <span>{summary.label}</span>
                          {summary.detail && (
                            <>
                              <span>·</span>
                              <span>{summary.detail}</span>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="bg-[#141414]/[0.02] rounded-2xl p-6 overflow-y-auto custom-scrollbar">
                  {selected ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">
                          {selected.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                        <h4 className="text-xl font-bold text-[#141414]">{selected.workout.title}</h4>
                      </div>
                      {selected.workout.title === 'Rest' ? (
                        <div className="py-8 text-center">
                          <Zap className="text-blue-500 mx-auto mb-4" size={32} />
                          <p className="text-sm text-[#141414]/60 leading-relaxed">
                            {selected.workout.notes || "Focus on active recovery and mobility."}
                          </p>
                        </div>
                      ) : (selected.workout.exercises || []).length === 0 ? (
                        <p className="text-sm text-[#141414]/40">No exercises recorded for this day.</p>
                      ) : (
                        (selected.workout.exercises || []).map((ex, eIdx) => {
                          const hasLogged = ex.status === 'completed';
                          return (
                            <div key={eIdx} className="bg-white p-4 rounded-xl border border-[#141414]/5">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <h5 className="font-bold text-[#141414]">{ex.name}</h5>
                                  {hasLogged && (
                                    <span className="px-1.5 py-0.5 bg-green-50 text-green-700 text-[9px] font-bold uppercase rounded">Logged</span>
                                  )}
                                </div>
                                <span className="text-xs font-bold text-[#141414]/60">{ex.sets} sets</span>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {(ex.setWeights || []).map((w, sIdx) => (
                                  <span key={sIdx} className="px-2 py-0.5 bg-[#141414]/5 rounded-full text-[10px] text-[#141414]/60">
                                    Set {sIdx + 1}: {w || 0}lb × {ex.setReps?.[sIdx] || 0}
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="w-12 h-12 bg-[#141414]/5 rounded-xl flex items-center justify-center mb-3">
                        <Calendar className="text-[#141414]/20" size={22} />
                      </div>
                      <p className="text-sm font-bold text-[#141414]">Select a day</p>
                      <p className="text-xs text-[#141414]/40">Click any date on the left to see its workout.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function TargetStat({ label, value, subValue, icon }: { label: string, value: string, subValue?: string, icon?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 mb-1">
        {icon && <div className="shrink-0 hidden md:block">{icon}</div>}
        <p className="text-[9px] lg:text-[10px] font-bold text-white/40 uppercase tracking-wider lg:tracking-widest">{label}</p>
      </div>
      <p className="text-base lg:text-2xl font-bold text-white">{value}</p>
      {subValue && <p className="hidden md:block text-[10px] font-medium text-white/40">{subValue}</p>}
    </div>
  );
}
