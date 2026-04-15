import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, updateDoc, writeBatch, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkoutPlan, VitalLog, WorkoutDay } from '../types';
import { generateWorkoutPlan, calculateDailyTargets } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek, parseISO, addDays } from 'date-fns';
import { Dumbbell, Sparkles, CheckCircle2, Info, Timer, Zap, ChevronRight, Calendar, X, Flame, Target, TrendingDown, Clock, Check, Edit2, ChevronLeft } from 'lucide-react';

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

    return () => {
      unsubscribeVitals();
      unsubscribePlans();
    };
  }, [profile.uid, activePlanId]);

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

  const toggleSetCompletion = async (exerciseIdx: number, setIdx: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const updatedExercises = [...updatedDays[selectedDay].exercises];
    const exercise = { ...updatedExercises[exerciseIdx] };
    
    const completed = exercise.completedSets ? [...exercise.completedSets] : Array(exercise.sets).fill(false);
    const wasCompleted = completed[setIdx];
    completed[setIdx] = !completed[setIdx];
    exercise.completedSets = completed;

    // Progressive Overload Logic
    // Only apply if the set is being marked as completed (not unchecked)
    if (!wasCompleted) {
      const actualReps = exercise.setReps?.[setIdx] || 0;
      const actualWeight = exercise.setWeights?.[setIdx] || 0;
      
      // Parse target reps range (e.g., "8-10")
      const repsRange = exercise.reps.split('-').map(r => parseInt(r.trim()));
      const targetReps = repsRange.length > 1 ? repsRange[1] : (parseInt(exercise.reps) || 0);
      const lowerBound = repsRange[0] || 0;

      // Check for hit (+2 over target)
      if (actualReps >= targetReps + 2) {
        exercise.consecutiveHits = (exercise.consecutiveHits || 0) + 1;
        exercise.consecutiveDrops = 0;
      } 
      // Check for significant drop (2+ below lower bound)
      else if (actualReps <= lowerBound - 2 && actualReps > 0) {
        exercise.consecutiveDrops = (exercise.consecutiveDrops || 0) + 1;
        exercise.consecutiveHits = 0;
      } else {
        // Performance was within range, reset counters? 
        // Logic says "consecutive workouts", so maybe only reset if they don't hit the trigger.
        // Let's keep counters if they are within range but not hitting the trigger.
      }

      // Apply triggers
      if (exercise.consecutiveHits >= 2) {
        const currentWeight = exercise.prescribedWeight || actualWeight;
        exercise.prescribedWeight = currentWeight + 5; // Increase by 5 lbs
        exercise.consecutiveHits = 0;
        console.log(`Progressive Overload: Increasing weight for ${exercise.name} to ${exercise.prescribedWeight}`);
      } else if (exercise.consecutiveDrops >= 2) {
        const currentWeight = exercise.prescribedWeight || actualWeight;
        exercise.prescribedWeight = Math.round(currentWeight * 0.9); // 10% reduction
        exercise.consecutiveDrops = 0;
        console.log(`Progressive Overload: Reducing weight for ${exercise.name} to ${exercise.prescribedWeight}`);
      }
    }
    
    updatedExercises[exerciseIdx] = exercise;

    // Update future occurrences of this exercise in the current plan
    updatedDays.forEach((day, dIdx) => {
      day.exercises.forEach((ex, eIdx) => {
        if (ex.name === exercise.name && (dIdx > selectedDay)) {
          updatedDays[dIdx].exercises[eIdx] = {
            ...ex,
            prescribedWeight: exercise.prescribedWeight,
            consecutiveHits: exercise.consecutiveHits,
            consecutiveDrops: exercise.consecutiveDrops
          };
        }
      });
    });

    updatedDays[selectedDay].exercises = updatedExercises;

    try {
      const planRef = doc(db, 'users', profile.uid, 'workouts', activePlanId);
      await updateDoc(planRef, { 
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to toggle set completion:", err);
      setError("Failed to save data. Please try again.");
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
      <div className="bg-[#141414] p-8 rounded-[2.5rem] shadow-2xl text-white relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl transition-all group-hover:bg-white/10" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
              <Target className="text-white" size={20} />
            </div>
            <h2 className="text-xl font-bold">Training Target</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
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

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest px-2 mb-4 mt-8">Select Day</h3>
                {activePlan?.days.map((day, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(idx)}
                    className={`w-full p-4 flex items-center justify-between rounded-2xl transition-all ${
                      selectedDay === idx 
                        ? 'bg-white shadow-md border border-[#141414]/5 text-[#141414]' 
                        : 'text-[#141414]/40 hover:bg-white/50'
                    }`}
                  >
                    <span className="font-bold">{day.day}</span>
                    <ChevronRight size={16} className={selectedDay === idx ? 'opacity-100' : 'opacity-0'} />
                  </button>
                ))}
                
                <button
                  onClick={() => setIsHistoryOpen(true)}
                  className="w-full p-4 flex items-center justify-between rounded-2xl transition-all text-[#141414]/40 hover:bg-white/50 mt-4 border border-dashed border-[#141414]/10"
                >
                  <span className="font-bold text-sm">View History</span>
                  <Calendar size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Day Content */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-[#141414]">{activePlan?.days[selectedDay]?.title}</h3>
                  <p className="text-sm text-[#141414]/40 font-medium">{activePlan?.days[selectedDay]?.day} Session</p>
                </div>
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
                            className={`flex flex-col gap-4 p-6 rounded-2xl transition-all cursor-pointer ${
                              expandedExercise === idx ? 'bg-[#141414]/5 ring-1 ring-[#141414]/10' : 'hover:bg-[#141414]/5'
                            }`}
                          >
                            <div className="flex items-start gap-4">
                              <div className="w-12 h-12 bg-[#141414] rounded-xl flex items-center justify-center shrink-0 text-white font-bold">
                                {idx + 1}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                  <h4 className="text-xl font-bold text-[#141414]">{ex.name}</h4>
                                  {ex.prescribedWeight && (
                                    <div className="text-right">
                                      <p className="text-xl font-bold text-[#141414]">{ex.prescribedWeight} lbs</p>
                                      <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Target Weight</p>
                                    </div>
                                  )}
                                </div>
                                <p className="text-sm text-[#141414]/60 leading-relaxed">{ex.notes}</p>
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
                                    <div className="space-y-3">
                                      {Array.from({ length: ex.sets }).map((_, sIdx) => (
                                        <div key={sIdx} className="flex items-center gap-4 p-3 bg-white rounded-xl border border-[#141414]/5">
                                          <div className="w-8 h-8 bg-[#141414]/5 rounded-lg flex items-center justify-center shrink-0">
                                            <span className="text-xs font-bold text-[#141414]/40">{sIdx + 1}</span>
                                          </div>
                                          
                                          <div className="flex-1 flex items-center gap-3">
                                            <div className="flex-1 grid grid-cols-2 gap-4">
                                              <div className="relative">
                                                <input
                                                  type="number"
                                                  disabled={ex.completedSets?.[sIdx]}
                                                  value={ex.setReps?.[sIdx] || ''}
                                                  onChange={(e) => updateSetData(idx, sIdx, 'reps', parseInt(e.target.value) || 0)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  placeholder="0"
                                                  className={`w-full pl-3 pr-10 py-2 rounded-lg text-sm font-bold transition-all ${
                                                    ex.completedSets?.[sIdx] 
                                                      ? 'bg-green-50 text-green-700 border-green-100' 
                                                      : 'bg-[#141414]/5 border-transparent focus:bg-white focus:ring-2 focus:ring-[#141414]/10'
                                                  }`}
                                                />
                                                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase ${
                                                  ex.completedSets?.[sIdx] ? 'text-green-300' : 'text-[#141414]/20'
                                                }`}>reps</span>
                                              </div>

                                              <div className="relative">
                                                <input
                                                  type="number"
                                                  disabled={ex.completedSets?.[sIdx]}
                                                  value={ex.setWeights?.[sIdx] || ''}
                                                  onChange={(e) => updateSetData(idx, sIdx, 'weight', parseFloat(e.target.value) || 0)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  placeholder="0"
                                                  className={`w-full pl-3 pr-10 py-2 rounded-lg text-sm font-bold transition-all ${
                                                    ex.completedSets?.[sIdx] 
                                                      ? 'bg-green-50 text-green-700 border-green-100' 
                                                      : 'bg-[#141414]/5 border-transparent focus:bg-white focus:ring-2 focus:ring-[#141414]/10'
                                                  }`}
                                                />
                                                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase ${
                                                  ex.completedSets?.[sIdx] ? 'text-green-300' : 'text-[#141414]/20'
                                                }`}>lbs</span>
                                              </div>
                                            </div>

                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleSetCompletion(idx, sIdx);
                                              }}
                                              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                                                ex.completedSets?.[sIdx]
                                                  ? 'bg-green-500 text-white shadow-lg shadow-green-200'
                                                  : 'bg-[#141414]/5 text-[#141414]/40 hover:bg-[#141414]/10 hover:text-[#141414]'
                                              }`}
                                            >
                                              {ex.completedSets?.[sIdx] ? <Edit2 size={16} /> : <Check size={18} />}
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      ))
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
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-10 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/90 transition-all flex items-center gap-3 mx-auto disabled:opacity-50 shadow-xl shadow-[#141414]/20"
          >
            {isGenerating ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Sparkles size={20} /></motion.div>
            ) : <Sparkles size={20} />}
            Generate Weekly Plan
          </button>
        </div>
      )}

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
        {icon && <div className="shrink-0">{icon}</div>}
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{label}</p>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subValue && <p className="text-[10px] font-medium text-white/40">{subValue}</p>}
    </div>
  );
}
