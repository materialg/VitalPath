import { useState } from 'react';
import { User } from 'firebase/auth';
import { doc, setDoc, addDoc, collection } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { UserProfile, ActivityLevel, Gender } from '../types';
import { calculateTargetDate as getTargetDate } from '../services/aiService';
import { motion } from 'motion/react';
import { User as UserIcon, ArrowRight } from 'lucide-react';

interface Props {
  user: User;
  onComplete: (profile: UserProfile) => void;
}

export function ProfileSetup({ user, onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    age: 30,
    height: 70, // inches
    gender: 'male' as Gender,
    activityLevel: 'moderate' as ActivityLevel,
    goalBodyFat: 15,
    currentWeight: 180, // lbs
    currentBodyFat: 20,
    targetDate: '',
  });

  const calculateTargetDate = () => {
    return getTargetDate(formData.currentBodyFat, formData.goalBodyFat, formData.activityLevel);
  };

  const handleSubmit = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    console.log("Starting profile submission for user:", user.uid);

    try {
      const { currentWeight, currentBodyFat, ...rest } = formData;
      const profile: UserProfile = {
        uid: user.uid,
        displayName: user.displayName || 'User',
        email: user.email || '',
        photoURL: user.photoURL || undefined,
        ...rest,
        targetDate: formData.targetDate || calculateTargetDate(),
        createdAt: new Date().toISOString(),
      };

      console.log("Saving profile document...");
      await setDoc(doc(db, 'users', user.uid), profile);
      console.log("Profile document saved successfully.");
      
      // Create initial vital log
      console.log("Creating initial vital log...");
      await addDoc(collection(db, 'users', user.uid, 'vitals'), {
        date: new Date().toISOString(),
        weight: formData.currentWeight,
        bodyFat: formData.currentBodyFat,
      });
      console.log("Initial vital log created successfully.");

      console.log("Calling onComplete...");
      onComplete(profile);
    } catch (err: any) {
      console.error("Error saving profile:", err);
      setError(err.message || "Failed to save profile. Please check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const nextStep = () => {
    if (step === 4) {
      setFormData(prev => ({ ...prev, targetDate: calculateTargetDate() }));
    }
    setStep(s => s + 1);
  };
  const prevStep = () => setStep(s => s - 1);
  const handleCancel = () => signOut(auth);

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-xl w-full bg-white rounded-3xl shadow-2xl border border-[#141414]/10 overflow-hidden"
      >
        <div className="bg-[#141414] p-8 text-white">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
              <UserIcon className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Complete Your Profile</h2>
              <p className="text-white/60 text-sm">Step {step} of 5</p>
            </div>
          </div>
          <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(step / 5) * 100}%` }}
              className="h-full bg-white"
            />
          </div>
        </div>

        <div className="p-8">
          {step === 1 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h3 className="text-xl font-bold text-[#141414]">Basic Information</h3>
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Age</label>
                  <input 
                    type="number" 
                    value={formData.age}
                    onChange={e => setFormData({ ...formData, age: parseInt(e.target.value) })}
                    className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Gender</label>
                  <select 
                    value={formData.gender}
                    onChange={e => setFormData({ ...formData, gender: e.target.value as Gender })}
                    className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h3 className="text-xl font-bold text-[#141414]">Physical Stats</h3>
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Height (inches)</label>
                  <input 
                    type="number" 
                    value={formData.height}
                    onChange={e => setFormData({ ...formData, height: parseInt(e.target.value) })}
                    className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                  />
                  <p className="text-xs text-[#141414]/40">Example: 5'10" is 70 inches</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Current Weight (lbs)</label>
                  <input 
                    type="number" 
                    step="1"
                    value={formData.currentWeight}
                    onChange={e => setFormData({ ...formData, currentWeight: parseFloat(e.target.value) })}
                    className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h3 className="text-xl font-bold text-[#141414]">Activity Level</h3>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#141414]/60">Daily Activity</label>
                <select 
                  value={formData.activityLevel}
                  onChange={e => setFormData({ ...formData, activityLevel: e.target.value as ActivityLevel })}
                  className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                >
                  <option value="sedentary">Sedentary (Office job, little exercise)</option>
                  <option value="light">Light (1-2 days/week exercise)</option>
                  <option value="moderate">Moderate (3-5 days/week exercise)</option>
                  <option value="active">Active (6-7 days/week exercise)</option>
                  <option value="very_active">Very Active (Physical job + daily exercise)</option>
                </select>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h3 className="text-xl font-bold text-[#141414]">Body Fat Goals</h3>
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Current Body Fat (%)</label>
                  <input 
                    type="number" 
                    step="1"
                    value={formData.currentBodyFat}
                    onChange={e => setFormData({ ...formData, currentBodyFat: parseFloat(e.target.value) })}
                    className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Target Body Fat (%)</label>
                  <input 
                    type="number" 
                    step="1"
                    value={formData.goalBodyFat}
                    onChange={e => setFormData({ ...formData, goalBodyFat: parseFloat(e.target.value) })}
                    className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
              <h3 className="text-xl font-bold text-[#141414]">Suggested Timeline</h3>
              <div className="bg-[#141414]/5 p-6 rounded-2xl space-y-4">
                <p className="text-[#141414]/60 leading-relaxed">
                  Based on your <span className="text-[#141414] font-bold">{formData.activityLevel.replace('_', ' ')}</span> activity level, 
                  we suggest a target date of:
                </p>
                <div className="text-3xl font-black text-[#141414]">
                  {formData.targetDate ? new Date(formData.targetDate).toLocaleDateString('en-US', { 
                    month: 'long', 
                    day: 'numeric', 
                    year: 'numeric' 
                  }) : 'Calculating...'}
                </div>
                <p className="text-xs text-[#141414]/40">
                  This assumes a safe and sustainable body fat loss rate for your profile.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#141414]/60">Adjust Target Date (Optional)</label>
                <input 
                  type="date" 
                  value={formData.targetDate}
                  onChange={e => setFormData({ ...formData, targetDate: e.target.value })}
                  className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                />
              </div>
            </motion.div>
          )}

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm font-medium"
            >
              {error}
            </motion.div>
          )}

          <div className="flex gap-4 mt-12">
            {step === 1 ? (
              <button 
                onClick={handleCancel}
                className="flex-1 py-4 border border-red-500/20 text-red-500 rounded-xl font-medium hover:bg-red-50 transition-all"
              >
                Cancel
              </button>
            ) : (
              <button 
                onClick={prevStep}
                className="flex-1 py-4 border border-[#141414]/10 rounded-xl font-medium hover:bg-[#141414]/5 transition-all"
              >
                Back
              </button>
            )}
            <button 
              onClick={step === 5 ? handleSubmit : nextStep}
              disabled={isSaving}
              className="flex-[2] py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSaving ? (
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                />
              ) : (
                <>
                  {step === 5 ? 'Finish Setup' : 'Continue'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
