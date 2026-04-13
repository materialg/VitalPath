/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { UserProfile, VitalLog } from './types';
import { Dashboard } from './components/Dashboard';
import { VitalsTracker } from './components/VitalsTracker';
import { MealPlanner } from './components/MealPlanner';
import { WorkoutCoach } from './components/WorkoutCoach';
import { ProfileSetup } from './components/ProfileSetup';
import { GroceryListView } from './components/GroceryListView';
import { ProfileSettingsModal } from './components/ProfileSettingsModal';
import { Activity, Utensils, Dumbbell, User as UserIcon, LogOut, LayoutDashboard, ShoppingCart, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (firebaseUser) {
        const docRef = doc(db, 'users', firebaseUser.uid);
        unsubscribeProfile = onSnapshot(docRef, (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            setProfile(null);
          }
          setLoading(false);
        });
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-4 border-[#141414] border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-[#141414]/10 text-center"
        >
          <div className="w-16 h-16 bg-[#141414] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Activity className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-sans font-bold text-[#141414] mb-2 tracking-tight">VitalPath AI</h1>
          <p className="text-[#141414]/60 mb-8">Your personalized path to peak physical condition.</p>
          <button
            onClick={signInWithGoogle}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-colors flex items-center justify-center gap-3"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  if (!profile) {
    return <ProfileSetup user={user} onComplete={(p) => setProfile(p)} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard profile={profile} onNavigate={setActiveTab} />;
      case 'vitals': return <VitalsTracker profile={profile} />;
      case 'meals': return <MealPlanner profile={profile} />;
      case 'workouts': return <WorkoutCoach profile={profile} />;
      case 'groceries': return <GroceryListView profile={profile} />;
      default: return <Dashboard profile={profile} onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex">
      {/* Sidebar */}
      <nav className="w-20 md:w-64 bg-white border-r border-[#141414]/10 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center shrink-0">
            <Activity className="text-white w-5 h-5" />
          </div>
          <span className="font-sans font-bold text-[#141414] hidden md:block tracking-tight">VitalPath</span>
        </div>

        <div className="flex-1 px-3 space-y-1">
          <NavItem 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
          />
          <NavItem 
            active={activeTab === 'vitals'} 
            onClick={() => setActiveTab('vitals')} 
            icon={<Activity size={20} />} 
            label="Vitals" 
          />
          <NavItem 
            active={activeTab === 'meals'} 
            onClick={() => setActiveTab('meals')} 
            icon={<Utensils size={20} />} 
            label="Meal Plan" 
          />
          <NavItem 
            active={activeTab === 'groceries'} 
            onClick={() => setActiveTab('groceries')} 
            icon={<ShoppingCart size={20} />} 
            label="Groceries" 
          />
          <NavItem 
            active={activeTab === 'workouts'} 
            onClick={() => setActiveTab('workouts')} 
            icon={<Dumbbell size={20} />} 
            label="Workouts" 
          />
        </div>

        <div className="p-4 border-t border-[#141414]/10 space-y-2">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#141414]/5 group relative">
            <div className="w-10 h-10 bg-[#141414] rounded-lg flex items-center justify-center shrink-0">
              <UserIcon className="text-white w-5 h-5" />
            </div>
            <div className="hidden md:block flex-1 min-w-0">
              <p className="text-sm font-bold text-[#141414] truncate">{profile.displayName}</p>
              <p className="text-[10px] text-[#141414]/40 truncate">{profile.email}</p>
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-[#141414]/10 rounded-lg transition-colors text-[#141414]/40 hover:text-[#141414]"
            >
              <Settings size={16} />
            </button>
          </div>

          <button
            onClick={logout}
            className="w-full p-3 flex items-center gap-3 text-[#141414]/60 hover:text-[#141414] hover:bg-[#141414]/5 rounded-xl transition-all"
          >
            <LogOut size={20} />
            <span className="hidden md:block font-medium">Logout</span>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {showSettings && (
          <ProfileSettingsModal 
            profile={profile} 
            onClose={() => setShowSettings(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full p-3 flex items-center gap-3 rounded-xl transition-all ${
        active 
          ? 'bg-[#141414] text-white shadow-lg shadow-[#141414]/20' 
          : 'text-[#141414]/60 hover:text-[#141414] hover:bg-[#141414]/5'
      }`}
    >
      {icon}
      <span className="hidden md:block font-medium">{label}</span>
      {active && (
        <motion.div 
          layoutId="active-pill"
          className="ml-auto w-1.5 h-1.5 bg-white rounded-full hidden md:block"
        />
      )}
    </button>
  );
}

