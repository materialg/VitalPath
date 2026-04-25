/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, orderBy, limit } from 'firebase/firestore';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { UserProfile, VitalLog } from './types';
import { Dashboard } from './components/Dashboard';
import { VitalsTracker } from './components/VitalsTracker';
import { MealPlanner } from './components/MealPlanner';
import { WorkoutCoach } from './components/WorkoutCoach';
import { FoodBank } from './components/FoodBank';
import { LiftBank } from './components/LiftBank';
import { ProfileSetup } from './components/ProfileSetup';
import { GroceryListView } from './components/GroceryListView';
import { ProfileSettingsModal } from './components/ProfileSettingsModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Activity, Utensils, Dumbbell, User as UserIcon, LogOut, ShoppingCart, Settings, Database, Library, BarChart3, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showSettings, setShowSettings] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "VitalPath";
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log("Auth state changed:", firebaseUser ? `User logged in: ${firebaseUser.uid}` : "User logged out");
      setUser(firebaseUser);
      
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (firebaseUser) {
        setLoading(true);
        setProfileError(null);
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          console.log("Fetching profile for:", firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            console.log("Profile found in Firestore.");
            setProfile(docSnap.data() as UserProfile);
          } else {
            console.log("No profile found in Firestore.");
            setProfile(null);
          }

          // Subscribe to real-time updates
          unsubscribeProfile = onSnapshot(docRef, (snap) => {
            if (snap.exists()) {
              console.log("Profile updated via snapshot.");
              setProfile(snap.data() as UserProfile);
              setProfileError(null);
            } else {
              console.log("Profile deleted or missing in snapshot.");
              // Only set to null if we are sure it doesn't exist (e.g. not a transient error)
              // onSnapshot handles its own errors via the second callback
            }
          }, (err) => {
            console.error("Profile snapshot error:", err);
            setProfileError("Failed to sync profile. Please check your connection.");
          });
        } catch (error: any) {
          console.error("Profile loading error:", error);
          setProfileError("Failed to load profile. Please refresh the page.");
        } finally {
          setLoading(false);
        }
      } else {
        setProfile(null);
        setProfileError(null);
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
          
          {authError && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100">
              {authError}
            </div>
          )}

          <button
            onClick={async () => {
              try {
                setAuthError(null);
                await signInWithGoogle();
              } catch (error: any) {
                console.error("Login error:", error);
                if (error.code === 'auth/popup-blocked') {
                  setAuthError("Popup blocked! Please allow popups for this site.");
                } else if (error.code === 'auth/unauthorized-domain') {
                  setAuthError(`Domain not authorized. Please add ${window.location.hostname} to authorized domains in Firebase Console.`);
                } else if (error.code === 'auth/popup-closed-by-user') {
                  setAuthError("Login popup was closed. If you're using Safari, try opening this app in a new tab using the button in the top right.");
                } else {
                  setAuthError(error.message || "An error occurred during login.");
                }
              }
            }}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-colors flex items-center justify-center gap-3"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
          <p className="mt-4 text-[10px] text-[#141414]/30 uppercase tracking-widest px-4">
            Having trouble? Try opening this app in a **new tab** using the button in the top right.
          </p>
          <p className="mt-2 text-[10px] text-[#141414]/20 uppercase tracking-widest">
            Make sure popups are enabled
          </p>
        </motion.div>
      </div>
    );
  }

  if (profileError && !profile) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <X className="text-red-500 w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-[#141414] mb-2">Connection Error</h2>
          <p className="text-[#141414]/60 mb-8">{profileError}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-4 bg-[#141414] text-white rounded-xl font-medium hover:bg-[#141414]/90 transition-colors"
          >
            Retry Connection
          </button>
          <button
            onClick={logout}
            className="w-full mt-4 py-2 text-[#141414]/40 hover:text-[#141414] transition-colors text-sm font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <ProfileSetup user={user} onComplete={(p) => setProfile(p)} />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard profile={profile} onNavigate={setActiveTab} />;
      case 'trends': return (
        <div className="space-y-8">
          <header className="text-center md:text-left">
            <h1 className="text-3xl lg:text-4xl font-sans font-bold text-[#141414] tracking-tight">Trends</h1>
          </header>
          <VitalsTracker profile={profile} />
        </div>
      );
      case 'meals': return <MealPlanner profile={profile} />;
      case 'foodbank': return <FoodBank profile={profile} />;
      case 'liftbank': return <LiftBank profile={profile} />;
      case 'workouts': return <WorkoutCoach profile={profile} />;
      default: return <Dashboard profile={profile} onNavigate={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex flex-col md:flex-row">
      {/* Sidebar - Desktop Only */}
      <nav className="hidden md:flex w-64 bg-white border-r border-[#141414]/10 flex-col shrink-0 h-screen sticky top-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center shrink-0">
            <Activity className="text-white w-5 h-5" />
          </div>
          <span className="font-sans font-bold text-[#141414] tracking-tight text-xl">VitalPath</span>
        </div>

        <div className="flex-1 px-3 space-y-1">
          <NavItem
            active={activeTab === 'dashboard'}
            onClick={() => setActiveTab('dashboard')}
            icon={<Activity size={20} />}
            label="Dashboard"
          />
          <NavItem
            active={activeTab === 'trends'}
            onClick={() => setActiveTab('trends')}
            icon={<BarChart3 size={20} />}
            label="Trends"
          />
          <NavItem
            active={activeTab === 'meals'}
            onClick={() => setActiveTab('meals')} 
            icon={<Utensils size={20} />} 
            label="Meal Plan" 
          />
          <NavItem 
            active={activeTab === 'workouts'} 
            onClick={() => setActiveTab('workouts')} 
            icon={<Dumbbell size={20} />} 
            label="Workouts" 
          />
          <NavItem
            active={activeTab === 'foodbank'}
            onClick={() => setActiveTab('foodbank')}
            icon={<Database size={20} />}
            label="Food Bank"
          />
          <NavItem
            active={activeTab === 'liftbank'}
            onClick={() => setActiveTab('liftbank')}
            icon={<Library size={20} />}
            label="Lift Bank"
          />
        </div>

        <div className="p-4 border-t border-[#141414]/10 space-y-2">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#141414]/5 group relative">
            <div className="w-10 h-10 bg-[#141414] rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
              {profile.photoURL ? (
                <img 
                  src={profile.photoURL} 
                  alt={profile.displayName} 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <UserIcon className="text-white w-5 h-5" />
              )}
            </div>
            <div className="hidden md:block flex-1 min-w-0">
              <p className="text-sm font-bold text-[#141414] truncate">{profile.displayName}</p>
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
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </nav>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-6 left-4 right-4 bg-white/80 backdrop-blur-xl border border-[#141414]/10 rounded-2xl shadow-2xl z-50 flex items-center justify-around p-2">
        <MobileNavItem
          active={activeTab === 'dashboard'}
          onClick={() => setActiveTab('dashboard')}
          icon={<Activity size={20} />}
        />
        <MobileNavItem
          active={activeTab === 'trends'}
          onClick={() => setActiveTab('trends')}
          icon={<BarChart3 size={20} />}
        />
        <MobileNavItem
          active={activeTab === 'meals'}
          onClick={() => setActiveTab('meals')} 
          icon={<Utensils size={20} />} 
        />
        <MobileNavItem 
          active={activeTab === 'workouts'} 
          onClick={() => setActiveTab('workouts')} 
          icon={<Dumbbell size={20} />} 
        />
        <MobileNavItem
          active={activeTab === 'foodbank'}
          onClick={() => setActiveTab('foodbank')}
          icon={<Database size={20} />}
        />
        <MobileNavItem
          active={activeTab === 'liftbank'}
          onClick={() => setActiveTab('liftbank')}
          icon={<Library size={20} />}
        />
        <button
          onClick={() => setShowSettings(true)}
          className="p-3 text-[#141414]/40"
        >
          <Settings size={20} />
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-32 md:pb-8">
        <div className="max-w-6xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ErrorBoundary resetKey={activeTab}>
                {renderContent()}
              </ErrorBoundary>
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
      <span className="font-medium">{label}</span>
      {active && (
        <motion.div 
          layoutId="active-pill"
          className="ml-auto w-1.5 h-1.5 bg-white rounded-full"
        />
      )}
    </button>
  );
}

function MobileNavItem({ active, onClick, icon }: { active: boolean, onClick: () => void, icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-xl relative transition-all ${
        active 
          ? 'text-[#141414]' 
          : 'text-[#141414]/30 hover:text-[#141414]'
      }`}
    >
      {icon}
      {active && (
        <motion.div 
          layoutId="active-pill-mobile"
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-[#141414] rounded-full"
        />
      )}
    </button>
  );
}

