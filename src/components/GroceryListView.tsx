import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, GroceryList } from '../types';
import { motion } from 'motion/react';
import { ShoppingCart, CheckCircle2, Circle, ExternalLink, ShoppingBag } from 'lucide-react';

interface Props {
  profile: UserProfile;
}

export function GroceryListView({ profile }: Props) {
  const [list, setList] = useState<GroceryList | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'users', profile.uid, 'groceryLists'),
      orderBy('weekStartDate', 'desc'),
      limit(1)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setList({ id: snap.docs[0].id, ...snap.docs[0].data() } as GroceryList);
      }
    });
    return () => unsubscribe();
  }, [profile.uid]);

  const toggleItem = async (index: number) => {
    if (!list) return;
    const newItems = [...list.items];
    newItems[index].checked = !newItems[index].checked;
    await updateDoc(doc(db, 'users', profile.uid, 'groceryLists', list.id), {
      items: newItems
    });
  };

  const storeLinks = [
    { name: 'Instacart', url: 'https://www.instacart.com', color: 'bg-[#0aad0a]' },
    { name: 'Costco', url: 'https://www.costco.com', color: 'bg-[#005da4]' },
    { name: 'Albertsons', url: 'https://www.albertsons.com', color: 'bg-[#004a99]' },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight">Grocery List</h1>
        <p className="text-[#141414]/60">Weekly essentials generated from your meal plan.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* List */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-3xl border border-[#141414]/5 shadow-sm overflow-hidden">
            <div className="p-6 bg-[#141414] text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <ShoppingCart size={20} />
                <h3 className="text-xl font-bold">Shopping List</h3>
              </div>
              <span className="text-xs font-bold text-white/40 uppercase tracking-widest">
                {list?.items.filter(i => i.checked).length || 0} / {list?.items.length || 0} Checked
              </span>
            </div>
            
            <div className="p-4 space-y-1">
              {list ? list.items.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleItem(idx)}
                  className={`w-full p-4 flex items-center gap-4 rounded-2xl transition-all text-left ${
                    item.checked ? 'bg-[#141414]/5 opacity-50' : 'hover:bg-[#141414]/5'
                  }`}
                >
                  {item.checked ? (
                    <CheckCircle2 className="text-[#141414]" size={20} />
                  ) : (
                    <Circle className="text-[#141414]/20" size={20} />
                  )}
                  <div className="flex-1">
                    <p className={`font-bold ${item.checked ? 'line-through' : ''}`}>{item.name}</p>
                    <p className="text-xs text-[#141414]/40 uppercase tracking-wider">{item.amount}</p>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-1 bg-[#141414]/5 rounded-md uppercase tracking-widest text-[#141414]/40">
                    {item.category}
                  </span>
                </button>
              )) : (
                <div className="p-12 text-center text-[#141414]/40 italic">
                  No grocery list generated. Generate a meal plan first!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Store Links */}
        <div className="space-y-6">
          <div className="bg-white p-8 rounded-3xl border border-[#141414]/5 shadow-sm">
            <h3 className="text-xl font-bold text-[#141414] mb-6 flex items-center gap-2">
              <ShoppingBag size={20} />
              Order Online
            </h3>
            <div className="space-y-3">
              {storeLinks.map((store) => (
                <a
                  key={store.name}
                  href={store.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full p-4 flex items-center justify-between bg-[#141414]/5 rounded-2xl hover:bg-[#141414]/10 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 ${store.color} rounded-lg`} />
                    <span className="font-bold text-[#141414]">{store.name}</span>
                  </div>
                  <ExternalLink size={16} className="text-[#141414]/20 group-hover:text-[#141414] transition-colors" />
                </a>
              ))}
            </div>
            <p className="text-xs text-[#141414]/40 mt-6 leading-relaxed">
              Note: Direct API integration with local grocery stores requires specific account authorization. 
              Use these links to quickly access your preferred store.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
