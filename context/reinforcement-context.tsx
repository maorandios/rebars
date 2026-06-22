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
import { compareBaseMeshOrientations } from "@/lib/geometry/mesh-sheet-layout";
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

function withRecommendedOrientation(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings
) {
  return {
    ...settings,
    orientation: compareBaseMeshOrientations(slabGeometry, settings)
      .recommendedOrientation
  };
}

export function ReinforcementProvider({ children }: { children: ReactNode }) {
  const [slabGeometry, setSlabGeometry] = useState<SlabGeometry>(() =>
    cloneSlabGeometry()
  );
  const [baseMeshSettings, setBaseMeshSettings] =
    useState<BaseMeshSettings>(() =>
      withRecommendedOrientation(cloneSlabGeometry(), cloneBaseMeshSettings())
    );

  const updateBaseMeshSettings = useCallback(
    (patch: BaseMeshSettingsUpdate) => {
      setBaseMeshSettings((current) => {
        const nextSettings = { ...current, ...patch };

        if ("orientation" in patch) {
          return nextSettings;
        }

        return withRecommendedOrientation(slabGeometry, nextSettings);
      });
    },
    [slabGeometry]
  );

  const resetToMockData = useCallback(() => {
    const nextSlabGeometry = cloneSlabGeometry();

    setSlabGeometry(nextSlabGeometry);
    setBaseMeshSettings(
      withRecommendedOrientation(nextSlabGeometry, cloneBaseMeshSettings())
    );
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
