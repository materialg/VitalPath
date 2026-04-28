import type { GoalDirection } from '../types';

export type ProgressDirection = 'down' | 'up';

/**
 * Map a goal direction onto the binary direction the progress helper understands.
 * Recomp uses 'down' for body-fat tracking (the metric that meaningfully moves);
 * the weight circle should be hidden during recomp by the caller.
 */
export function progressDirectionFor(goal: GoalDirection | undefined, metric: 'weight' | 'bodyFat'): ProgressDirection | null {
  if (goal === 'bulk') return metric === 'weight' ? 'up' : null;
  if (goal === 'recomp') return metric === 'bodyFat' ? 'down' : null;
  return 'down'; // 'cut' (default) — both metrics trend down
}

/**
 * Returns 0..100 representing how far `current` has moved from `start` toward `target`.
 * Regression (current moved away from target) → 0.
 * Overshoot (current passed target) → 100.
 * Degenerate input (start == target, NaN, etc.) → 0.
 */
export function calculateProgress(
  start: number,
  current: number,
  target: number,
  direction: ProgressDirection
): number {
  if (![start, current, target].every(Number.isFinite)) return 0;
  if (start === target) return 0;

  if (direction === 'down') {
    if (start < target) return 0;       // misconfigured: target is above start for a 'down' goal
    if (current >= start) return 0;     // regression
    if (current <= target) return 100;  // overshoot or hit
    return Math.round(((start - current) / (start - target)) * 100);
  }

  // 'up'
  if (start > target) return 0;
  if (current <= start) return 0;
  if (current >= target) return 100;
  return Math.round(((current - start) / (target - start)) * 100);
}

/**
 * Lean-mass-preserving target weight: the bodyweight you'd hit if you kept current
 * lean mass and only shed (or added) fat to reach `targetBodyFatPct`.
 *   leanMass = currentWeight * (1 - currentBF/100)
 *   target   = leanMass / (1 - targetBF/100)
 */
export function deriveTargetWeight(
  currentWeight: number,
  currentBodyFatPct: number,
  targetBodyFatPct: number
): number | null {
  if (!Number.isFinite(currentWeight) || currentWeight <= 0) return null;
  if (!Number.isFinite(currentBodyFatPct) || currentBodyFatPct < 0 || currentBodyFatPct >= 100) return null;
  if (!Number.isFinite(targetBodyFatPct) || targetBodyFatPct < 0 || targetBodyFatPct >= 100) return null;
  const leanMass = currentWeight * (1 - currentBodyFatPct / 100);
  return Math.round((leanMass / (1 - targetBodyFatPct / 100)) * 10) / 10;
}

/**
 * % of days elapsed between `startISO` and `endISO`, clamped 0..100.
 */
export function timelineProgress(startISO: string | undefined, endISO: string | undefined, now: Date = new Date()): number {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const elapsed = now.getTime() - start;
  return Math.round(Math.min(100, Math.max(0, (elapsed / (end - start)) * 100)));
}
