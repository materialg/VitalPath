import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, addDoc, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, VitalLog, MealPlan, WorkoutPlan, Meal } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { TrendingDown, Target, Flame, Dumbbell, Utensils, Calendar, Check, X, Pencil, ListTodo, Scale, Quote, Plus, Activity, ChefHat, Timer, Zap, CheckCircle2, History } from 'lucide-react';
import { logDailyTarget, calculateTargetDate, calculateDailyTargets } from '../services/aiService';

interface Props {
  profile: UserProfile;
  onNavigate: (tab: string) => void;
}

export function Dashboard({ profile, onNavigate }: Props) {
  const [vitals, setVitals] = useState<VitalLog[]>([]);
  const [latestMealPlan, setLatestMealPlan] = useState<MealPlan | null>(null);
  const [latestWorkout, setLatestWorkout] = useState<WorkoutPlan | null>(null);
  const [quote, setQuote] = useState({ text: "", author: "" });
  const [showVitalsModal, setShowVitalsModal] = useState(false);
  const [showMealModal, setShowMealModal] = useState(false);
  const [showWorkoutModal, setShowWorkoutModal] = useState(false);

  const quotes = [
    { text: "Discipline equals freedom.", author: "Jocko Willink" },
    { text: "The only person you should try to be better than is the person you were yesterday.", author: "Matty Mullins" },
    { text: "Pain is temporary. Pride is forever.", author: "Unknown" },
    { text: "Don't stop when you're tired. Stop when you're finished.", author: "David Goggins" },
    { text: "Your body is a reflection of your lifestyle.", author: "Unknown" },
    { text: "Weakness is a choice. Strength is a responsibility.", author: "Unknown" },
    { text: "The world doesn't care about your excuses. It cares about your results.", author: "Unknown" },
    { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
    { text: "Success is not owned, it's leased. And rent is due every day.", author: "J.J. Watt" },
    { text: "Be the man you would want your son to be.", author: "Unknown" }
  ];

  useEffect(() => {
    setQuote(quotes[Math.floor(Math.random() * quotes.length)]);
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

    const workoutQuery = profile.activeWorkoutId
      ? query(collection(db, 'users', profile.uid, 'workouts'), where('__name__', '==', profile.activeWorkoutId))
      : query(collection(db, 'users', profile.uid, 'workouts'), orderBy('updatedAt', 'desc'), limit(1));

    const unsubscribeWorkouts = onSnapshot(workoutQuery, (snap) => {
      if (!snap.empty) {
        setLatestWorkout({ id: snap.docs[0].id, ...snap.docs[0].data() } as WorkoutPlan);
      } else if (profile.activeWorkoutId) {
        // Fallback if active plan not found
        const fallbackQuery = query(collection(db, 'users', profile.uid, 'workouts'), orderBy('updatedAt', 'desc'), limit(1));
        getDocs(fallbackQuery).then(s => {
          if (!s.empty) setLatestWorkout({ id: s.docs[0].id, ...s.docs[0].data() } as WorkoutPlan);
        });
      }
    });

    return () => {
      unsubscribeVitals();
      unsubscribeMeals();
      unsubscribeWorkouts();
    };
  }, [profile.uid]);

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

  const today = new Date().toLocaleDateString('en-CA');
  const vitalsLoggedToday = vitals.some(v => v.date.startsWith(today));

  const bfProgress = profile.goalBodyFat && currentBF ? Math.min(100, Math.round((profile.goalBodyFat / currentBF) * 100)) : 0;

  const handleVitalsAction = (action: 'approve' | 'deny' | 'edit') => {
    if (action === 'edit' || (action === 'approve' && vitalsLoggedToday)) {
      onNavigate('vitals');
      return;
    }
    if (action === 'approve') {
      setShowVitalsModal(true);
    }
  };

  const handleMealAction = async (action: 'approve' | 'deny' | 'edit') => {
    if (action === 'edit') {
      setShowMealModal(true);
      return;
    }
    if (!latestMealPlan || !todayMealPlan) return;
    
    const status = action === 'approve' ? 'completed' : 'skipped';
    const updatedDays = [...latestMealPlan.days];
    const dayIndex = updatedDays.findIndex(d => d.day === todayMealPlan.day);
    
    if (dayIndex !== -1) {
      updatedDays[dayIndex].meals = updatedDays[dayIndex].meals.map(m => ({ ...m, status }));
      await updateDoc(doc(db, 'users', profile.uid, 'mealPlans', latestMealPlan.id), {
        days: updatedDays
      });
    }
  };

  const handleWorkoutAction = async (action: 'approve' | 'deny' | 'edit') => {
    if (action === 'edit') {
      setShowWorkoutModal(true);
      return;
    }
    if (!latestWorkout) return;
    
    const status = action === 'approve' ? 'completed' : 'skipped';
    await updateDoc(doc(db, 'users', profile.uid, 'workouts', latestWorkout.id), {
      status
    });
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold text-[#141414] tracking-tight">Welcome back, {profile.displayName.split(' ')[0]}</h1>
          <p className="text-[#141414]/60">Here's your progress towards your {profile.goalBodyFat}% body fat goal.</p>
        </div>
        <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-[#141414]/5 shadow-sm">
          <div className="w-10 h-10 bg-[#141414]/5 rounded-xl flex items-center justify-center">
            <Calendar className="text-[#141414]/40" size={20} />
          </div>
          <div className="pr-4">
            <p className="text-xs font-medium text-[#141414]/40 uppercase tracking-wider">Today</p>
            <p className="font-bold text-[#141414]">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</p>
          </div>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
        <StatCard 
          progress={timelineProgress}
          label="Timeline" 
          value={`${daysLeft} Days`} 
          subValue="Until Goal"
          color="text-emerald-500"
        />
        <StatCard 
          progress={bfProgress}
          label="Body Fat" 
          value={`${currentBF}%`} 
          subValue={`Goal: ${profile.goalBodyFat}%`}
          color="text-orange-500"
        />
        <StatCard 
          progress={100}
          label="Daily Target" 
          value={`${currentTargets.dailyCalories} kcal`} 
          subValue={`${currentTargets.macros.protein}g Protein`}
          color="text-red-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Daily TODO List */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-[#141414]/5 rounded-xl flex items-center justify-center">
                <ListTodo className="text-[#141414]" size={20} />
              </div>
              <h3 className="text-xl font-bold text-[#141414]">Daily TODO</h3>
            </div>

            <div className="space-y-4">
              <TodoItem 
                icon={<Scale size={18} />}
                title="Log Daily Vitals"
                description={vitalsLoggedToday ? "Vitals logged for today" : "Weight and body fat entry needed"}
                status={vitalsLoggedToday ? 'completed' : 'none'}
                color="blue"
                onAction={handleVitalsAction}
              />
              
              <TodoItem 
                icon={<Utensils size={18} />}
                title="Today's Meal Plan"
                description={todayMealPlan ? todayMealPlan.meals.map(m => m.name).join(', ') : "No meal plan generated"}
                status={todayMealPlan?.meals.every(m => m.status === 'completed') ? 'completed' : (todayMealPlan?.meals.some(m => m.status === 'skipped') ? 'skipped' : 'none')}
                color="orange"
                onAction={handleMealAction}
              />

              <TodoItem 
                icon={<Dumbbell size={18} />}
                title="Today's Workout"
                description={todayWorkout ? `${todayWorkout.title}: ${todayWorkout.exercises.length} exercises` : "No workout scheduled"}
                status={todayWorkout?.status || 'none'}
                color="purple"
                onAction={handleWorkoutAction}
              />
            </div>
          </div>
        </div>

        {/* Quick View */}
        <div className="space-y-6">
          <div className="bg-[#141414] p-8 rounded-3xl shadow-xl text-white">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                <Flame className="text-white" size={20} />
              </div>
              <h3 className="text-xl font-bold">Daily Focus</h3>
            </div>
            
            <div className="mb-8 p-4 bg-white/5 rounded-2xl border border-white/10 italic relative">
              <Quote className="absolute -top-2 -left-2 text-white/20" size={24} />
              <p className="text-sm text-white/80 leading-relaxed">
                "{quote.text}"
              </p>
              {quote.author && (
                <p className="text-[10px] text-white/40 mt-2 not-italic text-right uppercase tracking-widest">
                  — {quote.author}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showVitalsModal && (
          <VitalsModal 
            profile={profile} 
            currentWeight={currentWeight}
            currentBodyFat={currentBF}
            onClose={() => setShowVitalsModal(false)} 
          />
        )}
        {showMealModal && todayMealPlan && (
          <MealModal 
            meals={todayMealPlan.meals} 
            dayName={todayMealPlan.day}
            onClose={() => setShowMealModal(false)} 
            onConfirm={() => handleMealAction('approve')}
          />
        )}
        {showWorkoutModal && latestWorkout && (
          <WorkoutModal 
            workout={latestWorkout} 
            onClose={() => setShowWorkoutModal(false)} 
            onConfirm={() => handleWorkoutAction('approve')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function VitalsModal({ profile, currentWeight, currentBodyFat, onClose }: { profile: UserProfile, currentWeight: number, currentBodyFat: number, onClose: () => void }) {
  const [weight, setWeight] = useState(currentWeight);
  const [bodyFat, setBodyFat] = useState(currentBodyFat);
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const [year, month, day] = date.split('-').map(Number);
      const selectedDate = new Date();
      selectedDate.setFullYear(year, month - 1, day);
      
      const isoDate = selectedDate.toISOString();

      await addDoc(collection(db, 'users', profile.uid, 'vitals'), {
        date: isoDate,
        weight,
        bodyFat,
      });

      // Recalculate target date based on new body fat
      const newTargetDate = calculateTargetDate(
        bodyFat,
        profile.goalBodyFat || 15,
        profile.activityLevel || 'moderate'
      );

      // Update profile with new target date only
      await updateDoc(doc(db, 'users', profile.uid), {
        targetDate: newTargetDate
      });

      // Log daily target snapshot
      await logDailyTarget(profile.uid, { ...profile, targetDate: newTargetDate }, weight, bodyFat, isoDate);
      
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
        className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-[#141414]/5"
      >
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold text-[#141414]">Log Vitals</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#141414]/60">Date</label>
            <input 
              type="date" 
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#141414]/60">Weight (lbs)</label>
            <div className="relative">
              <Scale className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
              <input 
                type="number" 
                step="0.1"
                value={weight}
                onChange={e => setWeight(parseFloat(e.target.value))}
                className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#141414]/60">Body Fat (%)</label>
            <div className="relative">
              <Activity className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
              <input 
                type="number" 
                step="0.1"
                value={bodyFat}
                onChange={e => setBodyFat(parseFloat(e.target.value))}
                className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
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

function MealModal({ meals, dayName, onClose, onConfirm }: { meals: Meal[], dayName: string, onClose: () => void, onConfirm?: () => void }) {
  const totalCalories = meals.reduce((sum, m) => sum + m.calories, 0);
  
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
        className="bg-white w-full max-w-3xl p-8 rounded-3xl shadow-2xl border border-[#141414]/5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center">
              <Utensils size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-[#141414]">Today's Meals</h3>
              <p className="text-[#141414]/60">{dayName} • {totalCalories} kcal total</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          {meals.map((meal, mIdx) => (
            <div key={mIdx} className="bg-[#141414]/5 p-6 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-orange-600 font-bold text-xs">
                    {meal.name[0]}
                  </div>
                  <h4 className="text-lg font-bold text-[#141414]">{meal.name}</h4>
                </div>
                <span className="text-sm font-bold text-orange-600">{meal.calories} kcal</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h5 className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-2">Ingredients</h5>
                  <div className="flex flex-wrap gap-2">
                    {meal.ingredients.map((ing, idx) => (
                      <span key={idx} className="px-2 py-1 bg-white rounded-md text-[10px] font-medium text-[#141414]/60 border border-[#141414]/5">
                        {ing}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h5 className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-2">Instructions</h5>
                  <p className="text-xs text-[#141414]/70 line-clamp-3">{meal.recipe}</p>
                </div>
              </div>
            </div>
          ))}

          <div className="pt-4">
            <button 
              onClick={() => {
                if (onConfirm) onConfirm();
                onClose();
              }}
              className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={18} />
              Confirm All Meals Completed
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function WorkoutModal({ workout, onClose, onConfirm }: { workout: WorkoutPlan, onClose: () => void, onConfirm?: () => void }) {
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
        className="bg-white w-full max-w-3xl p-8 rounded-3xl shadow-2xl border border-[#141414]/5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
              <Dumbbell size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-[#141414]">{todayWorkout.title}</h3>
              <p className="text-[#141414]/60">{todayWorkout.exercises.length} Exercises • {todayWorkout.day}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
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

        <div className="space-y-4 mb-8">
          <h4 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest mb-2">Exercise List</h4>
          {todayWorkout.title === 'Rest' ? (
            <div className="p-8 bg-blue-50 rounded-2xl text-center">
              <Zap className="text-blue-500 mx-auto mb-4" size={32} />
              <h5 className="font-bold text-blue-900 mb-2">Rest & Recovery Day</h5>
              <p className="text-sm text-blue-700">{todayWorkout.notes || "Focus on active recovery and mobility today."}</p>
            </div>
          ) : (
            todayWorkout.exercises.map((ex, idx) => (
              <div key={idx} className="flex items-center gap-6 p-6 bg-[#141414]/5 rounded-2xl border border-transparent hover:border-[#141414]/10 transition-all">
                <div className="w-10 h-10 bg-[#141414] rounded-xl flex items-center justify-center text-white font-bold shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <h5 className="font-bold text-[#141414]">{ex.name}</h5>
                  <p className="text-sm text-[#141414]/60">{ex.notes}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-[#141414]">{ex.sets} × {ex.reps}</p>
                  <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Sets & Reps</p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-4">
          <button 
            onClick={() => {
              if (onConfirm) onConfirm();
              onClose();
            }}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={18} />
            Confirm & Mark Completed
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function TodoItem({ icon, title, description, status, color, onAction }: { icon: React.ReactNode, title: string, description: string, status: 'completed' | 'skipped' | 'none', color: string, onAction: (action: 'approve' | 'deny' | 'edit') => void }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600'
  }[color as 'blue' | 'orange' | 'purple'];

  return (
    <div 
      onClick={() => onAction('edit')}
      className="flex items-center justify-between p-4 rounded-2xl border border-[#141414]/5 hover:border-[#141414]/10 transition-all group cursor-pointer"
    >
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colorClasses}`}>
          {icon}
        </div>
        <div>
          <h4 className="font-bold text-[#141414]">{title}</h4>
          <p className="text-sm text-[#141414]/60">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <ActionButton 
          icon={<Check size={16} />} 
          color={status === 'completed' ? 'bg-green-100 text-green-600' : 'hover:bg-green-50 hover:text-green-600'} 
          isActive={status === 'completed'}
          onClick={(e) => {
            e.stopPropagation();
            onAction('approve');
          }} 
        />
        <ActionButton 
          icon={<X size={16} />} 
          color={status === 'skipped' ? 'bg-red-100 text-red-600' : 'hover:bg-red-50 hover:text-red-600'} 
          isActive={status === 'skipped'}
          onClick={(e) => {
            e.stopPropagation();
            onAction('deny');
          }} 
        />
        <ActionButton 
          icon={<Pencil size={16} />} 
          color="hover:bg-blue-50 hover:text-blue-600" 
          onClick={(e) => {
            e.stopPropagation();
            onAction('edit');
          }} 
        />
      </div>
    </div>
  );
}

function StatCard({ progress, label, value, subValue, color }: { progress: number, label: string, value: string, subValue: string, color: string }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm flex items-start gap-4">
      <div className="w-14 h-14 bg-[#141414]/5 rounded-2xl flex items-center justify-center shrink-0 relative">
        <svg className="w-full h-full -rotate-90">
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
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#141414]">
          {progress}%
        </span>
      </div>
      <div>
        <p className="text-sm font-medium text-[#141414]/40 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-2xl font-bold text-[#141414] tracking-tight">{value}</p>
        <p className="text-xs text-[#141414]/40 mt-1">{subValue}</p>
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
