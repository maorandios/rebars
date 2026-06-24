"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { mockMeshZones, mockSlabGeometry } from "@/data/mockStructureData";
import {
  slabGeometryFromBoundaryLayer,
  slabGeometryFromVisibleUnderlayLayers
} from "@/lib/dxf-parser";
import { compareBaseMeshOrientations } from "@/lib/geometry/mesh-sheet-layout";
import type {
  BaseMeshSettings,
  BaseMeshSettingsUpdate,
  ExportedReinforcementConfiguration,
  MeshZone,
  MeshZoneUpdate,
  Point,
  SlabGeometry
} from "@/types/structure";

type ReinforcementContextValue = {
  slabGeometry: SlabGeometry;
  meshZones: MeshZone[];
  activeZoneId: string;
  activeMeshZone: MeshZone;
  isDrawingZone: boolean;
  isDrawingBoundary: boolean;
  isEditingBoundary: boolean;
  boundaryDraftPoints: Point[];
  beginDrawingZone: () => void;
  cancelDrawingZone: () => void;
  commitDrawnMeshZone: (geometry: MeshZone["geometry"]) => void;
  beginBoundaryTrace: () => void;
  cancelBoundaryTrace: () => void;
  addBoundaryTracePoint: (point: Point) => void;
  finishBoundaryTrace: () => boolean;
  beginBoundaryEdit: () => void;
  finishBoundaryEdit: () => void;
  updateCalculatedBoundaryPoint: (index: number, point: Point) => void;
  setCalculatedSlabVisible: (visible: boolean) => void;
  deleteCalculatedSlab: () => boolean;
  importSlabGeometry: (slabGeometry: SlabGeometry) => void;
  generateSlabFromVisibleLayers: () => boolean;
  activateBaseMeshOnWorkingSlab: () => boolean;
  selectSlabBoundaryLayer: (layerName: string) => boolean;
  setActiveZoneId: (zoneId: string) => void;
  setUnderlayLayerVisible: (layerName: string, visible: boolean) => void;
  updateActiveMeshZone: (patch: MeshZoneUpdate) => void;
  updateActiveMeshZoneParameters: (patch: BaseMeshSettingsUpdate) => void;
  resetToMockData: () => void;
  exportConfiguration: () => ExportedReinforcementConfiguration;
};

const ReinforcementContext = createContext<ReinforcementContextValue | null>(
  null
);

function cloneSlabGeometry() {
  return structuredClone(mockSlabGeometry);
}

function cloneMeshZones() {
  return structuredClone(mockMeshZones);
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

function withRecommendedZoneOrientation(
  slabGeometry: SlabGeometry,
  zone: MeshZone
): MeshZone {
  return {
    ...zone,
    parameters: withRecommendedOrientation(slabGeometry, zone.parameters)
  };
}

function createDrawnZone(
  slabGeometry: SlabGeometry,
  index: number,
  geometry: MeshZone["geometry"],
  baseParameters: BaseMeshSettings
): MeshZone {
  return withRecommendedZoneOrientation(slabGeometry, {
    id: `ZONE-${String(index + 1).padStart(2, "0")}`,
    name: `אזור מחוזק ${index}`,
    isMainZone: false,
    geometry,
    parameters: {
      ...baseParameters,
      diameter: 12,
      gridOffsetX: 0,
      gridOffsetY: 0
    }
  });
}

function createMainZoneForSlab(
  slabGeometry: SlabGeometry,
  baseParameters: BaseMeshSettings
): MeshZone {
  return withRecommendedZoneOrientation(slabGeometry, {
    id: "ZONE-MAIN",
    name: "אזור ראשי",
    isMainZone: true,
    geometry: slabGeometry.boundary,
    parameters: {
      ...baseParameters,
      gridOffsetX: 0,
      gridOffsetY: 0
    }
  });
}

const calculatedSlabLayer = "CALCULATED-SLAB";

function calculatedSlabLine(boundary: Point[]) {
  return {
    id: `${calculatedSlabLayer}-BOUNDARY`,
    layer: calculatedSlabLayer,
    color: "#38bdf8",
    lineWeightPx: 2,
    points: boundary[0] ? [...boundary, boundary[0]] : boundary
  };
}

function isCalculatedSlabLayer(layerName: string) {
  return layerName === calculatedSlabLayer;
}

function boundaryFromUnderlayBounds(slabGeometry: SlabGeometry) {
  const bounds = slabGeometry.dwgUnderlay?.bounds;

  if (!bounds) {
    return slabGeometry.boundary;
  }

  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
}

export function ReinforcementProvider({ children }: { children: ReactNode }) {
  const [slabGeometry, setSlabGeometry] = useState<SlabGeometry>(() =>
    cloneSlabGeometry()
  );
  const [meshZones, setMeshZones] = useState<MeshZone[]>(() =>
    cloneMeshZones().map((zone) =>
      withRecommendedZoneOrientation(cloneSlabGeometry(), zone)
    )
  );
  const [activeZoneId, setActiveZoneId] = useState(() => cloneMeshZones()[0].id);
  const [isDrawingZone, setIsDrawingZone] = useState(false);
  const [isDrawingBoundary, setIsDrawingBoundary] = useState(false);
  const [isEditingBoundary, setIsEditingBoundary] = useState(false);
  const [boundaryDraftPoints, setBoundaryDraftPoints] = useState<Point[]>([]);
  const activeMeshZone =
    meshZones.find((zone) => zone.id === activeZoneId) ?? meshZones[0];

  const updateActiveMeshZone = useCallback(
    (patch: MeshZoneUpdate) => {
      setMeshZones((current) =>
        current.map((zone) => {
          if (zone.id !== activeZoneId) {
            return zone;
          }

          const nextZone = {
            ...zone,
            ...patch,
            parameters: {
              ...zone.parameters,
              ...patch.parameters
            }
          };

          if (patch.parameters && !("orientation" in patch.parameters)) {
            return withRecommendedZoneOrientation(slabGeometry, nextZone);
          }

          return nextZone;
        })
      );
    },
    [activeZoneId, slabGeometry]
  );

  const updateActiveMeshZoneParameters = useCallback(
    (patch: BaseMeshSettingsUpdate) => {
      updateActiveMeshZone({ parameters: patch });
    },
    [updateActiveMeshZone]
  );

  const beginDrawingZone = useCallback(() => {
    setIsDrawingZone(true);
  }, []);

  const cancelDrawingZone = useCallback(() => {
    setIsDrawingZone(false);
  }, []);

  const commitDrawnMeshZone = useCallback(
    (geometry: MeshZone["geometry"]) => {
      setMeshZones((current) => {
        const nextZone = createDrawnZone(
          slabGeometry,
          current.length,
          geometry,
          activeMeshZone.parameters
        );

        setActiveZoneId(nextZone.id);
        return [...current, nextZone];
      });
      setIsDrawingZone(false);
    },
    [activeMeshZone.parameters, slabGeometry]
  );

  const beginBoundaryTrace = useCallback(() => {
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(true);
    setIsDrawingZone(false);
  }, []);

  const cancelBoundaryTrace = useCallback(() => {
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(false);
  }, []);

  const addBoundaryTracePoint = useCallback((point: Point) => {
    setBoundaryDraftPoints((current) => [...current, point]);
  }, []);

  const finishBoundaryTrace = useCallback(() => {
    if (boundaryDraftPoints.length < 3) {
      return false;
    }

    const nextUnderlay = slabGeometry.dwgUnderlay
      ? {
          ...slabGeometry.dwgUnderlay,
          reviewOnly: false,
          lines: [
            ...slabGeometry.dwgUnderlay.lines.filter(
              (line) => line.layer !== calculatedSlabLayer
            ),
            calculatedSlabLine(boundaryDraftPoints)
          ],
          layers: [
            ...(slabGeometry.dwgUnderlay.layers ?? []).filter(
              (layer) => layer.name !== calculatedSlabLayer
            ),
            { entityCount: 1, name: calculatedSlabLayer, visible: true }
          ].sort((a, b) => a.name.localeCompare(b.name))
        }
      : undefined;
    const nextSlabGeometry: SlabGeometry = {
      ...slabGeometry,
      boundary: boundaryDraftPoints,
      dwgUnderlay: nextUnderlay,
      hasActiveSlabBoundary: true,
      meshBoundary: undefined,
      meshInteriorBoundary: undefined,
      openings: [],
      structuralElements: []
    };
    const nextMainZone = createMainZoneForSlab(
      nextSlabGeometry,
      activeMeshZone.parameters
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones([nextMainZone]);
    setActiveZoneId(nextMainZone.id);
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingZone(false);
    return true;
  }, [activeMeshZone.parameters, boundaryDraftPoints, slabGeometry]);

  const beginBoundaryEdit = useCallback(() => {
    if (!slabGeometry.hasActiveSlabBoundary) {
      return;
    }

    setIsEditingBoundary(true);
    setIsDrawingBoundary(false);
    setIsDrawingZone(false);
    setBoundaryDraftPoints([]);
  }, [slabGeometry.hasActiveSlabBoundary]);

  const finishBoundaryEdit = useCallback(() => {
    setIsEditingBoundary(false);
  }, []);

  const updateCalculatedBoundaryPoint = useCallback(
    (index: number, point: Point) => {
      if (!slabGeometry.hasActiveSlabBoundary) {
        return;
      }

      const nextBoundary = slabGeometry.boundary.map((boundaryPoint, pointIndex) =>
        pointIndex === index ? point : boundaryPoint
      );
      const nextUnderlay = slabGeometry.dwgUnderlay
        ? {
            ...slabGeometry.dwgUnderlay,
            lines: [
              ...slabGeometry.dwgUnderlay.lines.filter(
                (line) => !isCalculatedSlabLayer(line.layer)
              ),
              calculatedSlabLine(nextBoundary)
            ]
          }
        : undefined;
      const nextSlabGeometry: SlabGeometry = {
        ...slabGeometry,
        boundary: nextBoundary,
        dwgUnderlay: nextUnderlay,
        meshBoundary: undefined,
        meshInteriorBoundary: undefined
      };
      const nextMainZone = createMainZoneForSlab(
        nextSlabGeometry,
        activeMeshZone.parameters
      );

      setSlabGeometry(nextSlabGeometry);
      setMeshZones([nextMainZone]);
      setActiveZoneId(nextMainZone.id);
    },
    [activeMeshZone.parameters, slabGeometry]
  );

  const setCalculatedSlabVisible = useCallback((visible: boolean) => {
    setSlabGeometry((current) => {
      if (!current.dwgUnderlay?.layers) {
        return current;
      }

      return {
        ...current,
        dwgUnderlay: {
          ...current.dwgUnderlay,
          layers: current.dwgUnderlay.layers.map((layer) =>
            isCalculatedSlabLayer(layer.name) ? { ...layer, visible } : layer
          )
        }
      };
    });
  }, []);

  const deleteCalculatedSlab = useCallback(() => {
    if (!slabGeometry.dwgUnderlay) {
      return false;
    }

    const nextUnderlay = {
      ...slabGeometry.dwgUnderlay,
      reviewOnly: true,
      lines: slabGeometry.dwgUnderlay.lines.filter(
        (line) => !isCalculatedSlabLayer(line.layer)
      ),
      layers: (slabGeometry.dwgUnderlay.layers ?? []).filter(
        (layer) => !isCalculatedSlabLayer(layer.name)
      )
    };
    const nextSlabGeometry: SlabGeometry = {
      ...slabGeometry,
      boundary: boundaryFromUnderlayBounds(slabGeometry),
      dwgUnderlay: nextUnderlay,
      hasActiveSlabBoundary: false,
      meshBoundary: undefined,
      meshInteriorBoundary: undefined,
      openings: [],
      structuralElements: []
    };
    const nextMainZone = createMainZoneForSlab(
      nextSlabGeometry,
      activeMeshZone.parameters
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones([nextMainZone]);
    setActiveZoneId(nextMainZone.id);
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingZone(false);
    return true;
  }, [activeMeshZone.parameters, slabGeometry]);

  const importSlabGeometry = useCallback(
    (nextSlabGeometry: SlabGeometry) => {
      const baseParameters = activeMeshZone.parameters;
      const nextMainZone = createMainZoneForSlab(
        nextSlabGeometry,
        baseParameters
      );

      setSlabGeometry(nextSlabGeometry);
      setMeshZones([nextMainZone]);
      setActiveZoneId(nextMainZone.id);
      setIsDrawingZone(false);
      setIsDrawingBoundary(false);
      setIsEditingBoundary(false);
      setBoundaryDraftPoints([]);
    },
    [activeMeshZone.parameters]
  );

  const selectSlabBoundaryLayer = useCallback(
    (layerName: string) => {
      const nextSlabGeometry = slabGeometryFromBoundaryLayer(
        slabGeometry,
        layerName
      );

      if (!nextSlabGeometry) {
        return false;
      }

      const nextMainZone = createMainZoneForSlab(
        nextSlabGeometry,
        activeMeshZone.parameters
      );

      setSlabGeometry(nextSlabGeometry);
      setMeshZones([nextMainZone]);
      setActiveZoneId(nextMainZone.id);
      setIsDrawingZone(false);
      setIsDrawingBoundary(false);
      setIsEditingBoundary(false);
      setBoundaryDraftPoints([]);
      return true;
    },
    [activeMeshZone.parameters, slabGeometry]
  );

  const generateSlabFromVisibleLayers = useCallback(() => {
    const generatedSlabGeometry =
      slabGeometryFromVisibleUnderlayLayers(slabGeometry);

    if (!generatedSlabGeometry) {
      return false;
    }

    const nextSlabGeometry = generatedSlabGeometry;
    const nextMainZone = createMainZoneForSlab(
      nextSlabGeometry,
      activeMeshZone.parameters
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones([nextMainZone]);
    setActiveZoneId(nextMainZone.id);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setBoundaryDraftPoints([]);
    return true;
  }, [activeMeshZone.parameters, slabGeometry]);

  const activateBaseMeshOnWorkingSlab = useCallback(() => {
    if (!slabGeometry.hasActiveSlabBoundary || !slabGeometry.dwgUnderlay) {
      return false;
    }

    const nextSlabGeometry: SlabGeometry = {
      ...slabGeometry,
      dwgUnderlay: {
        ...slabGeometry.dwgUnderlay,
        reviewOnly: false
      }
    };
    const nextMainZone = createMainZoneForSlab(
      nextSlabGeometry,
      activeMeshZone.parameters
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones([nextMainZone]);
    setActiveZoneId(nextMainZone.id);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setBoundaryDraftPoints([]);
    return true;
  }, [activeMeshZone.parameters, slabGeometry]);

  const setUnderlayLayerVisible = useCallback(
    (layerName: string, visible: boolean) => {
      setSlabGeometry((current) => {
        if (!current.dwgUnderlay?.layers) {
          return current;
        }

        return {
          ...current,
          dwgUnderlay: {
            ...current.dwgUnderlay,
            layers: current.dwgUnderlay.layers.map((layer) =>
              layer.name === layerName ? { ...layer, visible } : layer
            )
          }
        };
      });
    },
    []
  );

  const resetToMockData = useCallback(() => {
    const nextSlabGeometry = cloneSlabGeometry();
    const nextZones = cloneMeshZones().map((zone) =>
      withRecommendedZoneOrientation(nextSlabGeometry, zone)
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones(nextZones);
    setActiveZoneId(nextZones[0].id);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setBoundaryDraftPoints([]);
  }, []);

  const exportConfiguration = useCallback(
    () => ({
      exportedAt: new Date().toISOString(),
      standard: "IS-466" as const,
      slabGeometry,
      meshZones,
      activeZoneId
    }),
    [activeZoneId, meshZones, slabGeometry]
  );

  const value = useMemo(
    () => ({
      slabGeometry,
      meshZones,
      activeZoneId,
      activeMeshZone,
      isDrawingZone,
      isDrawingBoundary,
      isEditingBoundary,
      boundaryDraftPoints,
      beginDrawingZone,
      cancelDrawingZone,
      commitDrawnMeshZone,
      beginBoundaryTrace,
      cancelBoundaryTrace,
      addBoundaryTracePoint,
      finishBoundaryTrace,
      beginBoundaryEdit,
      finishBoundaryEdit,
      updateCalculatedBoundaryPoint,
      setCalculatedSlabVisible,
      deleteCalculatedSlab,
      activateBaseMeshOnWorkingSlab,
      generateSlabFromVisibleLayers,
      importSlabGeometry,
      selectSlabBoundaryLayer,
      setActiveZoneId,
      setUnderlayLayerVisible,
      updateActiveMeshZone,
      updateActiveMeshZoneParameters,
      resetToMockData,
      exportConfiguration
    }),
    [
      slabGeometry,
      meshZones,
      activeZoneId,
      activeMeshZone,
      isDrawingZone,
      isDrawingBoundary,
      isEditingBoundary,
      boundaryDraftPoints,
      beginDrawingZone,
      cancelDrawingZone,
      commitDrawnMeshZone,
      beginBoundaryTrace,
      cancelBoundaryTrace,
      addBoundaryTracePoint,
      finishBoundaryTrace,
      beginBoundaryEdit,
      finishBoundaryEdit,
      updateCalculatedBoundaryPoint,
      setCalculatedSlabVisible,
      deleteCalculatedSlab,
      activateBaseMeshOnWorkingSlab,
      generateSlabFromVisibleLayers,
      importSlabGeometry,
      selectSlabBoundaryLayer,
      setUnderlayLayerVisible,
      updateActiveMeshZone,
      updateActiveMeshZoneParameters,
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
