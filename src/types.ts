export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Gender = 'male' | 'female' | 'other';
export type GoalDirection = 'cut' | 'bulk' | 'recomp';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  age?: number;
  height?: number; // Height in inches
  gender?: Gender;
  activityLevel?: ActivityLevel;
  goalBodyFat?: number;
  dailyStepsGoal?: number;
  targetDate?: string;
  activeMealPlanId?: string;
  activeWorkoutId?: string;
  createdAt: string;
  // Goal baseline + targets. Snapshot-style: captured once at goal start
  // and re-derived only when target_bf changes (target_weight) — never silently
  // overwritten on every dashboard load.
  goalStartWeight?: number;   // pounds
  goalStartBodyFat?: number;  // %
  goalStartDate?: string;     // ISO date
  targetWeight?: number;      // pounds, derived OR user-set
  goalDirection?: GoalDirection;
}

export interface VitalLog {
  id: string;
  date: string;
  weight: number;
  bodyFat?: number;
  muscleMass?: number;
}

export interface MealIngredient {
  name: string;
  amount: string;
}

export interface Meal {
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  fiber?: number;
  recipe: string;
  ingredients: string[];
  ingredientsWithAmounts?: MealIngredient[];
  status?: 'pending' | 'completed' | 'skipped';
}

export interface DayPlan {
  day: string;
  meals: Meal[];
  status?: 'pending' | 'completed' | 'skipped';
}

export interface MealPlan {
  id: string;
  weekStartDate: string;
  updatedAt: string;
  dailyCalories: number;
  macros: {
    protein: number;
    carbs: number;
    fats: number;
    fiber: number;
  };
  days: DayPlan[];
}

export interface GroceryItem {
  name: string;
  category: string;
  amount: string;
  checked: boolean;
}

export interface GroceryList {
  id: string;
  weekStartDate: string;
  items: GroceryItem[];
}

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  weight?: string;
  setWeights?: number[];
  setReps?: number[];
  completedSets?: boolean[];
  prescribedWeight?: number;
  consecutiveHits?: number;
  consecutiveDrops?: number;
  notes?: string;
  status?: 'pending' | 'completed';
}

export interface WorkoutDay {
  day: string;
  title: string;
  exercises: Exercise[];
  notes?: string;
  status?: 'pending' | 'completed' | 'skipped';
}

export interface WorkoutPlan {
  id: string;
  weekStartDate: string;
  updatedAt: string;
  days: WorkoutDay[];
  restBackup?: {
    day: string;
    days: WorkoutDay[];
  };
}

export type LiftCategory = 'push' | 'pull' | 'legs';
export type LiftEquipment = 'barbell' | 'dumbbell' | 'bodyweight' | 'machine' | 'cable' | 'kettlebell' | 'other';

export interface LiftBankItem {
  id: string;
  name: string;
  category: LiftCategory;
  equipment?: LiftEquipment;
  defaultSets?: number;
  defaultReps?: string;
  muscleGroups?: string[];
  notes?: string;
  hidden?: boolean;
}

export interface FoodBankItem {
  id: string;
  name: string;
  servingSize: number;
  servingUnit: 'g' | 'oz' | 'unit' | 'ml';
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  mealTypes?: ('B' | 'L' | 'D')[];
  category?: 'protein' | 'carb' | 'veg' | 'fat' | 'condiment';
  hidden?: boolean;
}
