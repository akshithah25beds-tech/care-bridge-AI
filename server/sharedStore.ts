import fs from 'node:fs';
import path from 'node:path';
import { createSeedState } from '../src/core/seedData';
import { computeDashboardMetrics } from '../src/core/coordinatorRules';
import { DashboardMetrics, SharedCareState } from '../src/types/carebridge';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'carebridge-db.json');

let memoryStore: SharedCareState | null = null;

function ensureLoaded(): SharedCareState {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as SharedCareState;
      if (parsed && Array.isArray(parsed.cases)) {
        memoryStore = parsed;
        return memoryStore;
      }
    }
  } catch (err) {
    console.warn('Could not read persisted store, re-seeding:', err);
  }
  memoryStore = createSeedState();
  persistStore(memoryStore);
  return memoryStore;
}

function persistStore(state: SharedCareState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to persist store:', err);
  }
}

export function getSharedState(): SharedCareState & { metrics: DashboardMetrics } {
  const state = ensureLoaded();
  return {
    ...state,
    metrics: computeDashboardMetrics(state),
  };
}

export function mutateSharedState(
  updater: (draft: SharedCareState) => void
): SharedCareState & { metrics: DashboardMetrics } {
  const current = ensureLoaded();
  updater(current);
  persistStore(current);
  return {
    ...current,
    metrics: computeDashboardMetrics(current),
  };
}

export function resetSharedState(ownerId?: string): SharedCareState & { metrics: DashboardMetrics } {
  memoryStore = createSeedState(ownerId || 'demo_clinic_owner');
  persistStore(memoryStore);
  return {
    ...memoryStore,
    metrics: computeDashboardMetrics(memoryStore),
  };
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
