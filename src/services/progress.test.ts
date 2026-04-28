import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateProgress, deriveTargetWeight, timelineProgress, progressDirectionFor } from './progress';

// --- calculateProgress ---

test('cut: halfway from 200 → 180 reads ~50%', () => {
  assert.equal(calculateProgress(200, 190, 180, 'down'), 50);
});

test('cut: at the start reads 0%', () => {
  assert.equal(calculateProgress(200, 200, 180, 'down'), 0);
});

test('cut: at the target reads 100%', () => {
  assert.equal(calculateProgress(200, 180, 180, 'down'), 100);
});

test('cut regression: current heavier than start reads 0%', () => {
  assert.equal(calculateProgress(200, 205, 180, 'down'), 0);
});

test('cut overshoot: current below target reads 100%', () => {
  assert.equal(calculateProgress(200, 175, 180, 'down'), 100);
});

test('bulk: gaining toward target reads partial progress', () => {
  assert.equal(calculateProgress(150, 160, 170, 'up'), 50);
});

test('bulk regression: lighter than start reads 0%', () => {
  assert.equal(calculateProgress(150, 145, 170, 'up'), 0);
});

test('bulk overshoot: above target reads 100%', () => {
  assert.equal(calculateProgress(150, 175, 170, 'up'), 100);
});

test('start == target (no goal) reads 0%', () => {
  assert.equal(calculateProgress(180, 180, 180, 'down'), 0);
});

test('NaN inputs read 0%', () => {
  assert.equal(calculateProgress(NaN, 180, 170, 'down'), 0);
  assert.equal(calculateProgress(200, NaN, 170, 'down'), 0);
  assert.equal(calculateProgress(200, 180, NaN, 'down'), 0);
});

test("misconfigured 'down' (target above start) reads 0%", () => {
  assert.equal(calculateProgress(180, 175, 200, 'down'), 0);
});

test("misconfigured 'up' (target below start) reads 0%", () => {
  assert.equal(calculateProgress(200, 195, 180, 'up'), 0);
});

// --- deriveTargetWeight ---

test('lean-mass formula: 200 lb @ 20%bf → 15%bf gives ~188.2 lb', () => {
  // lean = 200 * 0.8 = 160 ;  target = 160 / 0.85 ≈ 188.2
  assert.equal(deriveTargetWeight(200, 20, 15), 188.2);
});

test('deriveTargetWeight clamps invalid inputs', () => {
  assert.equal(deriveTargetWeight(-1, 20, 15), null);
  assert.equal(deriveTargetWeight(200, 100, 15), null);
  assert.equal(deriveTargetWeight(200, 20, 100), null);
  assert.equal(deriveTargetWeight(NaN, 20, 15), null);
});

// --- timelineProgress ---

test('timeline: midway between start and end reads ~50%', () => {
  const start = '2026-01-01T00:00:00Z';
  const end   = '2026-03-01T00:00:00Z';
  const now   = new Date('2026-01-31T00:00:00Z'); // ~50% of a 59-day window
  const pct   = timelineProgress(start, end, now);
  assert.ok(pct >= 49 && pct <= 52, `expected ~50, got ${pct}`);
});

test('timeline: before start reads 0%', () => {
  const now = new Date('2025-12-01T00:00:00Z');
  assert.equal(timelineProgress('2026-01-01', '2026-03-01', now), 0);
});

test('timeline: past end reads 100%', () => {
  const now = new Date('2026-04-01T00:00:00Z');
  assert.equal(timelineProgress('2026-01-01', '2026-03-01', now), 100);
});

test('timeline: missing dates read 0%', () => {
  assert.equal(timelineProgress(undefined, '2026-03-01'), 0);
  assert.equal(timelineProgress('2026-01-01', undefined), 0);
});

// --- progressDirectionFor ---

test('cut maps to down for both metrics', () => {
  assert.equal(progressDirectionFor('cut', 'weight'), 'down');
  assert.equal(progressDirectionFor('cut', 'bodyFat'), 'down');
});

test('bulk: weight is up, bf is null (no meaningful direction)', () => {
  assert.equal(progressDirectionFor('bulk', 'weight'), 'up');
  assert.equal(progressDirectionFor('bulk', 'bodyFat'), null);
});

test('recomp: bf is down, weight is null (weight stable)', () => {
  assert.equal(progressDirectionFor('recomp', 'bodyFat'), 'down');
  assert.equal(progressDirectionFor('recomp', 'weight'), null);
});
