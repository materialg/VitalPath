import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, VitalLog } from '../types';
import { motion } from 'motion/react';
import { Plus, Trash2, Scale, Activity, Pencil, X, Save, TrendingUp } from 'lucide-react';
import { logDailyTarget, calculateTargetDate } from '../services/aiService';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

interface Props {
  profile: UserProfile;
}

export function VitalsTracker({ profile }: Props) {
  const [vitals, setVitals] = useState<VitalLog[]>([]);
  const latestVital = vitals[0];
  const [weight, setWeight] = useState(latestVital?.weight || 180);
  const [bodyFat, setBodyFat] = useState(latestVital?.bodyFat || 20);
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingLog, setEditingLog] = useState<VitalLog | null>(null);

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
    
    // Check if an entry for this date already exists in the current list
    const existingEntry = vitals.find(v => v.date.startsWith(date));
    if (existingEntry) {
      setEditingLog(existingEntry);
      return;
    }

    setIsSubmitting(true);
    try {
      // Parse the date string as local time to avoid timezone shifts
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
    } catch (error) {
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'users', profile.uid, 'vitals', id));
  };

  const handleUpdateLog = async (id: string, updatedData: { weight: number, bodyFat: number, date: string }) => {
    try {
      await updateDoc(doc(db, 'users', profile.uid, 'vitals', id), updatedData);
      
      // If this was the latest log, we might want to update the profile target date
      // For simplicity, we'll just update the log itself here
      
      setEditingLog(null);
    } catch (error) {
      console.error(error);
    }
  };

  const chartData = [...vitals].reverse().map(log => ({
    ...log,
    displayDate: new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

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

        {/* Charts and History */}
        <div className="lg:col-span-2 space-y-8">
          {/* Charts */}
          {vitals.length > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                <h3 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Scale size={14} />
                  Weight Trend
                </h3>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#141414" strokeOpacity={0.05} />
                      <XAxis 
                        dataKey="displayDate" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#141414', opacity: 0.4 }}
                        minTickGap={30}
                      />
                      <YAxis 
                        hide 
                        domain={['dataMin - 5', 'dataMax + 5']}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#141414', 
                          border: 'none', 
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#fff'
                        }}
                        itemStyle={{ color: '#fff' }}
                        labelStyle={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="weight" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorWeight)" 
                        animationDuration={1500}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
                <h3 className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Activity size={14} />
                  Body Fat Trend
                </h3>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorBF" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.1}/>
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#141414" strokeOpacity={0.05} />
                      <XAxis 
                        dataKey="displayDate" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fontSize: 10, fill: '#141414', opacity: 0.4 }}
                        minTickGap={30}
                      />
                      <YAxis 
                        hide 
                        domain={['dataMin - 2', 'dataMax + 2']}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: '#141414', 
                          border: 'none', 
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#fff'
                        }}
                        itemStyle={{ color: '#fff' }}
                        labelStyle={{ color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="bodyFat" 
                        stroke="#f97316" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorBF)" 
                        animationDuration={1500}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* History List */}
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
                    <th className="px-6 py-4 font-bold">Weight %</th>
                    <th className="px-6 py-4 font-bold">Body Fat</th>
                    <th className="px-6 py-4 font-bold">Goal</th>
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
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-12 bg-[#141414]/5 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-blue-500" 
                              style={{ 
                                width: `${(() => {
                                  const lbm = log.weight * (1 - (log.bodyFat / 100));
                                  const targetWeight = lbm / (1 - ((profile.goalBodyFat || 15) / 100));
                                  return Math.min(100, Math.round((targetWeight / log.weight) * 100));
                                })()}%` 
                              }}
                            />
                          </div>
                          <span className="text-xs font-bold text-[#141414]/60">
                            {(() => {
                              const lbm = log.weight * (1 - (log.bodyFat / 100));
                              const targetWeight = lbm / (1 - ((profile.goalBodyFat || 15) / 100));
                              return Math.min(100, Math.round((targetWeight / log.weight) * 100));
                            })()}%
                          </span>
                        </div>
                      </td>
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

      {editingLog && (
        <EditModal 
          log={editingLog} 
          onClose={() => setEditingLog(null)} 
          onSave={handleUpdateLog} 
        />
      )}
    </div>
  );
}

function EditModal({ log, onClose, onSave }: { log: VitalLog, onClose: () => void, onSave: (id: string, data: any) => Promise<void> }) {
  const [weight, setWeight] = useState(log.weight);
  const [bodyFat, setBodyFat] = useState(log.bodyFat || 20);
  const [date, setDate] = useState(new Date(log.date).toLocaleDateString('en-CA'));
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    const [year, month, day] = date.split('-').map(Number);
    const selectedDate = new Date();
    selectedDate.setFullYear(year, month - 1, day);
    
    await onSave(log.id, { weight, bodyFat, date: selectedDate.toISOString() });
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-[#141414]/5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-2xl font-bold text-[#141414]">Edit Entry</h3>
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
            disabled={isSaving}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
          >
            <Save size={18} />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
