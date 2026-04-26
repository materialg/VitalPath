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
import { Plus, Trash2, Pencil, X, Library, EyeOff } from 'lucide-react';

interface Props {
  profile: UserProfile;
  hideHeader?: boolean;
}

const CATEGORY_OPTIONS: LiftCategory[] = ['push', 'pull', 'legs'];
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
};

export function LiftBank({ profile, hideHeader }: Props) {
  const [items, setItems] = useState<LiftBankItem[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<LiftBankItem | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<LiftCategory | 'all'>('all');
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
    const unsubscribe = onSnapshot(q, async (snap) => {
      const next = snap.docs.map(d => ({ id: d.id, ...d.data() } as LiftBankItem));
      setItems(next);

      const stale = snap.docs.filter(d => {
        const c = (d.data() as any).category;
        return c === 'core' || c === 'cardio';
      });
      if (stale.length > 0) {
        const batch = writeBatch(db);
        const now = new Date().toISOString();
        stale.forEach(d => batch.update(d.ref, { category: 'push', updatedAt: now }));
        try { await batch.commit(); } catch (err) { console.warn('Lift category migration failed:', err); }
      }
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

  const handleToggleHidden = async (item: LiftBankItem) => {
    await updateDoc(doc(db, 'users', profile.uid, 'liftBank', item.id), { hidden: !item.hidden });
  };

  const displayedItems = categoryFilter === 'all'
    ? items
    : items.filter(i => i.category === categoryFilter);

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        {!hideHeader && (
          <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight text-center">Lift Bank</h1>
        )}
        <div className="flex justify-center">
          <button
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            aria-label="Add Lift"
            className="w-full lg:w-auto px-6 py-3 bg-white border border-[#141414]/5 text-[#141414] rounded-xl font-medium hover:bg-[#141414]/5 transition-all flex items-center justify-center shadow-sm"
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {(['all', ...CATEGORY_OPTIONS] as const).map(cat => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-[#141414] text-white'
                    : 'bg-white text-[#141414]/60 border border-[#141414]/10 hover:text-[#141414]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </header>

      <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#141414]/5 bg-[#141414]/[0.02]">
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
                {displayedItems.map(item => (
                  <motion.tr
                    key={item.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={`group border-b border-[#141414]/5 hover:bg-[#141414]/[0.01] transition-colors ${item.hidden ? 'opacity-50' : ''}`}
                  >
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

        {/* Mobile list */}
        <div className="md:hidden divide-y divide-[#141414]/5">
          {displayedItems.length === 0 && (
            <p className="text-center text-sm text-[#141414]/40 py-8">No lifts in this category yet.</p>
          )}
          {displayedItems.map(item => {
            return (
              <div key={item.id} className={`${item.hidden ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-[#141414] truncate">{item.name}</p>
                      {item.hidden && (
                        <span className="px-1.5 py-0.5 bg-[#141414]/10 text-[#141414]/60 text-[8px] font-bold uppercase rounded flex items-center gap-1 shrink-0">
                          <EyeOff size={8} /> Hidden
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${CATEGORY_BADGE[item.category] || 'bg-[#141414]/5 text-[#141414]/60'}`}>
                        {item.category}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => openForEdit(item)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors bg-[#141414]/5 text-[#141414]/40 hover:text-[#141414]"
                    aria-label="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {items.length === 0 && !isAdding && (
          <div className="py-20 text-center space-y-4">
            <div className="w-16 h-16 bg-[#141414]/5 rounded-2xl flex items-center justify-center mx-auto">
              <Library className="text-[#141414]/20" size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-[#141414] font-bold">Your lift bank is empty</p>
              <p className="text-[#141414]/40 text-sm">Add lifts manually using the button above.</p>
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
                {editingItem ? (
                  <span />
                ) : (
                  <h3 className="text-2xl font-bold text-[#141414]">Add New Lift</h3>
                )}
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
                    {CATEGORY_OPTIONS.map(cat => {
                      const selected = formData.category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setFormData({ ...formData, category: cat })}
                          className={`py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border-2 ${
                            selected
                              ? `${CATEGORY_BADGE[cat]} border-transparent ring-2 ring-[#141414]`
                              : `${CATEGORY_BADGE[cat]} opacity-40 border-transparent hover:opacity-70`
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
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

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-4 bg-[#141414]/5 text-[#141414] rounded-xl font-medium hover:bg-[#141414]/10 transition-all flex items-center justify-center gap-2"
                  >
                    <span className="text-lg leading-none">💽</span>
                    {editingItem ? 'Update' : 'Save'}
                  </button>
                  {editingItem && (
                    <button
                      type="button"
                      onClick={() => {
                        handleToggleHidden(editingItem);
                        setEditingItem(null);
                        resetForm();
                      }}
                      className="flex-1 py-4 bg-[#141414]/5 text-[#141414] rounded-xl font-medium hover:bg-[#141414]/10 transition-all flex items-center justify-center gap-2"
                    >
                      <span className="text-lg leading-none">👁️</span>
                      {editingItem.hidden ? 'Unhide' : 'Hide'}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
