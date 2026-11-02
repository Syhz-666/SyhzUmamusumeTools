export interface Character {
  id: string;
  card_id: string;
  name: string;
  alias: string;
  rarity: number;
  portrait: string;
  turf: string;
  dirt: string;
  distances: string[];
  styles: string[];
  source: string;
}
export interface Race {
  id: string;
  trophyOrder: number;
  name: string;
  jp: string;
  alias: string;
  grade: string;
  venue: string;
  surface: string;
  distance: number;
  category: string;
  direction: string;
  fans: number;
  winner_fans: number;
  periods: { year: number; month: number; half: string }[];
  scope: string;
  trophy: string;
  banner?: string;
  source: string;
}
export interface Goal {
  title: string;
  time?: string;
  condition?: string;
  slot: number;
  kind: string;
  raceIds: string[];
}
export interface Branch {
  key: string;
  label: string;
  note: string;
  removeSlots: number[];
  defaultChoice: string;
  options: { id: string; label: string; goals: Goal[] }[];
}
export interface Route {
  id: string;
  characterId: string;
  name: string;
  source: string;
  goals: Goal[];
  branches?: Branch[];
}
export interface Catalog {
  asOf: string;
  characters: Character[];
  races: Race[];
  variants: Race[];
  routes: Route[];
  sources: { title: string; url: string }[];
  notes: string[];
  coverage: { routes: number; failedRoutes: unknown[]; assets: number; failedAssets: unknown[] };
}
export interface Entry {
  raceId: string;
  origin: 'manual' | 'suggested';
}
export interface Draft {
  entries: Record<string, Entry>;
  aptitudes: Record<string, string>;
  options: { avoidCamp: boolean; avoidStreak: boolean };
  targetIds: string[];
  branchChoices: Record<string, string>;
}
export interface State {
  version: 1;
  progress: Record<string, string[]>;
  drafts: Record<string, Draft>;
  selectedCharacter: string;
  selectedScenario: string;
  routeSelections: Record<string, string>;
}
export interface Desktop {
  load: () => Promise<{
    state: State | null;
    dataPath: string;
    error?: string;
    recovered?: boolean;
    migratedFrom?: string;
    isTestProfile?: boolean;
  }>;
  save: (state: State) => Promise<unknown>;
  restore: (state: State) => Promise<unknown>;
  exportBackup: (state: State) => Promise<boolean>;
  importBackup: () => Promise<State | null>;
  exportFile: (payload: { type: 'png' | 'txt'; data: string }) => Promise<boolean>;
  openSource: (url: string) => Promise<void>;
}
declare global {
  interface Window {
    desktop: Desktop;
  }
}
