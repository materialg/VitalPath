import React, { useState, useEffect } from 'react';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, LiftBankItem, LiftCategory, LiftEquipment } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Trash2, Pencil, X, Save, Search, Library, Eye, EyeOff } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

const CATEGORY_OPTIONS: LiftCategory[] = ['push', 'pull', 'legs', 'core', 'cardio'];
const EQUIPMENT_OPTIONS: LiftEquipment[] = [
  'barbell',
  'dumbbell',
  'bodyweight',
  'machine',
  'cable',
  'kettlebell',
  'other',
];

const CATEGORY_BADGE: Record<LiftCategory, string> = {
  push: 'bg-orange-100 text-orange-700',
  pull: 'bg-blue-100 text-blue-700',
  legs: 'bg-purple-100 text-purple-700',
  core: 'bg-emerald-100 text-emerald-700',
  cardio: 'bg-pink-100 text-pink-700',
};

export function LiftBank({ profile }: Props) {
  const [items, setItems] = useState<LiftBankItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<LiftBankItem | null>(null);
  const [formData, setFormData] = useState<any>({
    name: '',
    category: 'push' as LiftCategory,
    equipment: 'barbell' as LiftEquipment,
    defaultSets: '',
    defaultReps: '',
    notes: '',
  });

  useEffect(() => {
    const q = query(collection(db, 'users', profile.uid, 'liftBank'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as LiftBankItem)));
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const resetForm = () => {
    setFormData({
      name: '',
      category: 'push',
      equipment: 'barbell',
      defaultSets: '',
      defaultReps: '',
      notes: '',
    });
  };

  const openForEdit = (item: LiftBankItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      category: item.category || 'push',
      equipment: item.equipment || 'barbell',
      defaultSets: item.defaultSets ?? '',
      defaultReps: item.defaultReps ?? '',
      notes: item.notes ?? '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSave: any = {
      name: formData.name.trim(),
      category: formData.category,
      equipment: formData.equipment,
      updatedAt: new Date().toISOString(),
    };
    const sets = parseInt(formData.defaultSets);
    if (!isNaN(sets) && sets > 0) dataToSave.defaultSets = sets;
    const reps = String(formData.defaultReps || '').trim();
    if (reps) dataToSave.defaultReps = reps;
    const notes = String(formData.notes || '').trim();
    if (notes) dataToSave.notes = notes;

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'users', profile.uid, 'liftBank', editingItem.id), dataToSave);
      } else {
        await addDoc(collection(db, 'users', profile.uid, 'liftBank'), dataToSave);
      }
      setIsAdding(false);
      setEditingItem(null);
      resetForm();
    } catch (error: any) {
      console.error(error);
      alert(`Error saving lift: ${error.message || 'Unknown error'}`);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'users', profile.uid, 'liftBank', id));
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const batch = writeBatch(db);
    selectedIds.forEach(id => {
      batch.delete(doc(db, 'users', profile.uid, 'liftBank', id));
    });
    await batch.commit();
    setSelectedIds(new Set());
  };

  const handleToggleHideSelected = async () => {
    if (selectedIds.size === 0) return;
    const selectedItems = items.filter(i => selectedIds.has(i.id));
    const allHidden = selectedItems.every(i => i.hidden);
    const willHide = !allHidden;
    const batch = writeBatch(db);
    selectedIds.forEach(id => {
      batch.update(doc(db, 'users', profile.uid, 'liftBank', id), { hidden: willHide });
    });
    await batch.commit();
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map(i => i.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight">Lift Bank</h1>
          <p className="text-[#141414]/60 text-sm lg:text-base">Your catalog of exercises. Used to generate workout plans and swap lifts in an existing plan.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <button
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            className="flex-1 lg:flex-none px-6 py-3 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            Add Lift
          </button>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={20} />
        <input
          type="text"
          placeholder="Search your lift bank..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white rounded-2xl border border-[#141414]/5 shadow-sm focus:ring-2 focus:ring-[#141414] transition-all"
        />
      </div>

      <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
        {selectedIds.size > 0 && (
          <div className="px-6 py-3 bg-[#141414] text-white flex items-center justify-between animate-in slide-in-from-top duration-300">
            <span className="text-sm font-medium">{selectedIds.size} lifts selected</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleToggleHideSelected}
                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
              >
                {items.filter(i => selectedIds.has(i.id)).every(i => i.hidden) ? (
                  <><Eye size={14} /> Unhide</>
                ) : (
                  <><EyeOff size={14} /> Hide</>
                )}
              </button>
              <button
                onClick={handleDeleteSelected}
                className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
              >
                <Trash2 size={14} />
                {selectedIds.size === 1 ? 'Delete Lift' : 'Delete Lifts'}
              </button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#141414]/5 bg-[#141414]/[0.02]">
                <th className="px-6 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={filteredItems.length > 0 && selectedIds.size === filteredItems.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-[#141414]/20 text-[#141414] focus:ring-[#141414]"
                  />
                </th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Lift</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Category</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Equipment</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Sets</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Reps</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-right"></th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filteredItems.map(item => (
                  <motion.tr
                    key={item.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={`group border-b border-[#141414]/5 hover:bg-[#141414]/[0.01] transition-colors ${selectedIds.has(item.id) ? 'bg-[#141414]/[0.02]' : ''} ${item.hidden ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded border-[#141414]/20 text-[#141414] focus:ring-[#141414]"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-[#141414]">{item.name}</p>
                        {item.hidden && (
                          <span className="px-1.5 py-0.5 bg-[#141414]/10 text-[#141414]/60 text-[8px] font-bold uppercase rounded flex items-center gap-1">
                            <EyeOff size={8} /> Hidden
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="text-xs text-[#141414]/40 mt-1 line-clamp-1">{item.notes}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${CATEGORY_BADGE[item.category] || 'bg-[#141414]/5 text-[#141414]/60'}`}>
                        {item.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-sm text-[#141414]/60 capitalize">{item.equipment || '—'}</td>
                    <td className="px-6 py-4 text-center font-medium text-[#141414]">{item.defaultSets ?? '—'}</td>
                    <td className="px-6 py-4 text-center font-medium text-[#141414]">{item.defaultReps || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openForEdit(item)}
                          className="p-2 hover:bg-[#141414]/5 rounded-lg text-[#141414]/40 hover:text-[#141414]"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-2 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-500"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {filteredItems.length === 0 && !isAdding && (
          <div className="py-20 text-center space-y-4">
            <div className="w-16 h-16 bg-[#141414]/5 rounded-2xl flex items-center justify-center mx-auto">
              <Library className="text-[#141414]/20" size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-[#141414] font-bold">Your lift bank is empty</p>
              <p className="text-[#141414]/40 text-sm">Add lifts you actually do so the AI can build workouts around them.</p>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {(isAdding || editingItem) && (
          <div className="fixed inset-0 bg-[#141414]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => {
            setIsAdding(false);
            setEditingItem(null);
            resetForm();
          }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl border border-[#141414]/5"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold text-[#141414]">{editingItem ? 'Edit Lift' : 'Add New Lift'}</h3>
                <button onClick={() => {
                  setIsAdding(false);
                  setEditingItem(null);
                  resetForm();
                }} className="p-2 hover:bg-[#141414]/5 rounded-xl transition-colors">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Lift Name</label>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                    placeholder="e.g. Barbell Bench Press"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Category</label>
                  <div className="grid grid-cols-5 gap-2">
                    {CATEGORY_OPTIONS.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFormData({ ...formData, category: cat })}
                        className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border-2 ${
                          formData.category === cat
                            ? 'bg-[#141414] text-white border-[#141414]'
                            : 'bg-white text-[#141414]/40 border-[#141414]/5 hover:border-[#141414]/20'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Equipment</label>
                  <select
                    value={formData.equipment}
                    onChange={e => setFormData({ ...formData, equipment: e.target.value as LiftEquipment })}
                    className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] font-medium capitalize"
                  >
                    {EQUIPMENT_OPTIONS.map(eq => (
                      <option key={eq} value={eq}>{eq}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Default Sets</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={formData.defaultSets}
                      onChange={e => setFormData({ ...formData, defaultSets: e.target.value })}
                      className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] text-center font-bold"
                      placeholder="3"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Default Reps</label>
                    <input
                      type="text"
                      value={formData.defaultReps}
                      onChange={e => setFormData({ ...formData, defaultReps: e.target.value })}
                      className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] text-center font-bold"
                      placeholder="8-12"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Notes (optional)</label>
                  <textarea
                    value={formData.notes}
                    onChange={e => setFormData({ ...formData, notes: e.target.value })}
                    rows={2}
                    className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] resize-none"
                    placeholder="Cues, variations, or limitations"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={18} />
                  {editingItem ? 'Update Lift' : 'Save to Lift Bank'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
