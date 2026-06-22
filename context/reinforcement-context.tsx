"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import {
  mockBaseMeshSettings,
  mockSlabGeometry
} from "@/data/mockStructureData";
import type {
  BaseMeshSettings,
  BaseMeshSettingsUpdate,
  ExportedReinforcementConfiguration,
  SlabGeometry
} from "@/types/structure";

type ReinforcementContextValue = {
  slabGeometry: SlabGeometry;
  baseMeshSettings: BaseMeshSettings;
  updateBaseMeshSettings: (patch: BaseMeshSettingsUpdate) => void;
  resetToMockData: () => void;
  exportConfiguration: () => ExportedReinforcementConfiguration;
};

const ReinforcementContext = createContext<ReinforcementContextValue | null>(
  null
);

function cloneSlabGeometry() {
  return structuredClone(mockSlabGeometry);
}

function cloneBaseMeshSettings() {
  return structuredClone(mockBaseMeshSettings);
}

export function ReinforcementProvider({ children }: { children: ReactNode }) {
  const [slabGeometry, setSlabGeometry] = useState<SlabGeometry>(() =>
    cloneSlabGeometry()
  );
  const [baseMeshSettings, setBaseMeshSettings] =
    useState<BaseMeshSettings>(() => cloneBaseMeshSettings());

  const updateBaseMeshSettings = useCallback(
    (patch: BaseMeshSettingsUpdate) => {
      setBaseMeshSettings((current) => ({ ...current, ...patch }));
    },
    []
  );

  const resetToMockData = useCallback(() => {
    setSlabGeometry(cloneSlabGeometry());
    setBaseMeshSettings(cloneBaseMeshSettings());
  }, []);

  const exportConfiguration = useCallback(
    () => ({
      exportedAt: new Date().toISOString(),
      standard: "IS-466" as const,
      slabGeometry,
      baseMeshSettings
    }),
    [baseMeshSettings, slabGeometry]
  );

  const value = useMemo(
    () => ({
      slabGeometry,
      baseMeshSettings,
      updateBaseMeshSettings,
      resetToMockData,
      exportConfiguration
    }),
    [
      slabGeometry,
      baseMeshSettings,
      updateBaseMeshSettings,
      resetToMockData,
      exportConfiguration
    ]
  );

  return (
    <ReinforcementContext.Provider value={value}>
      {children}
    </ReinforcementContext.Provider>
  );
}

export function useReinforcement() {
  const context = useContext(ReinforcementContext);

  if (!context) {
    throw new Error(
      "useReinforcement must be used within a ReinforcementProvider."
    );
  }

  return context;
}
