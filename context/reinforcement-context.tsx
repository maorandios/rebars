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
  SlabDesignArea,
  SlabDesignAreaPurpose,
  SlabGeometry
} from "@/types/structure";

type DesignAreaDrawingMode = "polygon" | "rectangle";

type ReinforcementContextValue = {
  slabGeometry: SlabGeometry;
  meshZones: MeshZone[];
  activeZoneId: string;
  activeMeshZone: MeshZone;
  selectedDesignAreaId: string | null;
  isDrawingZone: boolean;
  isDrawingBoundary: boolean;
  isEditingBoundary: boolean;
  editingDesignAreaId: string | null;
  isDrawingDesignArea: boolean;
  designAreaDrawingMode: DesignAreaDrawingMode | null;
  boundaryDraftPoints: Point[];
  designAreaDraftPoints: Point[];
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
  deleteDxfUnderlay: () => void;
  setSelectedDesignAreaId: (areaId: string | null) => void;
  setDesignAreaVisible: (areaId: string, visible: boolean) => void;
  updateDesignAreaPurpose: (
    areaId: string,
    purpose: SlabDesignAreaPurpose
  ) => void;
  deleteDesignArea: (areaId: string) => void;
  beginDesignAreaEdit: (areaId: string) => void;
  finishDesignAreaEdit: () => void;
  updateDesignAreaPoint: (areaId: string, index: number, point: Point) => void;
  createMeshZoneForDesignArea: (areaId: string) => boolean;
  beginDesignAreaDraw: (mode: DesignAreaDrawingMode) => void;
  cancelDesignAreaDraw: () => void;
  addDesignAreaDraftPoint: (point: Point) => void;
  finishDesignAreaDraft: () => boolean;
  commitDesignAreaPolygon: (
    polygon: Point[],
    purpose?: SlabDesignAreaPurpose
  ) => boolean;
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

function createMeshZoneForArea(
  slabGeometry: SlabGeometry,
  area: SlabDesignArea,
  index: number,
  baseParameters: BaseMeshSettings
): MeshZone {
  return withRecommendedZoneOrientation(slabGeometry, {
    id: `ZONE-AREA-${String(index + 1).padStart(2, "0")}`,
    name: `Mesh - ${area.label}`,
    isMainZone: false,
    geometry: area.polygon,
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
  const [selectedDesignAreaId, setSelectedDesignAreaId] = useState<string | null>(
    null
  );
  const [isDrawingZone, setIsDrawingZone] = useState(false);
  const [isDrawingBoundary, setIsDrawingBoundary] = useState(false);
  const [isEditingBoundary, setIsEditingBoundary] = useState(false);
  const [editingDesignAreaId, setEditingDesignAreaId] = useState<string | null>(
    null
  );
  const [isDrawingDesignArea, setIsDrawingDesignArea] = useState(false);
  const [designAreaDrawingMode, setDesignAreaDrawingMode] =
    useState<DesignAreaDrawingMode | null>(null);
  const [boundaryDraftPoints, setBoundaryDraftPoints] = useState<Point[]>([]);
  const [designAreaDraftPoints, setDesignAreaDraftPoints] = useState<Point[]>([]);
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
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
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
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
  }, []);

  const cancelBoundaryTrace = useCallback(() => {
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(false);
  }, []);

  const addBoundaryTracePoint = useCallback((point: Point) => {
    setBoundaryDraftPoints((current) => [...current, point]);
  }, []);

  const beginDesignAreaDraw = useCallback((mode: DesignAreaDrawingMode) => {
    setDesignAreaDraftPoints([]);
    setDesignAreaDrawingMode(mode);
    setIsDrawingDesignArea(true);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingZone(false);
    setBoundaryDraftPoints([]);
  }, []);

  const cancelDesignAreaDraw = useCallback(() => {
    setDesignAreaDraftPoints([]);
    setDesignAreaDrawingMode(null);
    setIsDrawingDesignArea(false);
  }, []);

  const addDesignAreaDraftPoint = useCallback((point: Point) => {
    setDesignAreaDraftPoints((current) => [...current, point]);
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
      designAreas: [],
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
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
    return true;
  }, [activeMeshZone.parameters, boundaryDraftPoints, slabGeometry]);

  const commitDesignAreaPolygon = useCallback(
    (polygon: Point[], purpose: SlabDesignAreaPurpose = "no-mesh") => {
      if (!slabGeometry.hasActiveSlabBoundary || polygon.length < 3) {
        return false;
      }

      const designAreas = slabGeometry.designAreas ?? [];
      const areaIndex = designAreas.length + 1;
      const nextSlabGeometry: SlabGeometry = {
        ...slabGeometry,
        designAreas: [
          ...designAreas,
          {
            id: `AREA-${String(areaIndex).padStart(2, "0")}`,
            label: `Area ${areaIndex}`,
            meshZoneId: activeZoneId,
            polygon,
            priority: areaIndex,
            purpose,
            source: "user",
            visible: true
          }
        ]
      };
      const nextMainZone = createMainZoneForSlab(
        nextSlabGeometry,
        activeMeshZone.parameters
      );

      setSlabGeometry(nextSlabGeometry);
      setMeshZones([nextMainZone]);
      setActiveZoneId(nextMainZone.id);
      setDesignAreaDraftPoints([]);
      setDesignAreaDrawingMode(null);
      setIsDrawingDesignArea(false);
      return true;
    },
    [activeMeshZone.parameters, activeZoneId, slabGeometry]
  );

  const finishDesignAreaDraft = useCallback(() => {
    return commitDesignAreaPolygon(designAreaDraftPoints);
  }, [commitDesignAreaPolygon, designAreaDraftPoints]);

  const beginBoundaryEdit = useCallback(() => {
    if (!slabGeometry.hasActiveSlabBoundary) {
      return;
    }

    setIsEditingBoundary(true);
    setIsDrawingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
    setBoundaryDraftPoints([]);
  }, [slabGeometry.hasActiveSlabBoundary]);

  const finishBoundaryEdit = useCallback(() => {
    setIsEditingBoundary(false);
  }, []);

  const setDesignAreaVisible = useCallback((areaId: string, visible: boolean) => {
    setSlabGeometry((current) => ({
      ...current,
      designAreas: (current.designAreas ?? []).map((area) =>
        area.id === areaId ? { ...area, visible } : area
      )
    }));
  }, []);

  const updateDesignAreaPurpose = useCallback(
    (areaId: string, purpose: SlabDesignAreaPurpose) => {
      setSlabGeometry((current) => ({
        ...current,
        designAreas: (current.designAreas ?? []).map((area) =>
          area.id === areaId ? { ...area, purpose } : area
        )
      }));
    },
    []
  );

  const deleteDesignArea = useCallback(
    (areaId: string) => {
      const linkedMeshZoneId = (slabGeometry.designAreas ?? []).find(
        (area) => area.id === areaId
      )?.meshZoneId;

      setSlabGeometry((current) => ({
        ...current,
        designAreas: (current.designAreas ?? []).filter(
          (area) => area.id !== areaId
        )
      }));
      if (linkedMeshZoneId) {
        setMeshZones((current) =>
          current.filter((zone) => zone.id !== linkedMeshZoneId)
        );
        setActiveZoneId((current) =>
          current === linkedMeshZoneId ? "ZONE-MAIN" : current
        );
      }
      setSelectedDesignAreaId((current) => (current === areaId ? null : current));
      setEditingDesignAreaId((current) => (current === areaId ? null : current));
    },
    [slabGeometry.designAreas]
  );

  const beginDesignAreaEdit = useCallback((areaId: string) => {
    setSelectedDesignAreaId(areaId);
    setEditingDesignAreaId(areaId);
    setIsEditingBoundary(false);
    setIsDrawingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
  }, []);

  const finishDesignAreaEdit = useCallback(() => {
    setEditingDesignAreaId(null);
  }, []);

  const updateDesignAreaPoint = useCallback(
    (areaId: string, index: number, point: Point) => {
      setSlabGeometry((current) => {
        const nextSlabGeometry = {
          ...current,
          designAreas: (current.designAreas ?? []).map((area) =>
            area.id === areaId
              ? {
                  ...area,
                  polygon: area.polygon.map((areaPoint, pointIndex) =>
                    pointIndex === index ? point : areaPoint
                  )
                }
              : area
          )
        };

        setMeshZones((zones) =>
          zones.map((zone) => {
            const area = nextSlabGeometry.designAreas?.find(
              (designArea) => designArea.meshZoneId === zone.id
            );

            return area ? { ...zone, geometry: area.polygon } : zone;
          })
        );

        return nextSlabGeometry;
      });
    },
    []
  );

  const createMeshZoneForDesignArea = useCallback(
    (areaId: string) => {
      const area = (slabGeometry.designAreas ?? []).find(
        (designArea) => designArea.id === areaId
      );

      if (!area) {
        return false;
      }

      const nextZone = createMeshZoneForArea(
        slabGeometry,
        area,
        meshZones.length,
        activeMeshZone.parameters
      );

      setMeshZones((current) => [...current, nextZone]);
      setSlabGeometry((current) => ({
        ...current,
        designAreas: (current.designAreas ?? []).map((designArea) =>
          designArea.id === areaId
            ? {
                ...designArea,
                meshZoneId: nextZone.id,
                purpose:
                  designArea.purpose === "no-mesh"
                    ? "extra-mesh"
                    : designArea.purpose
              }
            : designArea
        )
      }));
      setActiveZoneId(nextZone.id);
      setSelectedDesignAreaId(areaId);
      return true;
    },
    [activeMeshZone.parameters, meshZones.length, slabGeometry]
  );

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
      designAreas: [],
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
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
    return true;
  }, [activeMeshZone.parameters, slabGeometry]);

  const deleteDxfUnderlay = useCallback(() => {
    const nextSlabGeometry = cloneSlabGeometry();
    const nextZones = cloneMeshZones().map((zone) =>
      withRecommendedZoneOrientation(nextSlabGeometry, zone)
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones(nextZones);
    setActiveZoneId(nextZones[0].id);
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
    setBoundaryDraftPoints([]);
  }, []);

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
      setSelectedDesignAreaId(null);
      setEditingDesignAreaId(null);
      setIsDrawingZone(false);
      setIsDrawingBoundary(false);
      setIsEditingBoundary(false);
      setIsDrawingDesignArea(false);
      setDesignAreaDrawingMode(null);
      setDesignAreaDraftPoints([]);
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
      setSelectedDesignAreaId(null);
      setEditingDesignAreaId(null);
      setIsDrawingZone(false);
      setIsDrawingBoundary(false);
      setIsEditingBoundary(false);
      setIsDrawingDesignArea(false);
      setDesignAreaDrawingMode(null);
      setDesignAreaDraftPoints([]);
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
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
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
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
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
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDraftPoints([]);
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
      selectedDesignAreaId,
      isDrawingZone,
      isDrawingBoundary,
      isEditingBoundary,
      editingDesignAreaId,
      isDrawingDesignArea,
      designAreaDrawingMode,
      boundaryDraftPoints,
      designAreaDraftPoints,
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
      deleteDxfUnderlay,
      setSelectedDesignAreaId,
      setDesignAreaVisible,
      updateDesignAreaPurpose,
      deleteDesignArea,
      beginDesignAreaEdit,
      finishDesignAreaEdit,
      updateDesignAreaPoint,
      createMeshZoneForDesignArea,
      beginDesignAreaDraw,
      cancelDesignAreaDraw,
      addDesignAreaDraftPoint,
      finishDesignAreaDraft,
      commitDesignAreaPolygon,
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
      selectedDesignAreaId,
      isDrawingZone,
      isDrawingBoundary,
      isEditingBoundary,
      editingDesignAreaId,
      isDrawingDesignArea,
      designAreaDrawingMode,
      boundaryDraftPoints,
      designAreaDraftPoints,
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
      deleteDxfUnderlay,
      setSelectedDesignAreaId,
      setDesignAreaVisible,
      updateDesignAreaPurpose,
      deleteDesignArea,
      beginDesignAreaEdit,
      finishDesignAreaEdit,
      updateDesignAreaPoint,
      createMeshZoneForDesignArea,
      beginDesignAreaDraw,
      cancelDesignAreaDraw,
      addDesignAreaDraftPoint,
      finishDesignAreaDraft,
      commitDesignAreaPolygon,
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
