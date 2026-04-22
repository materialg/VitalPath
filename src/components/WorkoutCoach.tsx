import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkoutPlan, VitalLog, WorkoutDay, LiftBankItem, LiftCategory } from '../types';
import { generateWorkoutPlan, calculateDailyTargets, checkIsAIConfigured } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, parseISO, addDays } from 'date-fns';
import { Dumbbell, Sparkles, CheckCircle2, Info, Timer, Zap, ChevronRight, Calendar, X, Flame, Target, TrendingDown, Clock, Plus, Trash2, ChevronLeft } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

export function WorkoutCoach({ profile }: Props) {
  const [workoutPlans, setWorkoutPlans] = useState<WorkoutPlan[]>([]);
  const [activePlanId, setActivePlanId] = useState<string | null>(profile.activeWorkoutId || null);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [selectedDay, setSelectedDay] = useState(todayIdx);
  const [latestVital, setLatestVital] = useState<VitalLog | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedHistoryDay, setSelectedHistoryDay] = useState<{ date: Date, workout: WorkoutDay } | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAIReady, setIsAIReady] = useState<boolean | null>(null);
  const [aiConfigInfo, setAiConfigInfo] = useState<{ foundKeys?: string[] }>({});
  const [liftBank, setLiftBank] = useState<LiftBankItem[]>([]);
  const [isPickingLift, setIsPickingLift] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

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
      
      if (plans.length > 0) {
        if (!activePlanId || !plans.find(p => p.id === activePlanId)) {
          setActivePlanId(profile.activeWorkoutId || plans[0].id);
        }
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

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const plan = await generateWorkoutPlan(profile, latestVital?.weight || 180, latestVital?.bodyFat || 20, activePlan);
      const newPlan = {
        ...plan,
        weekStartDate: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
      };
      const docRef = await addDoc(collection(db, 'users', profile.uid, 'workouts'), newPlan);
      
      setActivePlanId(docRef.id);
      await updateDoc(doc(db, 'users', profile.uid), {
        activeWorkoutId: docRef.id
      });
    } catch (err: any) {
      setError(err.message || "Failed to generate workout plan");
    } finally {
      setIsGenerating(false);
    }
  };

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
    if (lower.includes('core') || lower.includes('abs')) return 'core';
    if (lower.includes('cardio')) return 'cardio';
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
        <div>
          <h1 className="text-4xl font-sans font-bold text-[#141414] tracking-tight">Workout Coach</h1>
          <p className="text-[#141414]/60">Personalized training routines to maximize fat loss and muscle retention.</p>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-sm font-medium">
          {error}
        </div>
      )}

      {/* Daily Target Header (Consistent with Meal Planner) */}
      <div className="bg-[#141414] p-5 lg:p-8 rounded-3xl lg:rounded-[2.5rem] shadow-2xl text-white relative overflow-hidden group">
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Day Selector Sidebar */}
          <div className="lg:col-span-1 space-y-8">
            <div className="space-y-4">
              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full px-6 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-[#141414]/10"
              >
                {isGenerating ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Sparkles size={18} /></motion.div>
                ) : <Sparkles size={18} />}
                {activePlan ? 'Regenerate Plan' : 'Generate Plan'}
              </button>

              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest px-2 mt-4 lg:mt-8">Select Day</h3>
                <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-4 lg:pb-0 no-scrollbar -mx-2 px-2 scroll-smooth">
                  {activePlan?.days.map((day, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedDay(idx)}
                      className={`shrink-0 lg:w-full p-4 flex items-center justify-between rounded-2xl transition-all ${
                        selectedDay === idx 
                          ? 'bg-white shadow-md border border-[#141414]/5 text-[#141414]' 
                          : 'text-[#141414]/40 hover:bg-white/50'
                      }`}
                    >
                      <span className="font-bold whitespace-nowrap lg:whitespace-normal">{day.day}</span>
                      <ChevronRight size={16} className={`hidden lg:block ${selectedDay === idx ? 'opacity-100' : 'opacity-0'}`} />
                    </button>
                  ))}
                </div>
                
                <button
                  onClick={() => setIsHistoryOpen(true)}
                  className="w-full p-4 flex items-center justify-between rounded-2xl transition-all text-[#141414]/40 hover:bg-white/50 border border-dashed border-[#141414]/10"
                >
                  <span className="font-bold text-sm">View History</span>
                  <Calendar size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Day Content */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white p-4 lg:p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
              <div className="flex items-center justify-between mb-4 lg:mb-8 px-4 lg:px-6">
                <div>
                  <h3 className="text-xl lg:text-2xl font-bold text-[#141414]">{activePlan?.days[selectedDay]?.title}</h3>
                  <p className="text-xs lg:text-sm text-[#141414]/40 font-medium">{activePlan?.days[selectedDay]?.day} Session</p>
                </div>
                {(() => {
                  if (!activePlan?.weekStartDate) {
                    return <div className="w-10 h-10 md:w-12 md:h-12 shrink-0" />;
                  }
                  const d = new Date(activePlan.weekStartDate + 'T00:00:00');
                  d.setDate(d.getDate() + selectedDay);
                  const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
                  const dayNum = d.getDate();
                  return (
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-[#141414]/5 flex flex-col items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-[#141414]/50 uppercase leading-none">{month}</span>
                      <span className="text-sm md:text-base font-black text-[#141414] leading-tight">{dayNum}</span>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-8">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${activePlanId}-${selectedDay}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
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
                      activePlan?.days[selectedDay]?.exercises.map((ex, idx) => (
                        <div key={idx} className="group">
                          <div
                            onClick={() => setExpandedExercise(expandedExercise === idx ? null : idx)}
                            className={`flex flex-col gap-4 p-4 lg:p-6 rounded-2xl transition-all cursor-pointer ${
                              expandedExercise === idx ? 'bg-[#141414]/5 ring-1 ring-[#141414]/10' : 'hover:bg-[#141414]/5'
                            }`}
                          >
                            <div className="flex items-start gap-3 lg:gap-4">
                              <div className="w-10 h-10 lg:w-12 lg:h-12 bg-[#141414] rounded-xl flex items-center justify-center shrink-0 text-white font-bold text-sm lg:text-base">
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="text-lg lg:text-xl font-bold text-[#141414] mb-0 lg:mb-2">{ex.name}</h4>
                                <p className="hidden md:block text-sm text-[#141414]/60 leading-relaxed">{ex.notes}</p>
                              </div>
                            </div>

                            <AnimatePresence>
                              {expandedExercise === idx && (
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
                                        className="w-full py-3 rounded-xl border-2 border-dashed border-[#141414]/10 text-[#141414]/40 hover:text-[#141414] hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-center gap-2 text-sm font-bold"
                                      >
                                        <Plus size={16} />
                                        Add Set
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeExercise(idx);
                                        }}
                                        className="w-full py-3 rounded-xl border-2 border-dashed border-red-200 text-red-400 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-all flex items-center justify-center gap-2 text-sm font-bold"
                                      >
                                        <Trash2 size={16} />
                                        Delete Exercise
                                      </button>
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      ))
                    )}
                    {activePlan?.days[selectedDay]?.title !== 'Rest' && (
                      <button
                        onClick={() => { setPickerSearch(''); setIsPickingLift(true); }}
                        className="w-full p-4 lg:p-6 rounded-2xl border-2 border-dashed border-[#141414]/10 text-[#141414]/40 hover:text-[#141414] hover:border-[#141414]/20 hover:bg-[#141414]/5 transition-all flex items-center justify-center gap-2 text-sm font-bold"
                      >
                        <Plus size={18} />
                        Add Exercise from Lift Bank
                      </button>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
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
        {isHistoryOpen && (
          <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => {
            setIsHistoryOpen(false);
            setSelectedHistoryDay(null);
          }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-4xl p-8 rounded-[2.5rem] shadow-2xl border border-[#141414]/5 overflow-hidden flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-[#141414]">Workout History</h3>
                  <p className="text-sm text-[#141414]/40">Track your progress and review past sessions.</p>
                </div>
                <button onClick={() => {
                  setIsHistoryOpen(false);
                  setSelectedHistoryDay(null);
                }} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Calendar View */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                      <h4 className="font-bold text-[#141414]">{format(currentMonth, 'MMMM yyyy')}</h4>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 hover:bg-[#141414]/5 rounded-lg transition-colors">
                          <ChevronLeft size={18} />
                        </button>
                        <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 hover:bg-[#141414]/5 rounded-lg transition-colors">
                          <ChevronRight size={18} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                        <div key={day} className="text-center py-2">
                          <span className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-widest">{day}</span>
                        </div>
                      ))}
                      {(() => {
                        const monthStart = startOfMonth(currentMonth);
                        const monthEnd = endOfMonth(monthStart);
                        const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
                        const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
                        const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

                        return calendarDays.map((date, idx) => {
                          // Find if there's a workout for this date
                          let workoutDay: WorkoutDay | null = null;
                          workoutPlans.forEach(plan => {
                            const weekStart = parseISO(plan.weekStartDate);
                            const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
                            plan.days.forEach((day, dIdx) => {
                              const dayDate = addDays(weekStart, dIdx);
                              if (isSameDay(dayDate, date)) {
                                workoutDay = day;
                              }
                            });
                          });

                          const isCurrentMonth = isSameDay(startOfMonth(date), startOfMonth(currentMonth));
                          const isSelected = selectedHistoryDay && isSameDay(selectedHistoryDay.date, date);

                          return (
                            <button
                              key={idx}
                              disabled={!workoutDay}
                              onClick={() => workoutDay && setSelectedHistoryDay({ date, workout: workoutDay })}
                              className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all relative ${
                                !isCurrentMonth ? 'opacity-20' : ''
                              } ${
                                workoutDay 
                                  ? isSelected 
                                    ? 'bg-[#141414] text-white shadow-lg' 
                                    : 'bg-[#141414]/5 hover:bg-[#141414]/10 text-[#141414]'
                                  : 'text-[#141414]/20 cursor-default'
                              }`}
                            >
                              <span className="text-xs font-bold">{format(date, 'd')}</span>
                              {workoutDay && !isSelected && (
                                <div className={`w-1 h-1 rounded-full ${workoutDay.title === 'Rest' ? 'bg-blue-400' : 'bg-green-500'}`} />
                              )}
                            </button>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* Day Details */}
                  <div className="bg-[#141414]/5 rounded-3xl p-6 min-h-[400px]">
                    {selectedHistoryDay ? (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">
                              {format(selectedHistoryDay.date, 'EEEE, MMM do')}
                            </p>
                            <h4 className="text-xl font-bold text-[#141414]">{selectedHistoryDay.workout.title}</h4>
                          </div>
                          <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                            selectedHistoryDay.workout.title === 'Rest' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                          }`}>
                            {selectedHistoryDay.workout.title === 'Rest' ? 'Recovery' : 'Workout'}
                          </div>
                        </div>

                        {selectedHistoryDay.workout.title === 'Rest' ? (
                          <div className="py-8 text-center">
                            <Zap className="text-blue-500 mx-auto mb-4" size={32} />
                            <p className="text-sm text-[#141414]/60 leading-relaxed">
                              {selectedHistoryDay.workout.notes || "Focus on active recovery and mobility."}
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {selectedHistoryDay.workout.exercises.map((ex, eIdx) => (
                              <div key={eIdx} className="bg-white p-4 rounded-2xl border border-[#141414]/5">
                                <div className="flex items-center justify-between mb-2">
                                  <h5 className="font-bold text-[#141414]">{ex.name}</h5>
                                  <span className="text-xs font-bold text-[#141414]/40">{ex.sets} Sets</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  {ex.setWeights?.map((w, sIdx) => (
                                    <div key={sIdx} className="flex items-center justify-between px-3 py-2 bg-[#141414]/5 rounded-lg">
                                      <span className="text-[10px] font-bold text-[#141414]/30">Set {sIdx + 1}</span>
                                      <span className="text-xs font-bold text-[#141414]">{w}lb × {ex.setReps?.[sIdx] || 0}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center p-8">
                        <div className="w-16 h-16 bg-[#141414]/5 rounded-2xl flex items-center justify-center mb-4">
                          <Calendar className="text-[#141414]/20" size={32} />
                        </div>
                        <h4 className="font-bold text-[#141414] mb-2">Select a Day</h4>
                        <p className="text-sm text-[#141414]/40">Click on a highlighted day in the calendar to view your workout details.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
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
