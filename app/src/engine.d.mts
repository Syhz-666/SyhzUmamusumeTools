import type { Catalog, Character, Draft, Race, Goal, Route, Branch } from './types';
export const scenarios: { id: string; name: string; subtitle: string }[];
export const years: string[];
export const slotOf: (p: { year: number; month: number; half: string }) => number;
export const dateLabel: (s: number) => string;
export const isCamp: (s: number) => boolean;
export const defaultAptitudes: (c: Character) => Record<string, string>;
export const emptyDraft: (c: Character) => Draft;
export const aptitude: (r: Race, d: Draft) => string[];
export const suited: (r: Race, d: Draft) => boolean;
export interface GoalEntry extends Goal {
  raceId?: string;
}
export interface Context {
  fixed: Record<string, GoalEntry>;
  deadlines: Goal[];
  events: Record<string, string[]>;
  branches: Branch[];
  scenario: string;
  route?: Route;
  coverage: boolean;
  end: number;
}
export const context: (c: Catalog, route: string, scenario: string, d: Draft) => Context;
export const blockReason: (s: number, r: Race, c: Context) => string;
export const available: (c: Catalog, s: number, ctx: Context) => Race[];
export const scheduleEntries: (
  c: Context,
  d: Draft,
) => Record<string, { raceId?: string; origin: string; title?: string }>;
export const createsStreak: (s: number, e: Record<string, unknown>) => boolean;
export interface Preview {
  additions: { slot: number; raceId: string }[];
  skipped: { raceId: string; reason: string }[];
  covered: string[];
}
export const planSuggestions: (c: Catalog, o: string[], ctx: Context, d: Draft) => Preview;
export const warnings: (ctx: Context, d: Draft) => string[];
export const exportText: (c: Catalog, ch: Character, ctx: Context, d: Draft) => string;
