import React, { useState } from 'react';
import { Utensils, Dumbbell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { FoodBank } from './FoodBank';
import { LiftBank } from './LiftBank';

interface Props {
  profile: UserProfile;
}

export function Database({ profile }: Props) {
  const [view, setView] = useState<'food' | 'lift'>('food');

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 bg-white border border-[#141414]/5 rounded-2xl p-1.5 shadow-sm">
          <button
            onClick={() => setView('food')}
            aria-label="Food Bank"
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
              view === 'food'
                ? 'bg-[#141414] text-white shadow-md shadow-[#141414]/20'
                : 'text-[#141414]/40 hover:text-[#141414] hover:bg-[#141414]/5'
            }`}
          >
            <Utensils size={20} />
          </button>
          <button
            onClick={() => setView('lift')}
            aria-label="Lift Bank"
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
              view === 'lift'
                ? 'bg-[#141414] text-white shadow-md shadow-[#141414]/20'
                : 'text-[#141414]/40 hover:text-[#141414] hover:bg-[#141414]/5'
            }`}
          >
            <Dumbbell size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {view === 'food' ? (
            <FoodBank profile={profile} hideHeader />
          ) : (
            <LiftBank profile={profile} hideHeader />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
