import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, MealPlan, VitalLog, FoodBankItem } from '../types';
import { generateMealPlan, calculateDailyTargets, logDailyTarget } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { Utensils, Sparkles, ChevronRight, ChefHat, Flame, Info, Target, TrendingDown, History, Calendar, X } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

export function MealPlanner({ profile }: Props) {
  const [mealPlans, setMealPlans] = useState<MealPlan[]>([]);
  const [dailyTargets, setDailyTargets] = useState<any[]>([]);
  const [latestVital, setLatestVital] = useState<VitalLog | null>(null);
  const [foodBankItems, setFoodBankItems] = useState<FoodBankItem[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const targets = calculateDailyTargets(profile, latestVital?.weight || 180, latestVital?.bodyFat || 20);

  useEffect(() => {
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
      orderBy('weekStartDate', 'desc'),
      limit(10)
    );
    const unsubscribePlans = onSnapshot(qPlans, (snap) => {
      const plans = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MealPlan));
      setMealPlans(plans);
      if (plans.length > 0 && !activePlanId) {
        setActivePlanId(plans[0].id);
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
  }, [profile.uid, activePlanId]);

  const activePlan = mealPlans.find(p => p.id === activePlanId) || null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const plan = await generateMealPlan(profile, latestVital?.weight || 180, latestVital?.bodyFat || 20, foodBankItems);
      const newPlan = {
        ...plan,
        weekStartDate: new Date().toLocaleDateString('en-CA'),
      };
      
      // Save to Firestore
      const docRef = await addDoc(collection(db, 'users', profile.uid, 'mealPlans'), newPlan);
      
      // Also generate grocery list
      const items: any[] = [];
      plan.days.forEach((day: any) => {
        day.meals.forEach((meal: any) => {
          meal.ingredients.forEach((ing: string) => {
            if (!items.find(i => i.name === ing)) {
              items.push({ name: ing, category: 'General', amount: 'As needed', checked: false });
            }
          });
        });
      });

      await addDoc(collection(db, 'users', profile.uid, 'groceryLists'), {
        weekStartDate: new Date().toLocaleDateString('en-CA'),
        items,
      });

    } catch (err: any) {
      console.error(err);
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
        <div className="flex items-center gap-3">
          <button 
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-6 py-3 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isGenerating ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Sparkles size={18} /></motion.div>
            ) : <Sparkles size={18} />}
            {activePlan ? 'Regenerate Plan' : 'Generate Weekly Plan'}
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Info size={20} />
            <p className="font-medium">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 font-bold">✕</button>
        </div>
      )}

      {/* Daily Target - Always Visible */}
      <div className="bg-[#141414] text-white p-8 rounded-3xl shadow-xl overflow-hidden relative">
        <div className="relative z-10">
          <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Target size={20} className="text-orange-500" />
            Daily Target
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-6">
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
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest px-2 mb-4">Select Day</h3>
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
                <span className="font-bold">View History</span>
                <Calendar size={18} />
              </button>
            </div>
          </div>

          {/* Day Content */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
              <div className="flex flex-wrap gap-8 mb-8">
                <MacroStat label="Daily Calories" value={`${activePlan?.dailyCalories || 0} kcal`} icon={<Flame className="text-orange-500" />} />
                <MacroStat label="Protein" value={`${activePlan?.macros?.protein || 0}g`} />
                <MacroStat label="Carbs" value={`${activePlan?.macros?.carbs || 0}g`} />
                <MacroStat label="Fats" value={`${activePlan?.macros?.fats || 0}g`} />
                <MacroStat label="Fiber" value={`${activePlan?.macros?.fiber || 0}g`} />
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
                    {activePlan?.days?.[selectedDay]?.meals?.map((meal: any, mIdx: number) => (
                      <div key={mIdx} className="group">
                        <div className="flex items-start gap-4 p-6 rounded-2xl hover:bg-[#141414]/5 transition-all">
                          <div className="w-12 h-12 bg-[#141414] rounded-xl flex items-center justify-center shrink-0 text-white font-bold">
                            {mIdx + 1}
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
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-bold text-[#141414]">{meal.calories || 0} kcal</p>
                                <div className="flex gap-2 text-[10px] font-medium text-[#141414]/40">
                                  <span>P: {meal.protein || 0}g</span>
                                  <span>C: {meal.carbs || 0}g</span>
                                  <span>F: {meal.fats || 0}g</span>
                                  <span>Fib: {meal.fiber || 0}g</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {meal.ingredients.map((ing, iIdx) => (
                                <span key={iIdx} className="px-3 py-1 bg-white border border-[#141414]/10 rounded-full text-xs text-[#141414]/60">
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
              Click "Generate Weekly Plan" to get a customized 7-day meal schedule.
            </p>
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
                {mealPlans.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => {
                      setActivePlanId(plan.id);
                      setIsHistoryOpen(false);
                    }}
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
    </div>
  );
}

function MacroStat({ label, value, icon }: { label: string, value: string, icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon && <div className="w-8 h-8 rounded-lg bg-[#141414]/5 flex items-center justify-center">{icon}</div>}
      <div>
        <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">{label}</p>
        <p className="text-lg font-bold text-[#141414]">{value}</p>
      </div>
    </div>
  );
}
