import React, { useState, useEffect } from 'react';
import { doc, updateDoc, collection, query, orderBy, limit, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, ActivityLevel, Gender, VitalLog } from '../types';
import { calculateTargetDate } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { X, Target, Activity, User as UserIcon, Save, Scale, Calendar } from 'lucide-react';

interface Props {
  profile: UserProfile;
  onClose: () => void;
}

export function ProfileSettingsModal({ profile, onClose }: Props) {
  const [formData, setFormData] = useState({
    displayName: profile.displayName,
    goalBodyFat: profile.goalBodyFat || 15,
    currentWeight: 180,
    currentBodyFat: 20,
    activityLevel: profile.activityLevel || 'moderate' as ActivityLevel,
    targetDate: profile.targetDate || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchLatestVitals = async () => {
      const vitalsQuery = query(
        collection(db, 'users', profile.uid, 'vitals'),
        orderBy('date', 'desc'),
        limit(1)
      );
      const vitalsSnap = await getDocs(vitalsQuery);
      if (!vitalsSnap.empty) {
        const latest = vitalsSnap.docs[0].data() as VitalLog;
        setFormData(prev => ({
          ...prev,
          currentWeight: latest.weight,
          currentBodyFat: latest.bodyFat || prev.currentBodyFat
        }));
      }
    };
    fetchLatestVitals();
  }, [profile.uid]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Fetch latest vitals for accurate calculation
      const vitalsQuery = query(
        collection(db, 'users', profile.uid, 'vitals'),
        orderBy('date', 'desc'),
        limit(1)
      );
      const vitalsSnap = await getDocs(vitalsQuery);
      const latestVital = !vitalsSnap.empty ? vitalsSnap.docs[0].data() as VitalLog : null;
      
      const prevWeight = latestVital?.weight ?? 180;
      const prevBF = latestVital?.bodyFat ?? 20;

      const newTargetDate = calculateTargetDate(
        formData.currentBodyFat, 
        formData.goalBodyFat, 
        formData.activityLevel
      );

      // Log new vital if weight or body fat changed
      if (formData.currentWeight !== prevWeight || formData.currentBodyFat !== prevBF) {
        await addDoc(collection(db, 'users', profile.uid, 'vitals'), {
          date: new Date().toISOString(),
          weight: formData.currentWeight,
          bodyFat: formData.currentBodyFat,
        });
      }

      const { currentWeight, currentBodyFat, ...rest } = formData;
      await updateDoc(doc(db, 'users', profile.uid), {
        ...rest,
        targetDate: newTargetDate,
      });
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentTargetDate = calculateTargetDate(
    formData.currentBodyFat,
    formData.goalBodyFat,
    formData.activityLevel
  );

  return (
    <div 
      className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-[#141414]/5"
      >
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 bg-[#141414] rounded-2xl flex items-center justify-center shrink-0 overflow-hidden">
            {profile.photoURL ? (
              <img 
                src={profile.photoURL} 
                alt={profile.displayName} 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserIcon className="text-white w-8 h-8" />
            )}
          </div>
          <div className="flex-1">
            <h3 className="text-2xl font-bold text-[#141414]">Profile Settings</h3>
            <p className="text-sm text-[#141414]/40">{profile.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors self-start">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#141414]/60">Display Name</label>
            <div className="relative">
              <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
              <input 
                type="text" 
                value={formData.displayName}
                onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#141414]/60">Target Body Fat (%)</label>
            <div className="relative">
              <Target className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
              <input 
                type="number" 
                step="0.1"
                value={formData.goalBodyFat}
                onChange={e => setFormData({ ...formData, goalBodyFat: parseFloat(e.target.value) })}
                className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[#141414]/60">Current Weight (lbs)</label>
              <div className="relative">
                <Scale className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
                <input 
                  type="number" 
                  step="0.1"
                  value={formData.currentWeight}
                  onChange={e => setFormData({ ...formData, currentWeight: parseFloat(e.target.value) })}
                  className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#141414]/60">Current BF %</label>
              <div className="relative">
                <Activity className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
                <input 
                  type="number" 
                  step="0.1"
                  value={formData.currentBodyFat}
                  onChange={e => setFormData({ ...formData, currentBodyFat: parseFloat(e.target.value) })}
                  className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[#141414]/60">Activity Level</label>
            <div className="relative">
              <Activity className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
              <select 
                value={formData.activityLevel}
                onChange={e => setFormData({ ...formData, activityLevel: e.target.value as ActivityLevel })}
                className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] appearance-none"
              >
                <option value="sedentary">Sedentary</option>
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="active">Active</option>
                <option value="very_active">Very Active</option>
              </select>
            </div>
          </div>

          <div className="p-4 bg-[#141414]/5 rounded-2xl border border-[#141414]/10">
            <div className="flex items-center gap-3 mb-2">
              <Calendar size={16} className="text-[#141414]/40" />
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Suggested Target Date</p>
            </div>
            <p className="text-xl font-black text-[#141414]">
              {new Date(currentTargetDate).toLocaleDateString('en-US', { 
                month: 'long', 
                day: 'numeric', 
                year: 'numeric' 
              })}
            </p>
            <p className="text-[10px] text-[#141414]/40 mt-1">
              Recalculated based on your current stats.
            </p>
          </div>

          <div className="pt-4">
            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={18} />
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
