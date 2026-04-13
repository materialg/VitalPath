export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Gender = 'male' | 'female' | 'other';

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
  targetDate?: string;
  activeMealPlanId?: string;
  createdAt: string;
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
  notes?: string;
}

export interface WorkoutPlan {
  id: string;
  date: string;
  title: string;
  exercises: Exercise[];
  status?: 'pending' | 'completed' | 'skipped';
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
}
