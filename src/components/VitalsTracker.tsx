import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, VitalLog } from '../types';
import { motion } from 'motion/react';
import { Plus, Trash2, Scale, Activity } from 'lucide-react';
import { logDailyTarget, calculateTargetDate } from '../services/aiService';

interface Props {
  profile: UserProfile;
}

export function VitalsTracker({ profile }: Props) {
  const [vitals, setVitals] = useState<VitalLog[]>([]);
  const [weight, setWeight] = useState(profile.currentWeight || 80);
  const [bodyFat, setBodyFat] = useState(profile.currentBodyFat || 20);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'users', profile.uid, 'vitals'),
      orderBy('date', 'desc'),
      limit(30)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setVitals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as VitalLog)));
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const handleAddLog = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Use the selected date at the current time
      const selectedDate = new Date(date);
      const now = new Date();
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());

      await addDoc(collection(db, 'users', profile.uid, 'vitals'), {
        date: selectedDate.toISOString(),
        weight,
        bodyFat,
      });

      // Recalculate target date based on new body fat
      const newTargetDate = calculateTargetDate(
        bodyFat,
        profile.goalBodyFat,
        profile.activityLevel
      );

      // Update profile with latest stats and new target date
      await updateDoc(doc(db, 'users', profile.uid), {
        currentWeight: weight,
        currentBodyFat: bodyFat,
        targetDate: newTargetDate
      });

      // Log daily target snapshot
      await logDailyTarget(profile.uid, { ...profile, currentWeight: weight, currentBodyFat: bodyFat, targetDate: newTargetDate }, selectedDate.toISOString());
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'users', profile.uid, 'vitals', id));
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-sans font-bold text-[#141414] tracking-tight">Vitals Tracker</h1>
        <p className="text-[#141414]/60">Log your daily measurements to track your progress.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Log Form */}
        <div className="lg:col-span-1">
          <form onSubmit={handleAddLog} className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm space-y-6">
            <h3 className="text-xl font-bold text-[#141414] flex items-center gap-2">
              <Plus size={20} />
              New Entry
            </h3>

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
        </div>

        {/* History List */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
            <div className="p-6 border-bottom border-[#141414]/5 flex justify-between items-center">
              <h3 className="text-xl font-bold text-[#141414]">History</h3>
              <span className="text-xs font-bold text-[#141414]/40 uppercase tracking-widest">{vitals.length} Entries</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#141414]/5 text-[#141414]/40 text-xs uppercase tracking-widest">
                    <th className="px-6 py-4 font-bold">Date</th>
                    <th className="px-6 py-4 font-bold">Weight</th>
                    <th className="px-6 py-4 font-bold">Body Fat</th>
                    <th className="px-6 py-4 font-bold">Goal</th>
                    <th className="px-6 py-4 font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/5">
                  {vitals.map((log) => (
                    <tr key={log.id} className="hover:bg-[#141414]/5 transition-colors group">
                      <td className="px-6 py-4 font-medium text-[#141414]">
                        {new Date(log.date).toLocaleDateString('en-US', { 
                          month: '2-digit', 
                          day: '2-digit', 
                          year: '2-digit' 
                        })}
                      </td>
                      <td className="px-6 py-4 text-[#141414]">{log.weight}</td>
                      <td className="px-6 py-4 text-[#141414]">{log.bodyFat}%</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-12 bg-[#141414]/5 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-orange-500" 
                              style={{ width: `${profile.goalBodyFat && log.bodyFat ? Math.min(100, Math.round((profile.goalBodyFat / log.bodyFat) * 100)) : 0}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-[#141414]/60">
                            {profile.goalBodyFat && log.bodyFat ? Math.min(100, Math.round((profile.goalBodyFat / log.bodyFat) * 100)) : 0}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button 
                          onClick={() => handleDelete(log.id)}
                          className="p-2 text-red-500 opacity-0 group-hover:opacity-100 hover:bg-red-50 rounded-lg transition-all"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {vitals.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-[#141414]/40 italic">
                        No logs yet. Start by adding your first measurement.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
