import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, WorkoutPlan } from '../types';
import { generateWorkoutPlan } from '../services/aiService';
import { motion } from 'motion/react';
import { Dumbbell, Sparkles, CheckCircle2, Info, Timer, Zap } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

export function WorkoutCoach({ profile }: Props) {
  const [workout, setWorkout] = useState<WorkoutPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'users', profile.uid, 'workouts'),
      orderBy('date', 'desc'),
      limit(1)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setWorkout({ id: snap.docs[0].id, ...snap.docs[0].data() } as WorkoutPlan);
      }
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const plan = await generateWorkoutPlan(profile);
      const newPlan = {
        ...plan,
        date: new Date().toISOString().split('T')[0],
      };
      await addDoc(collection(db, 'users', profile.uid, 'workouts'), newPlan);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold text-[#141414] tracking-tight">Workout Coach</h1>
          <p className="text-[#141414]/60">Personalized training routines to maximize fat loss and muscle retention.</p>
        </div>
        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className="px-6 py-3 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          {isGenerating ? (
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><Sparkles size={18} /></motion.div>
          ) : <Sparkles size={18} />}
          {workout ? 'New Routine' : 'Generate Workout'}
        </button>
      </header>

      {workout ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Workout Overview */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-[#141414] p-8 rounded-3xl shadow-xl text-white">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-2xl font-bold">{workout.title}</h3>
                {workout.status === 'completed' && (
                  <span className="px-2 py-1 bg-green-500/20 text-green-400 text-[10px] font-bold uppercase rounded-md border border-green-500/30">Completed</span>
                )}
                {workout.status === 'skipped' && (
                  <span className="px-2 py-1 bg-red-500/20 text-red-400 text-[10px] font-bold uppercase rounded-md border border-red-500/30">Skipped</span>
                )}
              </div>
              <p className="text-white/60 mb-8">Custom routine for {profile.displayName.split(' ')[0]}</p>
              
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                    <Timer className="text-white" size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-widest">Duration</p>
                    <p className="font-bold">45-60 mins</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                    <Zap className="text-white" size={20} />
                  </div>
                  <div>
                    <p className="text-xs text-white/40 uppercase tracking-widest">Intensity</p>
                    <p className="font-bold">Moderate-High</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
              <h4 className="font-bold text-[#141414] mb-4 flex items-center gap-2">
                <Info size={18} className="text-[#141414]/40" />
                Coaching Tips
              </h4>
              <ul className="space-y-3 text-sm text-[#141414]/60">
                <li className="flex gap-2">
                  <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                  Focus on controlled movements and full range of motion.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                  Rest 60-90 seconds between sets.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                  Hydrate well before and during the session.
                </li>
              </ul>
            </div>
          </div>

          {/* Exercise List */}
          <div className="lg:col-span-2 space-y-4">
            {workout.exercises.map((ex, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm flex items-center gap-6 group hover:border-[#141414]/20 transition-all"
              >
                <div className="w-14 h-14 bg-[#141414]/5 rounded-2xl flex items-center justify-center shrink-0 font-sans font-black text-2xl text-[#141414]/10 group-hover:text-[#141414]/20 transition-colors">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <h4 className="text-xl font-bold text-[#141414] mb-1">{ex.name}</h4>
                  <p className="text-sm text-[#141414]/60">{ex.notes}</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-[#141414]">{ex.sets} × {ex.reps}</p>
                  <p className="text-xs font-bold text-[#141414]/40 uppercase tracking-widest">Sets & Reps</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white p-12 rounded-3xl border border-[#141414]/5 shadow-sm text-center">
          <div className="w-20 h-20 bg-[#141414]/5 rounded-full flex items-center justify-center mx-auto mb-6">
            <Dumbbell className="text-[#141414]/20" size={40} />
          </div>
          <h3 className="text-2xl font-bold text-[#141414] mb-2">No Workout Plan</h3>
          <p className="text-[#141414]/60 max-w-md mx-auto mb-8">
            Generate a custom routine designed to help you reach your body fat goals while maintaining muscle.
          </p>
        </div>
      )}
    </div>
  );
}
