import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, VitalLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Scale, Activity, X, Save, Calendar, Pencil } from 'lucide-react';
import { CompositionTrend } from './CompositionTrend';

interface Props {
  profile: UserProfile;
}

export function VitalsTracker({ profile }: Props) {
  const [vitals, setVitals] = useState<VitalLog[]>([]);
  const [editingLog, setEditingLog] = useState<VitalLog | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [range, setRange] = useState<'week' | 'all'>('all');

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

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'users', profile.uid, 'vitals', id));
    if (selectedHistoryId === id) setSelectedHistoryId(null);
  };

  const handleUpdateLog = async (id: string, updatedData: { weight: number, bodyFat: number, date: string }) => {
    try {
      await updateDoc(doc(db, 'users', profile.uid, 'vitals', id), updatedData);
      setEditingLog(null);
    } catch (error) {
      console.error(error);
    }
  };

  const selectedHistoryLog = vitals.find(v => v.id === selectedHistoryId) || null;

  const filteredVitals = (() => {
    if (range !== 'week') return vitals;
    const now = new Date();
    const monOffset = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - monOffset);
    monday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    return vitals.filter(v => {
      const ts = new Date(v.date).getTime();
      return ts >= monday.getTime() && ts < nextMonday.getTime();
    });
  })();

  const goalBF = profile.goalBodyFat || 15;
  const latestVital = vitals[0];
  const goalWeight = latestVital
    ? Math.round((latestVital.weight * (1 - latestVital.bodyFat / 100)) / (1 - goalBF / 100))
    : 170;

  return (
    <div className="space-y-4">
      <CompositionTrend vitals={filteredVitals} goalWeight={goalWeight} goalBF={goalBF} />

      <div
        className="bg-white p-1 flex gap-1"
        style={{ border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 16 }}
      >
        <button
          onClick={() => setRange('week')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
            range === 'week'
              ? 'bg-[#141414] text-white'
              : 'text-[#141414]/50 hover:text-[#141414]'
          }`}
        >
          Week
        </button>
        <button
          onClick={() => setRange('all')}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
            range === 'all'
              ? 'bg-[#141414] text-white'
              : 'text-[#141414]/50 hover:text-[#141414]'
          }`}
        >
          All Time
        </button>
      </div>

      <button
        onClick={() => setIsHistoryOpen(true)}
        className="w-full p-4 flex items-center justify-between rounded-2xl transition-all text-[#141414]/60 hover:bg-[#141414]/5 border border-dashed border-[#141414]/10"
      >
        <span className="font-bold text-sm">View History</span>
        <Calendar size={18} />
      </button>

      <AnimatePresence>
        {isHistoryOpen && (
          <div
            className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { setIsHistoryOpen(false); setSelectedHistoryId(null); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-3xl p-6 lg:p-8 rounded-3xl shadow-2xl border border-[#141414]/5 flex flex-col max-h-[90vh]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6 lg:mb-8">
                <div>
                  <h3 className="text-2xl font-bold text-[#141414]">Vitals History</h3>
                  <p className="text-sm text-[#141414]/40">Every entry you&apos;ve logged, newest first.</p>
                </div>
                <button
                  onClick={() => { setIsHistoryOpen(false); setSelectedHistoryId(null); }}
                  className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-hidden">
                <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                  {vitals.length === 0 && (
                    <p className="text-sm text-[#141414]/40 text-center py-8">No entries yet.</p>
                  )}
                  {vitals.map(log => {
                    const isSelected = selectedHistoryId === log.id;
                    const logDate = new Date(log.date);
                    return (
                      <button
                        key={log.id}
                        onClick={() => setSelectedHistoryId(log.id)}
                        className={`w-full p-4 text-left rounded-2xl transition-all border ${
                          isSelected
                            ? 'bg-[#141414] text-white border-transparent shadow-lg'
                            : 'bg-white text-[#141414] border-[#141414]/5 hover:border-[#141414]/20'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold">
                            {logDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          </span>
                          <span className={`text-xs font-bold ${isSelected ? 'text-white/60' : 'text-[#141414]/40'}`}>
                            {logDate.toLocaleDateString('en-US', { year: 'numeric' })}
                          </span>
                        </div>
                        <div className={`flex gap-3 text-[10px] font-medium ${isSelected ? 'text-white/60' : 'text-[#141414]/40'}`}>
                          <span>{log.weight} lbs</span>
                          <span>·</span>
                          <span>{log.bodyFat}% BF</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="bg-[#141414]/[0.02] rounded-2xl p-6 overflow-y-auto custom-scrollbar">
                  {selectedHistoryLog ? (
                    <div className="space-y-6">
                      <div>
                        <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">
                          {new Date(selectedHistoryLog.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                        <h4 className="text-xl font-bold text-[#141414]">Logged vitals</h4>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white p-4 rounded-xl border border-[#141414]/5">
                          <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Weight</p>
                          <p className="text-xl font-bold text-[#141414]">{selectedHistoryLog.weight} <span className="text-xs font-normal text-[#141414]/40">lbs</span></p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-[#141414]/5">
                          <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">Body Fat</p>
                          <p className="text-xl font-bold text-[#141414]">{selectedHistoryLog.bodyFat}<span className="text-xs font-normal text-[#141414]/40">%</span></p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingLog(selectedHistoryLog); setIsHistoryOpen(false); }}
                          className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all"
                        >
                          <Pencil size={16} />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(selectedHistoryLog.id)}
                          className="flex items-center justify-center p-3 bg-white border border-[#141414]/10 rounded-xl text-red-500 hover:bg-red-50 transition-all"
                          aria-label="Delete entry"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="w-12 h-12 bg-[#141414]/5 rounded-xl flex items-center justify-center mb-3">
                        <Calendar className="text-[#141414]/20" size={22} />
                      </div>
                      <p className="text-sm font-bold text-[#141414]">Select a day</p>
                      <p className="text-xs text-[#141414]/40">Click any entry on the left to see details.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                step="1"
                value={Number.isNaN(weight) ? '' : weight}
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
                step="1"
                value={Number.isNaN(bodyFat) ? '' : bodyFat}
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
