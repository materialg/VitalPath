import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, updateDoc, getDocs, where, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, MealPlan, VitalLog, FoodBankItem } from '../types';
import { generateMealPlan, calculateDailyTargets, logDailyTarget, generateAndSaveMealPlan, regenerateDayPlan, isAIConfigured } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { Utensils, Sparkles, RotateCcw, ChevronRight, ChefHat, Flame, Info, Target, TrendingDown, History, Calendar, X, Check, CheckCircle2, Pencil, Trash2, Plus, Search, Loader2, Zap } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

export function MealPlanner({ profile }: Props) {
  const cleanName = (name: string) => name?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';

  const findFoodItem = (name: string) => {
    const cleaned = cleanName(name);
    if (!cleaned) return null;
    return foodBankItems.sort((a, b) => (b.hidden ? -1 : 1)).find(f => cleanName(f.name) === cleaned);
  };

  const [mealPlans, setMealPlans] = useState<MealPlan[]>([]);
  const [dailyTargets, setDailyTargets] = useState<any[]>([]);
  const [latestVital, setLatestVital] = useState<VitalLog | null>(null);
  const [foodBankItems, setFoodBankItems] = useState<FoodBankItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const MEAL_PLAN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const todayIdx = (new Date().getDay() + 6) % 7;
  const [selectedDay, setSelectedDay] = useState(todayIdx);
  const [activePlanId, setActivePlanId] = useState<string | null>(profile.activeMealPlanId || null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.activeMealPlanId && !activePlanId) {
      setActivePlanId(profile.activeMealPlanId);
    }
  }, [profile.activeMealPlanId]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<{ mIdx: number, meal: any } | null>(null);

  const targets = calculateDailyTargets(profile, latestVital?.weight || 180, latestVital?.bodyFat || 20);

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
      collection(db, 'users', profile.uid, 'mealPlans'),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );
    const unsubscribePlans = onSnapshot(qPlans, (snap) => {
      const plans = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MealPlan));
      setMealPlans(plans);
      
      if (plans.length > 0) {
        if (!activePlanId || !plans.some(p => p.id === activePlanId)) {
          setActivePlanId(profile.activeMealPlanId || plans[0].id);
        }
      }
    });

    const qTargets = query(
      collection(db, 'users', profile.uid, 'dailyTargets'),
      orderBy('date', 'desc'),
      limit(30)
    );
    const unsubscribeTargets = onSnapshot(qTargets, (snap) => {
      setDailyTargets(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const qFoodBank = query(collection(db, 'users', profile.uid, 'foodBank'));
    const unsubscribeFoodBank = onSnapshot(qFoodBank, (snap) => {
      setFoodBankItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FoodBankItem)));
    });

    return () => {
      unsubscribeVitals();
      unsubscribePlans();
      unsubscribeTargets();
      unsubscribeFoodBank();
    };
  }, [profile.uid]);

  const handlePlanSelect = async (id: string) => {
    setActivePlanId(id);
    setIsHistoryOpen(false);
    // Persist selection to profile
    await updateDoc(doc(db, 'users', profile.uid), {
      activeMealPlanId: id
    });
  };

  const activePlan = mealPlans.find(p => p.id === activePlanId) || mealPlans[0];

  const handleUpdateMeal = async (mIdx: number, updatedMeal: any) => {
    if (!activePlan || !activePlanId) return;

    setEditingMeal(null);
    const updatedDays = [...activePlan.days];
    updatedDays[selectedDay].meals[mIdx] = updatedMeal;

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to update meal:", err);
      setError("Failed to save meal changes. Please try again.");
    }
  };

  const handleRebalanceDay = async () => {
    if (!activePlan || !activePlanId) return;

    setIsRecalculating(true);
    setError(null);

    const updatedDays = [...activePlan.days];
    const currentDayMeals = updatedDays[selectedDay].meals;
    
    try {
      const newDayMeals = await regenerateDayPlan(
        profile,
        latestVital?.weight || 180,
        latestVital?.bodyFat || 20,
        foodBankItems,
        currentDayMeals
      );

      updatedDays[selectedDay].meals = newDayMeals;

      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to rebalance day:", err);
      setError("AI was unable to rebalance the day. Try adjusting your items manually or generating a new week.");
    } finally {
      setIsRecalculating(false);
    }
  };

  const toggleMealStatus = async (mIdx: number) => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    const meals = [...updatedDays[selectedDay].meals];
    const currentStatus = meals[mIdx].status;
    meals[mIdx] = { 
      ...meals[mIdx], 
      status: currentStatus === 'completed' ? 'none' : 'completed' 
    };
    updatedDays[selectedDay].meals = meals;

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to toggle meal status:", err);
    }
  };

  const confirmAllDayMeals = async () => {
    if (!activePlan || !activePlanId) return;

    const updatedDays = [...activePlan.days];
    updatedDays[selectedDay].meals = updatedDays[selectedDay].meals.map(m => ({ ...m, status: 'completed' }));

    try {
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', activePlanId), {
        days: updatedDays,
        updatedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error("Failed to confirm all meals:", err);
    }
  };

  const handleGenerate = async () => {
    if (foodBankItems.length === 0) {
      setError("Your Food Bank is empty. Please add some foods first so the AI can build your plan!");
      return;
    }
    setIsGenerating(true);
    setError(null);
    console.log("Generating meal plan...");
    try {
      const planId = await generateAndSaveMealPlan(
        profile, 
        latestVital?.weight || 180, 
        latestVital?.bodyFat || 20, 
        foodBankItems
      );
      console.log("Meal plan generated successfully:", planId);
      setActivePlanId(planId);
    } catch (err: any) {
      console.error("Meal generation failed:", err);
      setError(err.message || "Failed to generate meal plan. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold text-[#141414] tracking-tight">Meal Planner</h1>
          <p className="text-[#141414]/60">AI-generated nutrition tailored to your body fat goals.</p>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Info size={20} />
            <p className="font-medium">{error}</p>
          </div>
          <div className="flex items-center gap-3">
            {error.includes("timed out") && (
              <button 
                onClick={handleGenerate}
                className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors"
              >
                Retry Generation
              </button>
            )}
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold p-2">✕</button>
          </div>
        </div>
      )}

      {/* Daily Target - Always Visible */}
      <div className="bg-[#141414] text-white p-8 rounded-3xl shadow-xl overflow-hidden relative">
        <div className="relative z-10">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Target size={20} className="text-orange-500" />
            Daily Target
          </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 lg:gap-6">
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Deficit</p>
              <p className="text-xl font-black text-orange-500">-{targets.dailyDeficit} <span className="text-xs font-normal opacity-40">kcal</span></p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Target</p>
              <p className="text-xl font-black text-green-400">{targets.dailyCalories} <span className="text-xs font-normal opacity-40">kcal</span></p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Protein</p>
              <p className="text-xl font-black text-blue-400">{targets.macros.protein}g</p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Carbs</p>
              <p className="text-xl font-black text-yellow-400">{targets.macros.carbs}g</p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Fats</p>
              <p className="text-xl font-black text-purple-400">{targets.macros.fats}g</p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Fiber</p>
              <p className="text-xl font-black text-emerald-400">{targets.macros.fiber}g</p>
            </div>
            <div>
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-1">Days Left</p>
              <p className="text-xl font-black">{targets.daysLeft}</p>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-white/10 flex items-center gap-4 text-sm text-white/60">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span>Target Weight: {targets.targetWeight} lbs</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span>Rate: {Math.round((targets.dailyDeficit * 7 / 3500) * 10) / 10} lbs/week</span>
            </div>
          </div>
        </div>
      </div>

      {mealPlans.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Day Selector */}
          <div className="lg:col-span-1 space-y-8">
            <div className="space-y-4">
              <div className="flex flex-col gap-4">
                <h3 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest px-2 mt-4 lg:mt-8">Select Day</h3>
                <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-4 lg:pb-0 no-scrollbar -mx-2 px-2 scroll-smooth">
                  {activePlan?.days.map((day, idx) => {
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedDay(idx)}
                        className={`shrink-0 lg:w-full p-4 flex items-center justify-between rounded-2xl transition-all ${
                          selectedDay === idx 
                            ? 'bg-white shadow-md border border-[#141414]/5 text-[#141414]' 
                            : 'text-[#141414]/40 hover:bg-white/50'
                        }`}
                      >
                        <span className="font-bold whitespace-nowrap lg:whitespace-normal">{MEAL_PLAN_DAYS[idx] || day.day}</span>
                        <ChevronRight size={16} className={`hidden lg:block ${selectedDay === idx ? 'opacity-100' : 'opacity-0'}`} />
                      </button>
                    );
                  })}
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
            <div className="bg-white p-6 lg:p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
              <div className="flex flex-wrap gap-4 lg:gap-8 mb-8">
                {(() => {
                  const dayMeals = activePlan?.days?.[selectedDay]?.meals || [];
                  const totals = dayMeals.reduce((acc: any, meal: any) => ({
                    calories: acc.calories + (meal.calories || 0),
                    protein: acc.protein + (meal.protein || 0),
                    carbs: acc.carbs + (meal.carbs || 0),
                    fats: acc.fats + (meal.fats || 0),
                    fiber: acc.fiber + (meal.fiber || 0),
                  }), { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 });

                  return (
                    <div className="flex items-center justify-between w-full mb-12">
                      {/* fire icon */}
                      <div className="w-12 h-12 rounded-xl bg-[#141414]/5 flex items-center justify-center shrink-0">
                        <Flame size={24} className="text-orange-500" />
                      </div>

                      {/* centers macro summary */}
                      <div className="flex-1 flex justify-around items-start px-2 lg:px-6">
                        {[
                          { label: 'Daily Calories', value: `${Math.round(totals.calories)} kcal` },
                          { label: 'Protein', value: `${Math.round(totals.protein)}g` },
                          { label: 'Carbs', value: `${Math.round(totals.carbs)}g` },
                          { label: 'Fats', value: `${Math.round(totals.fats)}g` },
                          { label: 'Fiber', value: `${Math.round(totals.fiber)}g` }
                        ].map((stat, i) => (
                          <div key={i} className="text-center">
                            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">{stat.label}</p>
                            <p className="text-xl lg:text-2xl font-black text-[#141414] whitespace-nowrap">{stat.value}</p>
                          </div>
                        ))}
                      </div>

                      {/* replay icon */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRebalanceDay();
                        }}
                        disabled={isRecalculating}
                        className="w-12 h-12 rounded-xl bg-[#141414]/5 flex items-center justify-center shrink-0 group/regen transition-all hover:bg-[#141414]/10 disabled:opacity-30"
                        title="Regenerate Day"
                      >
                        <RotateCcw 
                          size={24} 
                          className={`transition-all ${isRecalculating ? 'animate-spin text-orange-500' : 'text-[#141414]/20 group-hover/regen:text-orange-500'}`} 
                        />
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-8 relative">
                {isRecalculating && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center rounded-2xl animate-in fade-in duration-300">
                    <div className="p-4 bg-[#141414] text-white rounded-2xl border border-white/10 shadow-2xl flex flex-col items-center gap-3">
                      <Loader2 className="animate-spin text-orange-500" size={32} />
                      <div className="text-center">
                        <p className="font-bold">Recalculating Day Plan</p>
                        <p className="text-[10px] text-white/40 uppercase tracking-widest">Adjusting other meals to stay on target</p>
                      </div>
                    </div>
                  </div>
                )}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${activePlanId}-${selectedDay}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    {activePlan?.days?.[selectedDay]?.meals?.map((meal: any, mIdx: number) => (
                      <div key={mIdx} className="group">
                        <div 
                          onClick={() => toggleMealStatus(mIdx)}
                          className={`flex items-start gap-4 p-6 rounded-2xl transition-all cursor-pointer ${
                            meal.status === 'completed' ? 'bg-green-50/50' : 'hover:bg-[#141414]/5'
                          }`}
                        >
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-bold transition-all ${
                            meal.status === 'completed' ? 'bg-green-500 text-white' : 'bg-[#141414] text-white'
                          }`}>
                            {meal.status === 'completed' ? <Check size={20} /> : mIdx + 1}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-3">
                                <h4 className={`text-xl font-bold ${meal.status === 'completed' ? 'text-[#141414]/40 line-through' : 'text-[#141414]'}`}>
                                  {meal.name}
                                </h4>
                                {meal.status === 'completed' && (
                                  <span className="px-2 py-0.5 bg-green-50 text-green-600 text-[10px] font-bold uppercase rounded-md">Completed</span>
                                )}
                                {meal.status === 'skipped' && (
                                  <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-bold uppercase rounded-md">Skipped</span>
                                )}
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingMeal({ mIdx, meal: JSON.parse(JSON.stringify(meal)) });
                                  }}
                                  className="p-1.5 hover:bg-[#141414]/5 rounded-lg text-[#141414]/40 hover:text-[#141414] transition-colors"
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-[#141414]">{Math.round(meal.calories || 0)} kcal</p>
                                <div className="flex gap-2 text-[10px] font-medium text-[#141414]/40">
                                  <span>P: {Math.round(meal.protein || 0)}g</span>
                                  <span>C: {Math.round(meal.carbs || 0)}g</span>
                                  <span>F: {Math.round(meal.fats || 0)}g</span>
                                  <span>Fib: {Math.round(meal.fiber || 0)}g</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                              {meal.ingredientsWithAmounts ? meal.ingredientsWithAmounts.map((ing: any, iIdx: number) => {
                                const food = findFoodItem(ing.name);
                                const val = parseFloat(ing.amount) || 0;
                                const unit = (food?.servingUnit || 'unit').toLowerCase();
                                return (
                                  <span key={iIdx} className="px-3 py-1 bg-white border border-[#141414]/10 rounded-full text-xs text-[#141414]/60 whitespace-nowrap">
                                    {val} {unit === 'unit' ? (val === 1 ? 'unit' : 'units') : unit} {food?.name || ing.name}
                                  </span>
                                );
                              }) : meal.ingredients.map((ing: any, iIdx: number) => (
                                <span key={iIdx} className="px-3 py-1 bg-white border border-[#141414]/10 rounded-full text-xs text-[#141414]/60 whitespace-nowrap">
                                  {ing}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                </AnimatePresence>

                {activePlan?.days?.[selectedDay]?.meals?.length > 0 && activePlan.days[selectedDay].meals.every(m => m.status === 'completed') && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={confirmAllDayMeals}
                    className="w-full py-4 bg-green-500 text-white rounded-2xl font-bold hover:bg-green-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-500/20"
                  >
                    <CheckCircle2 size={18} />
                    Confirm All Meals Completed
                  </motion.button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="bg-white p-12 rounded-3xl border border-[#141414]/5 shadow-sm text-center">
            <div className="w-20 h-20 bg-[#141414]/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <ChefHat className="text-[#141414]/20" size={40} />
            </div>
            <h3 className="text-2xl font-bold text-[#141414] mb-2">No Weekly Plan Yet</h3>
            <p className="text-[#141414]/60 max-w-md mx-auto mb-8">
              {foodBankItems.length === 0 
                ? "Your Food Bank is empty. Add some foods first so the AI can build your customized meal plan!"
                : "Get a customized 7-day meal schedule tailored to your goals and available food."}
            </p>
            
            {!isAIConfigured() ? (
              <div className="max-w-md mx-auto p-6 bg-orange-50 border border-orange-200 rounded-2xl text-left space-y-3">
                <div className="flex items-center gap-3 text-orange-600">
                  <Sparkles size={20} />
                  <p className="font-bold">AI Features Unconfigured</p>
                </div>
                <p className="text-sm text-orange-800/80">
                  Please add a valid <strong>GEMINI_API_KEY</strong> in the project settings (Settings - Secrets) to enable AI meal generation.
                </p>
              </div>
            ) : (
              <button 
                onClick={handleGenerate}
                disabled={isGenerating}
                className="px-8 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-xl shadow-[#141414]/20 mx-auto"
              >
                {isGenerating ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Sparkles size={18} /></motion.div>
                ) : <Sparkles size={18} />}
                Generate Weekly Plan
              </button>
            )}
          </div>

          {dailyTargets.length > 0 && (
            <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
              <h3 className="text-xl font-bold text-[#141414] mb-6 flex items-center gap-2">
                <History size={20} className="text-[#141414]/40" />
                Daily Target History
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[#141414]/40 text-[10px] uppercase tracking-widest border-b border-[#141414]/5">
                      <th className="px-4 py-4 font-bold">Date</th>
                      <th className="px-4 py-4 font-bold">TDEE</th>
                      <th className="px-4 py-4 font-bold">Deficit</th>
                      <th className="px-4 py-4 font-bold">Target</th>
                      <th className="px-4 py-4 font-bold">Protein</th>
                      <th className="px-4 py-4 font-bold">Carbs</th>
                      <th className="px-4 py-4 font-bold">Fats</th>
                      <th className="px-4 py-4 font-bold">Fiber</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/5">
                    {dailyTargets.map((target) => (
                      <tr key={target.id} className="hover:bg-[#141414]/5 transition-colors">
                        <td className="px-4 py-4 font-bold text-[#141414]">
                          {new Date(target.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}
                        </td>
                        <td className="px-4 py-4 text-[#141414]/60">{target.tdee}</td>
                        <td className="px-4 py-4 text-orange-500">-{target.dailyDeficit}</td>
                        <td className="px-4 py-4 font-bold text-green-600">{target.dailyCalories}</td>
                        <td className="px-4 py-4 text-[#141414]/60">{target.macros.protein}g</td>
                        <td className="px-4 py-4 text-[#141414]/60">{target.macros.carbs}g</td>
                        <td className="px-4 py-4 text-[#141414]/60">{target.macros.fats}g</td>
                        <td className="px-4 py-4 text-[#141414]/60">{target.macros.fiber}g</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History Modal */}
      <AnimatePresence>
        {isHistoryOpen && (
          <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsHistoryOpen(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg p-8 rounded-3xl shadow-2xl border border-[#141414]/5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-[#141414]">Plan History</h3>
                <button onClick={() => setIsHistoryOpen(false)} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {mealPlans
                  .filter((plan, index, self) => 
                    index === self.findIndex((p) => p.weekStartDate === plan.weekStartDate)
                  )
                  .map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => handlePlanSelect(plan.id)}
                    className={`w-full p-6 text-left rounded-2xl transition-all border ${
                      activePlanId === plan.id 
                        ? 'bg-[#141414] text-white border-transparent shadow-lg' 
                        : 'bg-white text-[#141414]/60 border-[#141414]/5 hover:border-[#141414]/20'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-lg">
                        {new Date(plan.weekStartDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${activePlanId === plan.id ? 'bg-white/10 text-white' : 'bg-[#141414]/5 text-[#141414]'}`}>
                        {plan.dailyCalories} kcal
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs font-medium opacity-60">
                      <span>Protein: {plan.macros.protein}g</span>
                      <span>Carbs: {plan.macros.carbs}g</span>
                      <span>Fats: {plan.macros.fats}g</span>
                      <span>Fiber: {plan.macros.fiber}g</span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Meal Modal */}
      <AnimatePresence>
        {editingMeal && (
          <EditMealModal 
            meal={editingMeal.meal}
            foodBank={foodBankItems}
            onClose={() => setEditingMeal(null)}
            onSave={(updatedMeal) => handleUpdateMeal(editingMeal.mIdx, updatedMeal)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function EditMealModal({ meal, foodBank, onClose, onSave }: { meal: any, foodBank: FoodBankItem[], onClose: () => void, onSave: (updatedMeal: any) => void }) {
  const [currentMeal, setCurrentMeal] = useState(meal);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFoodBank, setShowFoodBank] = useState(false);

  const filteredFoodBank = foodBank.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const cleanName = (name: string) => name?.toLowerCase().replace(/[^a-z0-9]/g, '').trim() || '';

  const findFoodItem = (name: string) => {
    const cleaned = cleanName(name);
    if (!cleaned) return null;
    // Prioritize non-hidden items
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
      fiber: Math.round(fiber * 10) / 10,
    };
  };

  useEffect(() => {
    // Auto-sync with Food Bank on mount to catch unit/name discrepancies
    const syncedIngredients = currentMeal.ingredientsWithAmounts.map((ing: any) => {
      const food = findFoodItem(ing.name);
      if (food) {
        const val = parseFloat(ing.amount) || 0;
        const fbUnit = (food.servingUnit || 'unit').toLowerCase();
        // Force the unit from the food bank over whatever is currently in the meal amount string
        return {
          ...ing,
          name: food.name, // Sync casing/name
          amount: `${val} ${fbUnit === 'unit' ? (val === 1 ? 'unit' : 'units') : fbUnit}`
        };
      }
      return ing;
    });

    const hasChanged = JSON.stringify(syncedIngredients) !== JSON.stringify(currentMeal.ingredientsWithAmounts);
    if (hasChanged) {
      const totals = calculateTotals(syncedIngredients);
      setCurrentMeal({
        ...currentMeal,
        ingredientsWithAmounts: syncedIngredients,
        ingredients: syncedIngredients.map((i: any) => `${i.amount} ${i.name}`),
        ...totals
      });
    }
  }, []);

  const updateIngredientAmount = (idx: number, newAmount: string) => {
    const newIngredients = [...currentMeal.ingredientsWithAmounts];
    const ing = newIngredients[idx];
    const food = findFoodItem(ing.name);
    const val = parseFloat(newAmount) || 0;
    const unit = (food?.servingUnit || 'unit').toLowerCase();
    
    newIngredients[idx].amount = `${val} ${unit === 'unit' ? (val === 1 ? 'unit' : 'units') : unit}`;
    newIngredients[idx].name = food?.name || ing.name; // Sync casing
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
    const finalIngredients = currentMeal.ingredientsWithAmounts.map((ing: any) => {
      const food = findFoodItem(ing.name);
      if (food) {
        const amountNum = parseFloat(ing.amount) || 0;
        const unit = food.servingUnit || 'unit';
        return { 
          name: food.name, 
          amount: `${amountNum} ${unit === 'unit' ? (amountNum === 1 ? 'unit' : 'units') : unit}` 
        };
      }
      return ing;
    });

    onSave({
      ...currentMeal,
      ingredientsWithAmounts: finalIngredients,
      ingredients: finalIngredients.map((i: any) => `${i.amount} ${i.name}`)
    });
  };

  const addIngredient = (food: FoodBankItem) => {
    let unit = (food.servingUnit || 'unit').toLowerCase();
    if (unit === 'units') unit = 'unit';
    const newIngredients = [
      ...currentMeal.ingredientsWithAmounts,
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
    <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white w-full max-w-2xl p-8 rounded-3xl shadow-2xl border border-[#141414]/5 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-[#141414]">Edit {currentMeal.name}</h3>
            <p className="text-sm text-[#141414]/40">Customize ingredients and portions.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8 p-4 bg-[#141414]/5 rounded-2xl">
          <div className="text-center">
            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Calories</p>
            <p className="text-lg font-bold text-[#141414]">{currentMeal.calories}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Protein</p>
            <p className="text-lg font-bold text-[#141414]">{currentMeal.protein}g</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Carbs</p>
            <p className="text-lg font-bold text-[#141414]">{currentMeal.carbs}g</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Fats</p>
            <p className="text-lg font-bold text-[#141414]">{currentMeal.fats}g</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Fiber</p>
            <p className="text-lg font-bold text-[#141414]">{currentMeal.fiber}g</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 mb-6 pr-2 custom-scrollbar">
          {currentMeal.ingredientsWithAmounts.map((ing: any, idx: number) => {
            const food = findFoodItem(ing.name);
            const unit = (food?.servingUnit || 'unit').toLowerCase();
            return (
              <div key={idx} className="flex items-center gap-4 p-4 bg-white border border-[#141414]/5 rounded-2xl group">
                <div className="flex-1">
                  <p className="font-bold text-[#141414]">{food?.name || ing.name}</p>
                  <p className="text-xs text-[#141414]/40">
                    {food ? `${food.calories} cal / ${food.servingSize} ${unit === 'unit' ? (food.servingSize === 1 ? 'unit' : 'units') : unit}` : 'Custom item'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-[#141414]/5 rounded-xl p-1 gap-1">
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const val = parseFloat(ing.amount) || 0;
                        updateIngredientAmount(idx, `${Math.max(0, val - 1)}`);
                      }}
                      className="w-10 h-10 flex items-center justify-center hover:bg-[#141414]/10 rounded-lg text-[#141414]/40 hover:text-[#141414] transition-colors"
                    >
                      -
                    </button>
                    
                    <div className="flex items-center justify-center gap-1 px-2 w-24">
                      <input 
                        type="number"
                        value={parseFloat(ing.amount) || 0}
                        step="1"
                        onChange={(e) => {
                          updateIngredientAmount(idx, e.target.value);
                        }}
                        className="w-8 bg-transparent border-none text-sm font-bold text-right focus:ring-0 p-0 appearance-none"
                      />
                      <span className="text-[10px] font-bold text-[#141414]/40 uppercase flex-1 text-left ml-1">
                        {unit === 'unit' ? (parseFloat(ing.amount) === 1 ? 'unit' : 'units') : unit}
                      </span>
                    </div>

                    <button 
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const val = parseFloat(ing.amount) || 0;
                        updateIngredientAmount(idx, `${val + 1}`);
                      }}
                      className="w-10 h-10 flex items-center justify-center hover:bg-[#141414]/10 rounded-lg text-[#141414]/40 hover:text-[#141414] transition-colors"
                    >
                      +
                    </button>
                  </div>
                  <button 
                    onClick={() => removeIngredient(idx)}
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={18} />
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
              className="w-full py-4 border-2 border-dashed border-[#141414]/10 rounded-2xl flex items-center justify-center gap-2 text-[#141414]/40 hover:text-[#141414] hover:border-[#141414]/20 transition-all"
            >
              <Plus size={18} />
              <span className="font-bold">Add Item from Food Bank</span>
            </button>
          )}
        </div>

        <div className="flex gap-4">
          <button 
            onClick={onClose}
            className="flex-1 py-4 bg-[#141414]/5 text-[#141414] rounded-2xl font-bold hover:bg-[#141414]/10 transition-all"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="flex-1 py-4 bg-[#141414] text-white rounded-2xl font-bold hover:bg-[#141414]/90 transition-all shadow-lg shadow-[#141414]/10"
          >
            Save Changes
          </button>
        </div>
      </motion.div>
    </div>
  );
}


