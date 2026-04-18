import React, { useState, useEffect, useRef } from 'react';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, updateDoc, writeBatch, getDocs, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, FoodBankItem, VitalLog } from '../types';
import { generateAndSaveMealPlan } from '../services/aiService';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Trash2, Pencil, X, Save, Search, Database, Scale, Flame, Zap, Upload, FileText, Loader2, Camera, Eye, EyeOff } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseNutritionLabel } from '../services/aiService';

interface Props {
  profile: UserProfile;
}

export function FoodBank({ profile }: Props) {
  const [items, setItems] = useState<FoodBankItem[]>([]);
  const [latestVital, setLatestVital] = useState<VitalLog | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [editingItem, setEditingItem] = useState<FoodBankItem | null>(null);
  const [formData, setFormData] = useState<any>({
    name: '',
    servingSize: '',
    servingUnit: 'g' as 'g' | 'oz' | 'unit' | 'ml',
    calories: '',
    protein: '',
    carbs: '',
    fats: '',
    fiber: '',
    mealTypes: [] as ('B' | 'L' | 'D')[]
  });

  useEffect(() => {
    const q = query(
      collection(db, 'users', profile.uid, 'foodBank'),
      orderBy('name', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FoodBankItem)));
    });

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

    return () => {
      unsubscribe();
      unsubscribeVitals();
    };
  }, [profile.uid]);

  const resetForm = () => {
    setFormData({
      name: '',
      servingSize: '',
      servingUnit: 'g',
      calories: '',
      protein: '',
      carbs: '',
      fats: '',
      fiber: '',
      mealTypes: []
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dataToSave = {
      ...formData,
      servingSize: parseFloat(formData.servingSize) || 0,
      calories: parseInt(formData.calories) || 0,
      protein: parseFloat(formData.protein) || 0,
      carbs: parseFloat(formData.carbs) || 0,
      fats: parseFloat(formData.fats) || 0,
      fiber: parseFloat(formData.fiber) || 0,
    };

    try {
      if (editingItem) {
        const itemToUpdate = { ...editingItem }; // Keep a reference for background tasks
        await updateDoc(doc(db, 'users', profile.uid, 'foodBank', itemToUpdate.id), dataToSave);
        
        // Close modal immediately for better UX
        setEditingItem(null);
        resetForm();

        // Check if this item is used in any meal plan to trigger regeneration
        const mealPlansRef = collection(db, 'users', profile.uid, 'mealPlans');
        const snap = await getDocs(mealPlansRef);
        let planAffected = false;

        snap.docs.forEach(planDoc => {
          const plan = planDoc.data();
          const hasItem = plan.days.some((day: any) => 
            day.meals.some((meal: any) => 
              meal.ingredientsWithAmounts?.some((ing: any) => ing.name === itemToUpdate.name)
            )
          );
          if (hasItem) planAffected = true;
        });

        if (planAffected) {
          console.log("Meal plan affected by edit. User should regenerate manually if needed.");
        }

        // Sync name changes in grocery lists
        if (itemToUpdate.name !== dataToSave.name) {
          const groceryListsRef = collection(db, 'users', profile.uid, 'groceryLists');
          const gSnap = await getDocs(groceryListsRef);
          const gBatch = writeBatch(db);
          let gHasChanges = false;

          gSnap.docs.forEach(gDoc => {
            const list = gDoc.data();
            let listChanged = false;
            const updatedItems = list.items.map((item: any) => {
              if (item.name.includes(itemToUpdate.name)) {
                listChanged = true;
                return {
                  ...item,
                  name: item.name.replace(itemToUpdate.name, dataToSave.name)
                };
              }
              return item;
            });

            if (listChanged) {
              gHasChanges = true;
              gBatch.update(gDoc.ref, { items: updatedItems });
            }
          });

          if (gHasChanges) {
            await gBatch.commit();
          }
        }
      } else {
        await addDoc(collection(db, 'users', profile.uid, 'foodBank'), dataToSave);
        setIsAdding(false);
        resetForm();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleDelete = async (id: string) => {
    const itemToDelete = items.find(i => i.id === id);
    await deleteDoc(doc(db, 'users', profile.uid, 'foodBank', id));

    if (itemToDelete) {
      // Sync with meal plans: remove this item from all plans
      const mealPlansRef = collection(db, 'users', profile.uid, 'mealPlans');
      const snap = await getDocs(mealPlansRef);
      
      const batch = writeBatch(db);
      let hasChanges = false;

      snap.docs.forEach(planDoc => {
        const plan = planDoc.data();
        let planChanged = false;
        
        const updatedDays = plan.days.map((day: any) => ({
          ...day,
          meals: day.meals.map((meal: any) => {
            const hasItem = meal.ingredientsWithAmounts?.some((ing: any) => ing.name === itemToDelete.name);
            if (hasItem) {
              planChanged = true;
              const filteredIngs = meal.ingredientsWithAmounts.filter((ing: any) => ing.name !== itemToDelete.name);
              return {
                ...meal,
                ingredientsWithAmounts: filteredIngs,
                ingredients: filteredIngs.map((i: any) => `${i.amount} ${i.name}`)
              };
            }
            return meal;
          })
        }));

        if (planChanged) {
          hasChanges = true;
          batch.update(planDoc.ref, { days: updatedDays });
        }
      });

      if (hasChanges) {
        await batch.commit();
      }

      // Sync with grocery lists
      const groceryListsRef = collection(db, 'users', profile.uid, 'groceryLists');
      const gSnap = await getDocs(groceryListsRef);
      const gBatch = writeBatch(db);
      let gHasChanges = false;

      gSnap.docs.forEach(gDoc => {
        const list = gDoc.data();
        let listChanged = false;
        const updatedItems = list.items.filter((item: any) => !item.name.includes(itemToDelete.name));

        if (updatedItems.length !== list.items.length) {
          listChanged = true;
          gBatch.update(gDoc.ref, { items: updatedItems });
        }
      });

      if (gHasChanges) {
        await gBatch.commit();
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const itemsToDelete = items.filter(i => selectedIds.has(i.id));
    const batch = writeBatch(db);
    
    selectedIds.forEach(id => {
      batch.delete(doc(db, 'users', profile.uid, 'foodBank', id));
    });

    // Sync with meal plans
    const mealPlansRef = collection(db, 'users', profile.uid, 'mealPlans');
    const snap = await getDocs(mealPlansRef);
    let hasMealPlanChanges = false;

    snap.docs.forEach(planDoc => {
      const plan = planDoc.data();
      let planChanged = false;
      
      const updatedDays = plan.days.map((day: any) => ({
        ...day,
        meals: day.meals.map((meal: any) => {
          const originalCount = meal.ingredientsWithAmounts?.length || 0;
          const filteredIngs = meal.ingredientsWithAmounts?.filter((ing: any) => 
            !itemsToDelete.some(it => it.name === ing.name)
          ) || [];

          if (filteredIngs.length !== originalCount) {
            planChanged = true;
            return {
              ...meal,
              ingredientsWithAmounts: filteredIngs,
              ingredients: filteredIngs.map((i: any) => `${i.amount} ${i.name}`)
            };
          }
          return meal;
        })
      }));

      if (planChanged) {
        hasMealPlanChanges = true;
        batch.update(planDoc.ref, { days: updatedDays });
      }
    });

    await batch.commit();

    // Sync with grocery lists
    const groceryListsRef = collection(db, 'users', profile.uid, 'groceryLists');
    const gSnap = await getDocs(groceryListsRef);
    const gBatch = writeBatch(db);
    let gHasChanges = false;

    gSnap.docs.forEach(gDoc => {
      const list = gDoc.data();
      const originalCount = list.items.length;
      const updatedItems = list.items.filter((item: any) => 
        !itemsToDelete.some(it => item.name.includes(it.name))
      );

      if (updatedItems.length !== originalCount) {
        gHasChanges = true;
        gBatch.update(gDoc.ref, { items: updatedItems });
      }
    });

    if (gHasChanges) {
      await gBatch.commit();
    }

    setSelectedIds(new Set());
  };

  const handleToggleHideSelected = async () => {
    if (selectedIds.size === 0) return;
    const batch = writeBatch(db);
    
    // Check if all selected are hidden to decide whether to hide or unhide
    const selectedItems = items.filter(i => selectedIds.has(i.id));
    const allHidden = selectedItems.every(i => i.hidden);
    const willHide = !allHidden;
    
    selectedIds.forEach(id => {
      batch.update(doc(db, 'users', profile.uid, 'foodBank', id), {
        hidden: willHide
      });
    });

    // If we are hiding items, remove them from existing meal plans (since they are "out of stock")
    if (willHide) {
      const mealPlansRef = collection(db, 'users', profile.uid, 'mealPlans');
      const snap = await getDocs(mealPlansRef);
      
      snap.docs.forEach(planDoc => {
        const plan = planDoc.data();
        let planChanged = false;
        
        const updatedDays = plan.days.map((day: any) => ({
          ...day,
          meals: day.meals.map((meal: any) => {
            const originalCount = meal.ingredientsWithAmounts?.length || 0;
            const filteredIngs = meal.ingredientsWithAmounts?.filter((ing: any) => 
              !selectedItems.some(it => it.name === ing.name)
            ) || [];

            if (filteredIngs.length !== originalCount) {
              planChanged = true;
              return {
                ...meal,
                ingredientsWithAmounts: filteredIngs,
                ingredients: filteredIngs.map((i: any) => `${i.amount} ${i.name}`)
              };
            }
            return meal;
          })
        }));

        if (planChanged) {
          batch.update(planDoc.ref, { days: updatedDays });
        }
      });

      // Commit the removals first
      await batch.commit();
    } else {
      await batch.commit();
    }

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
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const data = event.target?.result;
        let parsedData: any[] = [];

        if (file.name.endsWith('.csv')) {
          const result = Papa.parse(data as string, { header: true, skipEmptyLines: true });
          parsedData = result.data;
        } else {
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          parsedData = XLSX.utils.sheet_to_json(worksheet);
        }

        const batch = writeBatch(db);
        const collectionRef = collection(db, 'users', profile.uid, 'foodBank');

        parsedData.forEach((row: any) => {
          // Flexible mapping
          const name = row.Food || row.food || row.Name || row.name || row.Item || row.item || 'Unknown Food';
          const calories = parseInt(row.Calories || row.calories || row.Cal || row.cal || row.Energy || row.energy || 0);
          const protein = parseFloat(row.Protein || row.protein || row.Pro || row.pro || 0);
          const carbs = parseFloat(row.Carbs || row.carbs || row.Carbohydrates || row.carbohydrates || 0);
          const fats = parseFloat(row.Fats || row.fats || row.Fat || row.fat || 0);
          const fiber = parseFloat(row.Fiber || row.fiber || row.Fib || row.fib || 0);
          const rawServing = row.Serving || row.serving || row.ServingSize || row['Serving Size'] || row.serving_size || row.Portion || row.portion || '100g';
          
          let servingSize = 100;
          let servingUnit: 'g' | 'oz' | 'unit' | 'ml' = 'g';

          if (typeof rawServing === 'string') {
            const match = rawServing.match(/(\d+\.?\d*)\s*(g|oz|unit|ml|eggs|pieces|pcs)?/i);
            if (match) {
              servingSize = parseFloat(match[1]);
              const unit = match[2]?.toLowerCase();
              if (unit === 'g') servingUnit = 'g';
              else if (unit === 'oz') servingUnit = 'oz';
              else if (unit === 'ml') servingUnit = 'ml';
              else servingUnit = 'unit';
            }
          } else if (typeof rawServing === 'number') {
            servingSize = rawServing;
          }

          const newDocRef = doc(collectionRef);
          batch.set(newDocRef, {
            name,
            calories,
            protein,
            carbs,
            fats,
            fiber,
            servingSize,
            servingUnit
          });
        });

        await batch.commit();
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };

      if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
      } else {
        reader.readAsBinaryString(file);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      setIsUploading(false);
    }
  };

  const handleScanLabel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = (event.target?.result as string).split(',')[1];
        const nutritionData = await parseNutritionLabel(base64);
        
        setFormData({
          name: nutritionData.name || '',
          servingSize: nutritionData.servingSize || 100,
          servingUnit: nutritionData.servingUnit || 'g',
          calories: nutritionData.calories || 0,
          protein: nutritionData.protein || 0,
          carbs: nutritionData.carbs || 0,
          fats: nutritionData.fats || 0,
          fiber: nutritionData.fiber || 0
        });
        setIsAdding(true);
        setIsScanning(false);
        if (cameraInputRef.current) cameraInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error scanning label:', error);
      setIsScanning(false);
    }
  };

  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight">Food Bank</h1>
          <p className="text-[#141414]/60 text-sm lg:text-base">Store your favorite foods and their macros for personalized meal planning.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv, .xlsx, .xls"
            className="hidden"
          />
          <input 
            type="file" 
            ref={cameraInputRef}
            onChange={handleScanLabel}
            accept="image/*"
            capture="environment"
            className="hidden"
          />
          <button 
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            className="flex-1 lg:flex-none px-6 py-3 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
          >
            <Plus size={18} />
            Add Food
          </button>
          <button 
            onClick={() => cameraInputRef.current?.click()}
            disabled={isScanning}
            className="flex-1 lg:flex-none px-6 py-3 bg-white text-[#141414] border border-[#141414]/10 rounded-xl font-medium hover:bg-[#141414]/5 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isScanning ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
            Scan Label
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full lg:w-auto px-6 py-3 bg-white text-[#141414] border border-[#141414]/10 rounded-xl font-medium hover:bg-[#141414]/5 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            Bulk Upload
          </button>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={20} />
        <input 
          type="text"
          placeholder="Search your food bank..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white rounded-2xl border border-[#141414]/5 shadow-sm focus:ring-2 focus:ring-[#141414] transition-all"
        />
      </div>

      <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
        {selectedIds.size > 0 && (
          <div className="px-6 py-3 bg-[#141414] text-white flex items-center justify-between animate-in slide-in-from-top duration-300">
            <span className="text-sm font-medium">{selectedIds.size} items selected</span>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleToggleHideSelected}
                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
              >
                {items.filter(i => selectedIds.has(i.id)).every(i => i.hidden) ? (
                  <><Eye size={14} /> Unhide Items</>
                ) : (
                  <><EyeOff size={14} /> Hide Items</>
                )}
              </button>
              <button 
                onClick={handleDeleteSelected}
                className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
              >
                <Trash2 size={14} />
                {selectedIds.size === 1 ? 'Delete Item' : 'Delete Items'}
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
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Food Item</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Serving</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Calories</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Protein</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Carbs</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Fats</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-center">Fiber</th>
                <th className="px-6 py-4 text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest text-right"></th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filteredItems.map((item) => (
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
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-[#141414]">{item.name}</p>
                          {item.hidden && (
                            <span className="px-1.5 py-0.5 bg-[#141414]/10 text-[#141414]/60 text-[8px] font-bold uppercase rounded flex items-center gap-1">
                              <EyeOff size={8} /> Hidden
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {item.mealTypes?.map(type => (
                            <span key={type} className={`text-[8px] font-black px-1.5 py-0.5 rounded ${
                              type === 'B' ? 'bg-blue-100 text-blue-700' :
                              type === 'L' ? 'bg-orange-100 text-orange-700' :
                              'bg-purple-100 text-purple-700'
                            }`}>
                              {type}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center text-sm text-[#141414]/60">
                      {item.servingSize}{item.servingUnit !== 'unit' ? item.servingUnit : ''}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700">
                        {item.calories}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center font-medium text-[#141414]">{item.protein || 0}g</td>
                    <td className="px-6 py-4 text-center font-medium text-[#141414]">{item.carbs || 0}g</td>
                    <td className="px-6 py-4 text-center font-medium text-[#141414]">{item.fats || 0}g</td>
                    <td className="px-6 py-4 text-center font-medium text-[#141414]">{item.fiber || 0}g</td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingItem(item);
                            setFormData({ ...item });
                          }}
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
              <Database className="text-[#141414]/20" size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-[#141414] font-bold">Your food bank is empty</p>
              <p className="text-[#141414]/40 text-sm">Add foods you eat regularly to help the AI generate better meal plans.</p>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
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
                <h3 className="text-2xl font-bold text-[#141414]">{editingItem ? 'Edit Food' : 'Add New Food'}</h3>
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
                  <label className="text-sm font-medium text-[#141414]/60">Food Name</label>
                  <input 
                    required
                    type="text" 
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                    placeholder="e.g. Chicken Breast"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-[#141414]/60">Meal Designation</label>
                  <div className="flex gap-2">
                    {['B', 'L', 'D'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          const current = formData.mealTypes || [];
                          const next = current.includes(type as any)
                            ? current.filter(t => t !== type)
                            : [...current, type as any];
                          setFormData({ ...formData, mealTypes: next });
                        }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border-2 ${
                          formData.mealTypes?.includes(type as any)
                            ? 'bg-[#141414] text-white border-[#141414]'
                            : 'bg-white text-[#141414]/40 border-[#141414]/5 hover:border-[#141414]/20'
                        }`}
                      >
                        {type === 'B' ? 'Breakfast' : type === 'L' ? 'Lunch' : 'Dinner'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[#141414]/60">Serving Size</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input 
                          type="number" 
                          step="any"
                          value={formData.servingSize}
                          onChange={e => setFormData({ ...formData, servingSize: e.target.value })}
                          className="w-full px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                          placeholder="100"
                        />
                      </div>
                      <select 
                        value={formData.servingUnit}
                        onChange={e => setFormData({ ...formData, servingUnit: e.target.value as any })}
                        className="px-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] font-medium"
                      >
                        <option value="g">g</option>
                        <option value="oz">oz</option>
                        <option value="unit">unit</option>
                        <option value="ml">ml</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[#141414]/60">Calories</label>
                    <div className="relative">
                      <Flame className="absolute left-4 top-1/2 -translate-y-1/2 text-[#141414]/20" size={18} />
                      <input 
                        type="number" 
                        value={formData.calories}
                        onChange={e => setFormData({ ...formData, calories: e.target.value })}
                        className="w-full pl-12 pr-4 py-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414]"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <MacroInput label="Protein" value={formData.protein} onChange={v => setFormData({ ...formData, protein: v })} />
                  <MacroInput label="Carbs" value={formData.carbs} onChange={v => setFormData({ ...formData, carbs: v })} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <MacroInput label="Fats" value={formData.fats} onChange={v => setFormData({ ...formData, fats: v })} />
                  <MacroInput label="Fiber" value={formData.fiber} onChange={v => setFormData({ ...formData, fiber: v })} />
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={18} />
                  {editingItem ? 'Update Food' : 'Save to Food Bank'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MacroBadge({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="flex flex-col items-center p-2 bg-[#141414]/5 rounded-xl">
      <span className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-tighter">{label}</span>
      <span className="text-sm font-bold text-[#141414]">{value}g</span>
    </div>
  );
}

function MacroInput({ label, value, onChange }: { label: string, value: any, onChange: (v: any) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">{label}</label>
      <input 
        type="number" 
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full p-3 bg-[#141414]/5 rounded-xl border-none focus:ring-2 focus:ring-[#141414] text-center font-bold"
      />
    </div>
  );
}
