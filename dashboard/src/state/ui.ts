// UI-only state: which section is open and which model the charts focus on.

import { create } from "zustand";
import type { ModelKey } from "../engine/types";

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models & Metrics" },
  { id: "patterns", label: "Trend & Seasonality" },
  { id: "features", label: "Feature Engineering" },
  { id: "regions", label: "Regions & Distribution" },
  { id: "data", label: "Live Data Feed" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

interface UiState {
  section: SectionId;
  /** null = follow the recommended model */
  focusModel: ModelKey | null;
  controlsOpen: boolean;
  setSection: (s: SectionId) => void;
  setFocusModel: (m: ModelKey | null) => void;
  setControlsOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  section: "overview",
  focusModel: null,
  controlsOpen: false,
  setSection: (section) => set({ section }),
  setFocusModel: (focusModel) => set({ focusModel }),
  setControlsOpen: (controlsOpen) => set({ controlsOpen }),
}));
