"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import concaveman from "concaveman";

import { mockMeshZones, mockSlabGeometry } from "@/data/mockStructureData";
import { pointInPolygon } from "@/lib/geometry/clipping";
import { compareBaseMeshOrientations } from "@/lib/geometry/mesh-sheet-layout";
import { intersectPolygons } from "@/lib/geometry/polygon-boolean";
import type {
  AnalysisEvidenceCell,
  AnalysisIsland,
  BaseMeshSettings,
  BaseMeshSettingsUpdate,
  CadLineEntity,
  CadTextEntity,
  ExportedReinforcementConfiguration,
  ExtraMeshDesignZone,
  ExtraMeshSchedule,
  ExtraMeshScheduleType,
  MeshZone,
  MeshZoneUpdate,
  Point,
  Polygon,
  DwgUnderlay,
  RawDeficitZone,
  SlabDesignArea,
  SlabDesignAreaPurpose,
  SlabGeometry,
  SlabOpening,
  StrapAnalysisDebug,
  StrapExtraMeshZone,
  StrapNumericalData,
  StrapOverloadedElement
} from "@/types/structure";

const BASE_CAPACITY = 393;
const rawDeficitPadding = 450;
const minimumRawDeficitSize = 900;
const extraZoneMergeGap = 650;
const contourDeficitInfluence = 650;
const contourAttachGap = 1_000;
const contourEdgeTolerance = 2_200;
const contourEdgeBandLength = 5_000;
const contourEdgeBandDepth = 1_800;

type DesignAreaDrawingMode = "polygon" | "rectangle" | "axis-rectangle";
type DesignAreaDrawingPurpose = Extract<
  SlabDesignAreaPurpose,
  "no-mesh" | "extra-mesh"
>;
type StrapLayerAxis = "x" | "y";
type AnalysisViewMode = "x" | "y" | "both" | "governing";
type RawDeficitPoint = Point & {
  requiredAs: number;
};
type StrapElementLabel = {
  axis: StrapLayerAxis;
  elementId: string;
  point: Point;
  underlay: DwgUnderlay;
};
type StrapIdResolver = {
  offset: number | null;
  resolve: (dxfElementId: string) => StrapNumericalData | undefined;
  resolveElementId: (dxfElementId: string) => string | null;
};
type StrapElementCell = {
  axis: StrapLayerAxis;
  index: number;
  polygon: Point[];
};

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
  designAreaDrawingPurpose: DesignAreaDrawingPurpose;
  boundaryDraftPoints: Point[];
  designAreaDraftPoints: Point[];
  activeDxfUnderlayId: string | null;
  analysisViewMode: AnalysisViewMode;
  showRawStrapLayers: boolean;
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
  beginDesignAreaDraw: (
    mode: DesignAreaDrawingMode,
    purpose?: DesignAreaDrawingPurpose
  ) => void;
  cancelDesignAreaDraw: () => void;
  addDesignAreaDraftPoint: (point: Point) => void;
  finishDesignAreaDraft: () => boolean;
  commitDesignAreaPolygon: (
    polygon: Point[],
    purpose?: SlabDesignAreaPurpose,
    options?: {
      axisLine?: ExtraMeshDesignZone["axisLine"];
      axisLines?: ExtraMeshDesignZone["axisLines"];
    }
  ) => boolean;
  importSlabGeometry: (slabGeometry: SlabGeometry) => void;
  addDxfUnderlay: (underlay: DwgUnderlay) => void;
  deleteDxfUnderlayById: (underlayId: string) => void;
  setActiveDxfUnderlayId: (underlayId: string | null) => void;
  setDxfUnderlayVisible: (underlayId: string, visible: boolean) => void;
  setDxfUnderlayLayerVisible: (
    underlayId: string,
    layerName: string,
    visible: boolean
  ) => void;
  setDxfUnderlayScale: (underlayId: string, scale: number) => void;
  translateDxfUnderlay: (underlayId: string, delta: Point) => void;
  setAnalysisViewMode: (mode: AnalysisViewMode) => void;
  setShowRawStrapLayers: (visible: boolean) => void;
  setStrapLayer: (axis: StrapLayerAxis, underlay: DwgUnderlay) => void;
  deleteStrapLayer: (axis: StrapLayerAxis) => void;
  setStrapNumericalData: (data: StrapNumericalData[]) => void;
  runThreeWayAnalysis: () => number;
  clearStrapAnalysis: () => void;
  generateRawDeficitZones: () => number;
  generateSlabFromVisibleLayers: () => boolean;
  activateBaseMeshOnWorkingSlab: (patch?: BaseMeshSettingsUpdate) => boolean;
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

function createDxfUnderlayId(fileName: string) {
  return `DXF-${fileName.replace(/[^a-z0-9]+/gi, "-")}-${Date.now().toString(36)}`;
}

function createStrapUnderlayId(axis: StrapLayerAxis, fileName: string) {
  return `STRAP-${axis.toUpperCase()}-${fileName.replace(/[^a-z0-9]+/gi, "-")}-${Date.now().toString(36)}`;
}

function normalizeDxfUnderlay(underlay: DwgUnderlay): DwgUnderlay {
  return {
    ...underlay,
    id: underlay.id ?? createDxfUnderlayId(underlay.importedFileName ?? "reference"),
    offset: underlay.offset ?? { x: 0, y: 0 },
    scale: underlay.scale && underlay.scale > 0 ? underlay.scale : 1,
    visible: underlay.visible ?? true,
    layers: underlay.layers?.map((layer) => ({
      ...layer,
      visible: layer.visible ?? true
    }))
  };
}

function dxfUnderlayScale(underlay: DwgUnderlay) {
  return underlay.scale && underlay.scale > 0 ? underlay.scale : 1;
}

function dxfUnderlayTransformOrigin(underlay: DwgUnderlay): Point {
  return underlay.bounds
    ? {
        x: (underlay.bounds.minX + underlay.bounds.maxX) / 2,
        y: (underlay.bounds.minY + underlay.bounds.maxY) / 2
      }
    : { x: 0, y: 0 };
}

function transformDxfPoint(underlay: DwgUnderlay, point: Point): Point {
  const offset = underlay.offset ?? { x: 0, y: 0 };
  const origin = dxfUnderlayTransformOrigin(underlay);
  const underlayScale = dxfUnderlayScale(underlay);

  return {
    x: offset.x + origin.x + (point.x - origin.x) * underlayScale,
    y: offset.y + origin.y + (point.y - origin.y) * underlayScale
  };
}

function transformDxfPolygon(underlay: DwgUnderlay, polygon: Point[]) {
  return polygon.map((point) => transformDxfPoint(underlay, point));
}

function polygonCenter(polygon: Point[]): Point {
  return polygon.reduce(
    (sum, point, _, points) => ({
      x: sum.x + point.x / points.length,
      y: sum.y + point.y / points.length
    }),
    { x: 0, y: 0 }
  );
}

function polygonAreaAbs(polygon: Point[]) {
  return Math.abs(
    polygon.reduce((area, point, index) => {
      const next = polygon[(index + 1) % polygon.length];

      return area + point.x * next.y - next.x * point.y;
    }, 0) / 2
  );
}

function boundsFromPolygon(polygon: Point[]) {
  return {
    maxX: Math.max(...polygon.map((point) => point.x)),
    maxY: Math.max(...polygon.map((point) => point.y)),
    minX: Math.min(...polygon.map((point) => point.x)),
    minY: Math.min(...polygon.map((point) => point.y))
  };
}

function boundsOverlapOrNear(
  first: ReturnType<typeof boundsFromPolygon>,
  second: ReturnType<typeof boundsFromPolygon>,
  gap: number
) {
  return !(
    first.maxX + gap < second.minX ||
    second.maxX + gap < first.minX ||
    first.maxY + gap < second.minY ||
    second.maxY + gap < first.minY
  );
}

function mergeBounds(
  first: ReturnType<typeof boundsFromPolygon>,
  second: ReturnType<typeof boundsFromPolygon>
) {
  return {
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY),
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY)
  };
}

function rectanglePolygon(bounds: ReturnType<typeof boundsFromPolygon>) {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
}

function pointInAnyOpening(point: Point, openings: SlabOpening[]) {
  return openings.some((opening) => pointInPolygon(point, opening.polygon));
}

function steelAreaPerMeter(
  diameter: BaseMeshSettings["diameter"],
  spacing: BaseMeshSettings["spacing"]
) {
  return (Math.PI * diameter ** 2 * 1_000) / (4 * spacing);
}

function providedAsForSettings(settings: BaseMeshSettings) {
  return steelAreaPerMeter(settings.diameter, settings.spacing);
}

function extraMeshScheduleCatalog() {
  return ([8, 10, 12] as const).flatMap((diameter) =>
    ([250, 200, 150] as const).map((spacing) => ({
      diameter,
      spacing,
      providedAs: steelAreaPerMeter(diameter, spacing)
    }))
  );
}

function recommendExtraMeshSchedule(requiredExtraAs: number): ExtraMeshSchedule | undefined {
  if (requiredExtraAs <= 0) {
    return undefined;
  }

  const schedules = extraMeshScheduleCatalog();

  const selectedSchedule =
    schedules
      .filter((schedule) => schedule.providedAs >= requiredExtraAs)
      .toSorted((a, b) => a.providedAs - b.providedAs)[0] ??
    schedules.toSorted((a, b) => b.providedAs - a.providedAs)[0];

  return {
    ...selectedSchedule,
    isAdequate: selectedSchedule.providedAs >= requiredExtraAs,
    shortfall: Math.max(0, requiredExtraAs - selectedSchedule.providedAs)
  };
}

function evidenceCenter(evidence: Pick<AnalysisEvidenceCell, "polygon">) {
  return polygonCenter(evidence.polygon);
}

function polygonOverlapArea(first: Polygon, second: Polygon) {
  return intersectPolygons(first, second).reduce(
    (area, polygon) => area + polygonAreaAbs(polygon),
    0
  );
}

function polygonsOverlap(first: Polygon, second: Polygon) {
  return polygonOverlapArea(first, second) > 1;
}

function clusterIslandPolygon(
  evidence: AnalysisEvidenceCell[],
  fallbackBounds: ReturnType<typeof boundsFromPolygon>
): Polygon {
  const points = evidence.flatMap((cell) => [
    ...cell.polygon,
    evidenceCenter(cell)
  ]);
  const uniquePoints = Array.from(
    new Map(
      points.map((point) => [
        `${Math.round(point.x)}:${Math.round(point.y)}`,
        point
      ])
    ).values()
  );

  if (uniquePoints.length < 3) {
    return rectanglePolygon(fallbackBounds);
  }

  const hull = concaveman(
    uniquePoints.map((point) => [point.x, point.y]),
    2,
    extraZoneMergeGap / 2
  );
  const polygon = hull.map(([x, y]) => ({ x, y }));

  return polygon.length >= 3 && polygonAreaAbs(polygon) > 1
    ? polygon
    : rectanglePolygon(fallbackBounds);
}

function maxContourRequiredAsInsidePolygon(
  underlay: DwgUnderlay | undefined,
  polygon: Polygon
) {
  if (!underlay || underlay.visible === false || polygon.length < 3) {
    return 0;
  }

  const visibleLayers = new Set(
    underlay.layers?.filter((layer) => layer.visible).map((layer) => layer.name) ??
      []
  );

  return underlay.texts.reduce((maxRequiredAs, text) => {
    if (visibleLayers.size > 0 && !visibleLayers.has(text.layer)) {
      return maxRequiredAs;
    }

    const requiredAs = parseRequiredSteelValue(text.text);

    if (requiredAs === null) {
      return maxRequiredAs;
    }

    const point = transformDxfPoint(underlay, text.position);

    return pointInPolygon(point, polygon)
      ? Math.max(maxRequiredAs, requiredAs)
      : maxRequiredAs;
  }, 0);
}

function createAnalysisEvidenceCells(
  overloadedElements: StrapOverloadedElement[],
  contourDeficitPointsByAxis: Record<StrapLayerAxis, RawDeficitPoint[]>,
  slabBoundary: Polygon,
  openings: SlabOpening[],
  baseProvidedAs: number
) {
  const evidenceCells: AnalysisEvidenceCell[] = [];

  const pushEvidence = (
    evidence: Omit<AnalysisEvidenceCell, "excessAs" | "islandId">
  ) => {
    const center = polygonCenter(evidence.polygon);

    if (
      slabBoundary.length >= 3 &&
      (!pointInPolygon(center, slabBoundary) || pointInAnyOpening(center, openings))
    ) {
      return;
    }

    evidenceCells.push({
      ...evidence,
      excessAs: Math.max(0, evidence.requiredAs - baseProvidedAs)
    });
  };

  for (const element of overloadedElements) {
    pushEvidence({
      id: `ANALYSIS-CELL-${element.axis}-${element.elementId}-${evidenceCells.length}`,
      axis: element.axis,
      elementId: element.elementId,
      polygon: element.polygon,
      requiredAs: element.maxRequiredAs,
      source: "cell"
    });
  }

  for (const axis of ["x", "y"] as const) {
    for (const point of contourDeficitPointsByAxis[axis]) {
      pushEvidence({
        id: `ANALYSIS-CONTOUR-${axis}-${evidenceCells.length}`,
        axis,
        polygon: rectanglePolygon(contourEvidenceBounds(point, slabBoundary)),
        requiredAs: point.requiredAs,
        source: "contour"
      });
    }
  }

  return evidenceCells;
}

function createAnalysisIslands(evidenceCells: AnalysisEvidenceCell[]) {
  type EvidenceCluster = {
    bounds: ReturnType<typeof boundsFromPolygon>;
    evidence: AnalysisEvidenceCell[];
  };

  const visited = new Set<number>();
  const clusters: EvidenceCluster[] = [];

  for (let index = 0; index < evidenceCells.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const stack = [index];
    const evidence: AnalysisEvidenceCell[] = [];
    visited.add(index);

    while (stack.length > 0) {
      const currentIndex = stack.pop();

      if (currentIndex === undefined) {
        continue;
      }

      const current = evidenceCells[currentIndex];
      const currentCenter = evidenceCenter(current);
      const currentBounds = boundsFromPolygon(current.polygon);
      evidence.push(current);

      for (let otherIndex = 0; otherIndex < evidenceCells.length; otherIndex += 1) {
        if (visited.has(otherIndex)) {
          continue;
        }

        const other = evidenceCells[otherIndex];
        const otherCenter = evidenceCenter(other);
        const otherBounds = boundsFromPolygon(other.polygon);
        const centersAreClose =
          Math.hypot(
            currentCenter.x - otherCenter.x,
            currentCenter.y - otherCenter.y
          ) <= contourAttachGap;
        const boundsAreConnected =
          boundsOverlapOrNear(currentBounds, otherBounds, extraZoneMergeGap) ||
          pointDistanceToBounds(currentCenter, otherBounds) <= extraZoneMergeGap ||
          pointDistanceToBounds(otherCenter, currentBounds) <= extraZoneMergeGap;

        if (centersAreClose || boundsAreConnected) {
          visited.add(otherIndex);
          stack.push(otherIndex);
        }
      }
    }

    const bounds = evidence
      .slice(1)
      .reduce(
        (mergedBounds, item) => mergeBounds(mergedBounds, boundsFromPolygon(item.polygon)),
        boundsFromPolygon(evidence[0].polygon)
      );

    clusters.push({ bounds, evidence });
  }

  const islands: AnalysisIsland[] = [];
  const evidenceWithIslandIds = [...evidenceCells];

  clusters.forEach((cluster, index) => {
    const id = `ANALYSIS-ISLAND-${index + 1}`;
    const evidenceCellIds = cluster.evidence.map((evidence) => evidence.id);
    const maxRequiredAsX = Math.max(
      0,
      ...cluster.evidence
        .filter((evidence) => evidence.axis === "x")
        .map((evidence) => evidence.requiredAs)
    );
    const maxRequiredAsY = Math.max(
      0,
      ...cluster.evidence
        .filter((evidence) => evidence.axis === "y")
        .map((evidence) => evidence.requiredAs)
    );
    const maxExcessAsX = Math.max(
      0,
      ...cluster.evidence
        .filter((evidence) => evidence.axis === "x")
        .map((evidence) => evidence.excessAs)
    );
    const maxExcessAsY = Math.max(
      0,
      ...cluster.evidence
        .filter((evidence) => evidence.axis === "y")
        .map((evidence) => evidence.excessAs)
    );

    islands.push({
      id,
      evidenceCellIds,
      evidenceCount: evidenceCellIds.length,
      maxExcessAsX,
      maxExcessAsY,
      maxRequiredAsX,
      maxRequiredAsY,
      polygon: clusterIslandPolygon(cluster.evidence, cluster.bounds)
    });

    for (const evidenceId of evidenceCellIds) {
      const evidenceIndex = evidenceWithIslandIds.findIndex(
        (evidence) => evidence.id === evidenceId
      );

      if (evidenceIndex >= 0) {
        evidenceWithIslandIds[evidenceIndex] = {
          ...evidenceWithIslandIds[evidenceIndex],
          islandId: id
        };
      }
    }
  });

  return { evidenceCells: evidenceWithIslandIds, islands };
}

function calculateExtraMeshDesignZone(
  polygon: Polygon,
  slabGeometry: SlabGeometry,
  baseParameters: BaseMeshSettings,
  index: number,
  existing?: ExtraMeshDesignZone,
  options?: {
    axisLine?: ExtraMeshDesignZone["axisLine"];
    axisLines?: ExtraMeshDesignZone["axisLines"];
  }
): ExtraMeshDesignZone {
  const baseProvidedAs = providedAsForSettings(baseParameters);
  const coveredEvidence = (slabGeometry.analysisEvidenceCells ?? []).filter((evidence) =>
    pointInPolygon(evidenceCenter(evidence), polygon) ||
    polygonsOverlap(evidence.polygon, polygon)
  );
  const contourMaxRequiredAsX = maxContourRequiredAsInsidePolygon(
    slabGeometry.strapLayerX,
    polygon
  );
  const contourMaxRequiredAsY = maxContourRequiredAsInsidePolygon(
    slabGeometry.strapLayerY,
    polygon
  );
  const coveredIslandIds = [
    ...new Set(
      [
        ...(contourMaxRequiredAsX > baseProvidedAs ? ["CONTOUR-X"] : []),
        ...(contourMaxRequiredAsY > baseProvidedAs ? ["CONTOUR-Y"] : []),
        ...(slabGeometry.analysisIslands ?? [])
          .filter((island) => polygonsOverlap(island.polygon, polygon))
          .map((island) => island.id),
        ...coveredEvidence
          .map((evidence) => evidence.islandId)
          .filter((islandId): islandId is string => Boolean(islandId))
      ]
    )
  ];
  const maxRequiredAsX = Math.max(
    0,
    contourMaxRequiredAsX,
    ...coveredEvidence
      .filter((evidence) => evidence.axis === "x")
      .map((evidence) => evidence.requiredAs)
  );
  const maxRequiredAsY = Math.max(
    0,
    contourMaxRequiredAsY,
    ...coveredEvidence
      .filter((evidence) => evidence.axis === "y")
      .map((evidence) => evidence.requiredAs)
  );
  const requiredExtraAsX = Math.max(0, maxRequiredAsX - baseProvidedAs);
  const requiredExtraAsY = Math.max(0, maxRequiredAsY - baseProvidedAs);
  const direction =
    requiredExtraAsX > 0 && requiredExtraAsY > 0
      ? "both"
      : requiredExtraAsX >= requiredExtraAsY
        ? "x"
        : "y";
  const recommendedSchedule: ExtraMeshDesignZone["recommendedSchedule"] = {};
  const xSchedule = recommendExtraMeshSchedule(requiredExtraAsX);
  const ySchedule = recommendExtraMeshSchedule(requiredExtraAsY);

  if (xSchedule) {
    recommendedSchedule.x = xSchedule;
  }
  if (ySchedule) {
    recommendedSchedule.y = ySchedule;
  }

  return {
    id: existing?.id ?? `EXTRA-MESH-DESIGN-${index + 1}`,
    label: existing?.label ?? `Extra mesh zone - ${index + 1}`,
    polygon,
    source: "manual",
    status: existing?.status === "accepted" ? "edited" : (existing?.status ?? "proposed"),
    axisLine: options?.axisLine ?? existing?.axisLine,
    axisLines: options?.axisLines ?? existing?.axisLines,
    coveredIslandIds,
    coveredEvidenceCellIds: coveredEvidence.map((evidence) => evidence.id),
    direction,
    demand: {
      maxRequiredAsX,
      maxRequiredAsY,
      requiredExtraAsX,
      requiredExtraAsY
    },
    recommendedSchedule:
      recommendedSchedule.x || recommendedSchedule.y ? recommendedSchedule : undefined
  };
}

function createScheduleType(
  axis: "x" | "y",
  index: number,
  requiredExtraAs: number,
  assignedZoneIds: string[]
): ExtraMeshScheduleType {
  const schedule = recommendExtraMeshSchedule(requiredExtraAs) ?? {
    diameter: 8 as const,
    isAdequate: true,
    providedAs: 0,
    shortfall: 0,
    spacing: 250 as const
  };
  const label = `${axis.toUpperCase()}-${String.fromCharCode(65 + index)}`;

  return {
    ...schedule,
    axis,
    assignedZoneIds,
    id: `EXTRA-SCHEDULE-${axis.toUpperCase()}-${index + 1}`,
    label,
    maxRequiredExtraAs: requiredExtraAs
  };
}

function standardizeExtraMeshSchedules(zones: ExtraMeshDesignZone[]) {
  const scheduleTypes: ExtraMeshScheduleType[] = [];
  const zoneById = new Map<string, ExtraMeshDesignZone>(
    zones.map((zone) => [
      zone.id,
      {
        ...zone,
        recommendedSchedule: undefined,
        scheduleTypeIds: undefined
      }
    ])
  );

  for (const axis of ["x", "y"] as const) {
    const demandField =
      axis === "x" ? "requiredExtraAsX" : "requiredExtraAsY";
    const zoneDemands = zones
      .map((zone) => ({
        demand: zone.demand[demandField],
        zone
      }))
      .filter(({ demand }) => demand > 0)
      .toSorted((a, b) => a.demand - b.demand);

    if (zoneDemands.length === 0) {
      continue;
    }

    const maxDemand = zoneDemands.at(-1)?.demand ?? 0;
    const lightCandidates = zoneDemands.filter(
      ({ demand }) => demand <= maxDemand * 0.65
    );
    const groups =
      lightCandidates.length > 0 && lightCandidates.length < zoneDemands.length
        ? [
            lightCandidates,
            zoneDemands.filter(({ demand }) => demand > maxDemand * 0.65)
          ]
        : [zoneDemands];

    groups.forEach((group) => {
      const groupMaxDemand = Math.max(...group.map(({ demand }) => demand));
      const assignedZoneIds = group.map(({ zone }) => zone.id);
      const scheduleType = createScheduleType(
        axis,
        scheduleTypes.filter((type) => type.axis === axis).length,
        groupMaxDemand,
        assignedZoneIds
      );

      scheduleTypes.push(scheduleType);
      for (const zoneId of assignedZoneIds) {
        const zone = zoneById.get(zoneId);

        if (!zone) {
          continue;
        }

        zoneById.set(zoneId, {
          ...zone,
          recommendedSchedule: {
            ...(zone.recommendedSchedule ?? {}),
            [axis]: {
              diameter: scheduleType.diameter,
              isAdequate: scheduleType.isAdequate,
              providedAs: scheduleType.providedAs,
              shortfall: Math.max(0, zone.demand[demandField] - scheduleType.providedAs),
              spacing: scheduleType.spacing
            }
          },
          scheduleTypeIds: {
            ...(zone.scheduleTypeIds ?? {}),
            [axis]: scheduleType.id
          }
        });
      }
    });
  }

  return {
    scheduleTypes,
    zones: zones.map((zone) => zoneById.get(zone.id) ?? zone)
  };
}

function pointDistanceToBounds(
  point: Point,
  bounds: ReturnType<typeof boundsFromPolygon>
) {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);

  return Math.hypot(dx, dy);
}

function pointDistanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
    )
  );
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy
  };

  return Math.hypot(point.x - projection.x, point.y - projection.y);
}

function pointDistanceToPolygon(point: Point, polygon: Polygon) {
  if (polygon.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  return polygon.reduce((minimumDistance, start, index) => {
    const end = polygon[(index + 1) % polygon.length];

    return Math.min(minimumDistance, pointDistanceToSegment(point, start, end));
  }, Number.POSITIVE_INFINITY);
}

function nearestPolygonSegment(point: Point, polygon: Polygon) {
  if (polygon.length < 2) {
    return null;
  }

  return polygon.reduce<{
    distance: number;
    end: Point;
    start: Point;
  } | null>((nearest, start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    const distance = pointDistanceToSegment(point, start, end);

    if (!nearest || distance < nearest.distance) {
      return { distance, end, start };
    }

    return nearest;
  }, null);
}

function contourEvidenceBounds(
  point: RawDeficitPoint,
  slabBoundary: Polygon
) {
  const nearestSegment = nearestPolygonSegment(point, slabBoundary);

  if (nearestSegment && nearestSegment.distance <= contourEdgeTolerance) {
    const dx = Math.abs(nearestSegment.end.x - nearestSegment.start.x);
    const dy = Math.abs(nearestSegment.end.y - nearestSegment.start.y);
    const isHorizontalEdge = dx >= dy;

    return {
      maxX:
        point.x +
        (isHorizontalEdge ? contourEdgeBandLength / 2 : contourEdgeBandDepth / 2),
      maxY:
        point.y +
        (isHorizontalEdge ? contourEdgeBandDepth / 2 : contourEdgeBandLength / 2),
      minX:
        point.x -
        (isHorizontalEdge ? contourEdgeBandLength / 2 : contourEdgeBandDepth / 2),
      minY:
        point.y -
        (isHorizontalEdge ? contourEdgeBandDepth / 2 : contourEdgeBandLength / 2)
    };
  }

  return {
    maxX: point.x + contourDeficitInfluence,
    maxY: point.y + contourDeficitInfluence,
    minX: point.x - contourDeficitInfluence,
    minY: point.y - contourDeficitInfluence
  };
}

function pointInExpandedBounds(
  point: Point,
  bounds: ReturnType<typeof boundsFromPolygon>,
  padding: number
) {
  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

function pointInOrNearPolygon(point: Point, polygon: Polygon, tolerance: number) {
  if (polygon.length < 3) {
    return true;
  }

  const bounds = boundsFromPolygon(polygon);

  return (
    pointInPolygon(point, polygon) ||
    pointInExpandedBounds(point, bounds, tolerance) &&
      pointDistanceToPolygon(point, polygon) <= tolerance
  );
}

function normalizedElementId(text: string) {
  const trimmed = text.trim();

  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : null;
}

function numericElementIds(ids: Iterable<string>) {
  return [...ids]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id))
    .toSorted((a, b) => a - b);
}

function createStrapIdResolver(
  numericalDataByElement: Map<string, StrapNumericalData>,
  dxfElementIds: Iterable<string>
): StrapIdResolver {
  const csvIds = numericElementIds(numericalDataByElement.keys());
  const dxfIds = numericElementIds(dxfElementIds);
  const offset =
    csvIds.length > 0 && dxfIds.length > 0 ? csvIds[0] - dxfIds[0] : null;

  return {
    offset,
    resolve: (dxfElementId: string) => {
      const direct = numericalDataByElement.get(dxfElementId);

      if (direct) {
        return direct;
      }

      const numericDxfId = Number(dxfElementId);

      if (offset === null || !Number.isFinite(numericDxfId)) {
        return undefined;
      }

      return numericalDataByElement.get(String(numericDxfId + offset));
    },
    resolveElementId: (dxfElementId: string) => {
      if (numericalDataByElement.has(dxfElementId)) {
        return dxfElementId;
      }

      const numericDxfId = Number(dxfElementId);

      if (offset === null || !Number.isFinite(numericDxfId)) {
        return null;
      }

      const mappedId = String(numericDxfId + offset);

      return numericalDataByElement.has(mappedId) ? mappedId : null;
    }
  };
}

function parseRequiredSteelValue(text: string) {
  if (text.includes("/")) {
    return null;
  }

  const values =
    text
      .match(/-?\d+(?:[\.,]\d+)?/g)
      ?.map((value) => Number(value.replace(",", ".")))
      .filter((value) => Number.isFinite(value) && value > 0) ?? [];

  if (values.length !== 1) {
    return null;
  }

  const rawValue = values[0];

  return rawValue < 100 ? rawValue * 100 : rawValue;
}

function findElementIdInsidePolygon(underlay: DwgUnderlay, polygon: Point[]) {
  const center = polygonCenter(polygon);
  const candidates = underlay.texts
    .map((text) => ({
      elementId: normalizedElementId(text.text),
      point: transformDxfPoint(underlay, text.position)
    }))
    .filter(
      (
        item
      ): item is {
        elementId: string;
        point: Point;
      } => Boolean(item.elementId) && pointInPolygon(item.point, polygon)
    )
    .toSorted(
      (a, b) =>
        Math.hypot(a.point.x - center.x, a.point.y - center.y) -
        Math.hypot(b.point.x - center.x, b.point.y - center.y)
    );

  return candidates[0]?.elementId ?? null;
}

function rectangleAroundPoint(center: Point, width: number, height: number) {
  return [
    { x: center.x - width / 2, y: center.y - height / 2 },
    { x: center.x + width / 2, y: center.y - height / 2 },
    { x: center.x + width / 2, y: center.y + height / 2 },
    { x: center.x - width / 2, y: center.y + height / 2 }
  ];
}

function roundedCoordinate(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function linePoints(line: CadLineEntity) {
  if (line.points.length < 2) {
    return null;
  }

  return {
    end: line.points[line.points.length - 1],
    start: line.points[0]
  };
}

function isHorizontalLine(line: CadLineEntity) {
  const points = linePoints(line);

  return points ? Math.abs(points.start.y - points.end.y) < 0.00001 : false;
}

function isVerticalLine(line: CadLineEntity) {
  const points = linePoints(line);

  return points ? Math.abs(points.start.x - points.end.x) < 0.00001 : false;
}

function lineCoversHorizontalSpan(
  line: CadLineEntity,
  y: number,
  x1: number,
  x2: number
) {
  const points = linePoints(line);

  if (!points || !isHorizontalLine(line)) {
    return false;
  }

  const mid = (x1 + x2) / 2;
  const minX = Math.min(points.start.x, points.end.x);
  const maxX = Math.max(points.start.x, points.end.x);

  return Math.abs(points.start.y - y) < 0.00001 && mid >= minX && mid <= maxX;
}

function lineCoversVerticalSpan(
  line: CadLineEntity,
  x: number,
  y1: number,
  y2: number
) {
  const points = linePoints(line);

  if (!points || !isVerticalLine(line)) {
    return false;
  }

  const mid = (y1 + y2) / 2;
  const minY = Math.min(points.start.y, points.end.y);
  const maxY = Math.max(points.start.y, points.end.y);

  return Math.abs(points.start.x - x) < 0.00001 && mid >= minY && mid <= maxY;
}

function reconstructStrapElementCells(
  axis: StrapLayerAxis,
  underlay: DwgUnderlay | undefined
): StrapElementCell[] {
  if (!underlay || underlay.visible === false) {
    return [];
  }

  const elementLines = underlay.lines.filter((line) => line.layer === "Elements");

  if (elementLines.length === 0) {
    return [];
  }

  const horizontalLines = elementLines.filter(isHorizontalLine);
  const verticalLines = elementLines.filter(isVerticalLine);
  const xCoordinates = [
    ...new Set(
      elementLines.flatMap((line) =>
        line.points.map((point) => roundedCoordinate(point.x))
      )
    )
  ].toSorted((a, b) => a - b);
  const yCoordinates = [
    ...new Set(
      elementLines.flatMap((line) =>
        line.points.map((point) => roundedCoordinate(point.y))
      )
    )
  ].toSorted((a, b) => a - b);
  const cells: StrapElementCell[] = [];

  for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex += 1) {
      const x1 = xCoordinates[xIndex];
      const x2 = xCoordinates[xIndex + 1];
      const y1 = yCoordinates[yIndex];
      const y2 = yCoordinates[yIndex + 1];
      const hasBottom = horizontalLines.some((line) =>
        lineCoversHorizontalSpan(line, y1, x1, x2)
      );
      const hasTop = horizontalLines.some((line) =>
        lineCoversHorizontalSpan(line, y2, x1, x2)
      );
      const hasLeft = verticalLines.some((line) =>
        lineCoversVerticalSpan(line, x1, y1, y2)
      );
      const hasRight = verticalLines.some((line) =>
        lineCoversVerticalSpan(line, x2, y1, y2)
      );

      if (hasBottom && hasTop && hasLeft && hasRight) {
        cells.push({
          axis,
          index: cells.length,
          polygon: transformDxfPolygon(underlay, [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 }
          ])
        });
      }
    }
  }

  return cells;
}

function collectElementLabelsFromLayer(
  axis: StrapLayerAxis,
  underlay: DwgUnderlay | undefined
) {
  if (!underlay || underlay.visible === false) {
    return [];
  }

  return underlay.texts.reduce<StrapElementLabel[]>((labels, text) => {
    const elementId = normalizedElementId(text.text);

    if (!elementId) {
      return labels;
    }

    const point = transformDxfPoint(underlay, text.position);

    labels.push({ axis, elementId, point, underlay });
    return labels;
  }, []);
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function estimateElementLabelCellSize(labels: StrapElementLabel[]) {
  const nearestDistances = labels
    .map((label, index) =>
      labels.reduce((nearest, other, otherIndex) => {
        if (index === otherIndex || label.axis !== other.axis) {
          return nearest;
        }

        const nextDistance = Math.hypot(
          other.point.x - label.point.x,
          other.point.y - label.point.y
        );

        return nextDistance > 0 ? Math.min(nearest, nextDistance) : nearest;
      }, Number.POSITIVE_INFINITY)
    )
    .filter((value) => Number.isFinite(value));
  const spacing = median(nearestDistances) ?? 900;
  const size = Math.max(350, Math.min(1_600, spacing * 0.8));

  return { height: size, width: size };
}

function collectOverloadedElementsFromLabels(
  labels: StrapElementLabel[],
  idResolver: StrapIdResolver
) {
  const cellSize = estimateElementLabelCellSize(labels);
  const seen = new Set<string>();

  return labels.reduce<StrapOverloadedElement[]>((elements, label) => {
    const key = `${label.axis}-${label.elementId}`;
    const numericalData = idResolver.resolve(label.elementId);

    if (
      seen.has(key) ||
      !numericalData ||
      numericalData.maxRequiredAs <= BASE_CAPACITY
    ) {
      return elements;
    }

    seen.add(key);
    elements.push({
      id: `${key}-label-fallback`,
      axis: label.axis,
      elementId: label.elementId,
      polygon: rectangleAroundPoint(label.point, cellSize.width, cellSize.height),
      maxRequiredAs: numericalData.maxRequiredAs
    });
    return elements;
  }, []);
}

function sortLabelsByPosition(labels: StrapElementLabel[]) {
  return labels.toSorted(
    (a, b) =>
      a.axis.localeCompare(b.axis) ||
      a.point.y - b.point.y ||
      a.point.x - b.point.x
  );
}

function collectOverloadedElementsSequentially(
  labels: StrapElementLabel[],
  numericalData: StrapNumericalData[]
) {
  const sortedLabels = sortLabelsByPosition(labels);
  const sortedRows = numericalData.toSorted(
    (a, b) => Number(a.elementId) - Number(b.elementId)
  );
  const cellSize = estimateElementLabelCellSize(sortedLabels);

  return sortedLabels.reduce<StrapOverloadedElement[]>((elements, label, index) => {
    const numericalDataRow = sortedRows[index];

    if (!numericalDataRow || numericalDataRow.maxRequiredAs <= BASE_CAPACITY) {
      return elements;
    }

    elements.push({
      id: `${label.axis}-${label.elementId}-seq-${numericalDataRow.elementId}`,
      axis: label.axis,
      elementId: `${label.elementId} -> ${numericalDataRow.elementId}`,
      polygon: rectangleAroundPoint(label.point, cellSize.width, cellSize.height),
      maxRequiredAs: numericalDataRow.maxRequiredAs
    });
    return elements;
  }, []);
}

function collectOverloadedElementsFromCells(
  cells: StrapElementCell[],
  numericalData: StrapNumericalData[]
) {
  return cells.reduce<StrapOverloadedElement[]>((elements, cell, index) => {
    const row = numericalData[index];

    if (!row || row.maxRequiredAs <= BASE_CAPACITY) {
      return elements;
    }

    elements.push({
      id: `${cell.axis}-cell-${index}-${row.elementId}`,
      axis: cell.axis,
      elementId: row.elementId,
      polygon: cell.polygon,
      maxRequiredAs: row.maxRequiredAs
    });
    return elements;
  }, []);
}

function collectOverloadedElementsFromLayer(
  axis: StrapLayerAxis,
  underlay: DwgUnderlay | undefined,
  idResolver: StrapIdResolver,
  calculationBoundary: Point[]
) {
  if (!underlay || underlay.visible === false) {
    return [];
  }

  const slabArea =
    calculationBoundary.length >= 3 ? polygonAreaAbs(calculationBoundary) : 0;

  return (underlay.closedPolylines ?? []).reduce<StrapOverloadedElement[]>(
    (elements, candidate) => {
      const polygon = transformDxfPolygon(underlay, candidate.polygon);
      const center = polygonCenter(polygon);
      const area = polygonAreaAbs(polygon);

      if (
        polygon.length < 4 ||
        area <= 0 ||
        (slabArea > 0 && area > slabArea * 0.2) ||
        calculationBoundary.length >= 3 &&
          !pointInPolygon(center, calculationBoundary)
      ) {
        return elements;
      }

      const elementId = findElementIdInsidePolygon(underlay, polygon);

      if (!elementId) {
        return elements;
      }

      const numericalData = idResolver.resolve(elementId);

      if (!numericalData || numericalData.maxRequiredAs <= BASE_CAPACITY) {
        return elements;
      }

      elements.push({
        id: `${axis}-${elementId}-${candidate.id}`,
        axis,
        elementId,
        polygon,
        maxRequiredAs: numericalData.maxRequiredAs
      });
      return elements;
    },
    []
  );
}

function collectRawDeficitPoints(
  underlay: DwgUnderlay | undefined,
  calculationBoundary: Point[]
) {
  if (!underlay || underlay.visible === false) {
    return [];
  }

  const visibleLayers = new Set(
    underlay.layers?.filter((layer) => layer.visible).map((layer) => layer.name) ??
      []
  );

  return underlay.texts.reduce<RawDeficitPoint[]>((points, text: CadTextEntity) => {
    if (visibleLayers.size > 0 && !visibleLayers.has(text.layer)) {
      return points;
    }

    const requiredAs = parseRequiredSteelValue(text.text);

    if (requiredAs === null || requiredAs <= BASE_CAPACITY) {
      return points;
    }

    const transformedPoint = transformDxfPoint(underlay, text.position);

    if (
      calculationBoundary.length >= 3 &&
      !pointInOrNearPolygon(
        transformedPoint,
        calculationBoundary,
        contourEdgeTolerance
      )
    ) {
      return points;
    }

    points.push({
      ...transformedPoint,
      requiredAs
    });
    return points;
  }, []);
}

function deficitClusterDistance(points: RawDeficitPoint[]) {
  if (points.length < 2) {
    return 2_500;
  }

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const diagonal = Math.hypot(maxX - minX, maxY - minY);

  return Math.max(1_500, Math.min(5_000, diagonal / 35));
}

function clusterRawDeficitPoints(points: RawDeficitPoint[]): RawDeficitZone[] {
  const clusterDistance = deficitClusterDistance(points);
  const clusters: RawDeficitPoint[][] = [];

  for (const point of points) {
    const matchingCluster = clusters.find((cluster) =>
      cluster.some(
        (clusterPoint) =>
          Math.hypot(clusterPoint.x - point.x, clusterPoint.y - point.y) <=
          clusterDistance
      )
    );

    if (matchingCluster) {
      matchingCluster.push(point);
    } else {
      clusters.push([point]);
    }
  }

  return clusters.map((cluster) => {
    const minX = Math.min(...cluster.map((point) => point.x));
    const maxX = Math.max(...cluster.map((point) => point.x));
    const minY = Math.min(...cluster.map((point) => point.y));
    const maxY = Math.max(...cluster.map((point) => point.y));
    const width = Math.max(minimumRawDeficitSize, maxX - minX + rawDeficitPadding * 2);
    const height = Math.max(
      minimumRawDeficitSize,
      maxY - minY + rawDeficitPadding * 2
    );

    return {
      x: (minX + maxX) / 2 - width / 2,
      y: (minY + maxY) / 2 - height / 2,
      width,
      height,
      maxRequiredAs: Math.max(...cluster.map((point) => point.requiredAs))
    };
  });
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

function purposeRequiresAreaMesh(purpose: SlabDesignAreaPurpose) {
  return purpose === "base-mesh" || purpose === "extra-mesh";
}

function purposeRemovesAreaMesh(purpose: SlabDesignAreaPurpose) {
  return purpose === "no-mesh" || purpose === "void";
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
  const [activeDxfUnderlayId, setActiveDxfUnderlayId] = useState<string | null>(
    null
  );
  const [analysisViewMode, setAnalysisViewMode] =
    useState<AnalysisViewMode>("both");
  const [showRawStrapLayers, setShowRawStrapLayers] = useState(false);
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
  const [designAreaDrawingPurpose, setDesignAreaDrawingPurpose] =
    useState<DesignAreaDrawingPurpose>("no-mesh");
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
    setDesignAreaDrawingPurpose("no-mesh");
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
    setDesignAreaDrawingPurpose("no-mesh");
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

  const beginDesignAreaDraw = useCallback((
    mode: DesignAreaDrawingMode,
    purpose: DesignAreaDrawingPurpose = "no-mesh"
  ) => {
    setDesignAreaDraftPoints([]);
    setDesignAreaDrawingMode(mode);
    setDesignAreaDrawingPurpose(purpose);
    setIsDrawingDesignArea(true);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingZone(false);
    setBoundaryDraftPoints([]);
  }, []);

  const cancelDesignAreaDraw = useCallback(() => {
    setDesignAreaDraftPoints([]);
    setDesignAreaDrawingMode(null);
    setDesignAreaDrawingPurpose("no-mesh");
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
          reviewOnly: true,
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
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setBoundaryDraftPoints([]);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDrawingPurpose("no-mesh");
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
    return true;
  }, [activeMeshZone.parameters, boundaryDraftPoints, slabGeometry]);

  const commitDesignAreaPolygon = useCallback(
    (
      polygon: Point[],
      purpose: SlabDesignAreaPurpose = designAreaDrawingPurpose,
      options?: {
        axisLine?: ExtraMeshDesignZone["axisLine"];
        axisLines?: ExtraMeshDesignZone["axisLines"];
      }
    ) => {
      if (!slabGeometry.hasActiveSlabBoundary || polygon.length < 3) {
        return false;
      }

      const designAreas = slabGeometry.designAreas ?? [];
      const areaIndex = designAreas.length + 1;
      const areaId = `AREA-${String(areaIndex).padStart(2, "0")}`;
      const isExtraMeshArea = purpose === "extra-mesh";
      const nextExtraMeshDesignZone = isExtraMeshArea
        ? calculateExtraMeshDesignZone(
            polygon,
            slabGeometry,
            activeMeshZone.parameters,
            slabGeometry.extraMeshDesignZones?.length ?? 0,
            undefined,
            options
          )
        : null;
      const standardizedExtraMesh = standardizeExtraMeshSchedules(
        nextExtraMeshDesignZone
          ? [...(slabGeometry.extraMeshDesignZones ?? []), nextExtraMeshDesignZone]
          : (slabGeometry.extraMeshDesignZones ?? [])
      );
      const nextSlabGeometry: SlabGeometry = {
        ...slabGeometry,
        designAreas: [
          ...designAreas,
          {
            id: areaId,
            label: isExtraMeshArea
              ? `Extra mesh area - ${areaIndex}`
              : `No mesh area - ${areaIndex}`,
            extraMeshDesignZoneId: nextExtraMeshDesignZone?.id,
            polygon,
            priority: areaIndex,
            purpose,
            source: "user",
            visible: true
          }
        ],
        extraMeshDesignZones: standardizedExtraMesh.zones,
        extraMeshScheduleTypes: standardizedExtraMesh.scheduleTypes
      };
      const nextMainZone = createMainZoneForSlab(
        nextSlabGeometry,
        activeMeshZone.parameters
      );

      setSlabGeometry(nextSlabGeometry);
      setMeshZones((current) => [
        nextMainZone,
        ...current.filter((zone) => !zone.isMainZone)
      ]);
      setActiveZoneId(nextMainZone.id);
      setSelectedDesignAreaId(areaId);
      setDesignAreaDraftPoints([]);
      setDesignAreaDrawingMode(null);
      setDesignAreaDrawingPurpose("no-mesh");
      setIsDrawingDesignArea(false);
      return true;
    },
    [activeMeshZone.parameters, designAreaDrawingPurpose, slabGeometry]
  );

  const finishDesignAreaDraft = useCallback(() => {
    return commitDesignAreaPolygon(designAreaDraftPoints, designAreaDrawingPurpose);
  }, [commitDesignAreaPolygon, designAreaDraftPoints, designAreaDrawingPurpose]);

  const beginBoundaryEdit = useCallback(() => {
    if (!slabGeometry.hasActiveSlabBoundary) {
      return;
    }

    setIsEditingBoundary(true);
    setIsDrawingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDrawingPurpose("no-mesh");
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
      const currentArea = (slabGeometry.designAreas ?? []).find(
        (area) => area.id === areaId
      );

      if (!currentArea) {
        return;
      }

      const shouldCreateAreaMesh =
        purposeRequiresAreaMesh(purpose) && !currentArea.meshZoneId;
      const nextMeshZone = shouldCreateAreaMesh
        ? createMeshZoneForArea(
            slabGeometry,
            { ...currentArea, purpose },
            meshZones.length,
            activeMeshZone.parameters
          )
        : null;
      const meshZoneIdToRemove = purposeRemovesAreaMesh(purpose)
        ? currentArea.meshZoneId
        : undefined;
      const extraMeshDesignZoneIdToRemove =
        purpose !== "extra-mesh" ? currentArea.extraMeshDesignZoneId : undefined;

      setSlabGeometry((current) => {
        const nextExtraMeshZones = extraMeshDesignZoneIdToRemove
          ? (current.extraMeshDesignZones ?? []).filter(
              (zone) => zone.id !== extraMeshDesignZoneIdToRemove
            )
          : (current.extraMeshDesignZones ?? []);
        const standardizedExtraMesh =
          standardizeExtraMeshSchedules(nextExtraMeshZones);

        return {
          ...current,
          designAreas: (current.designAreas ?? []).map((area) =>
            area.id === areaId
              ? {
                  ...area,
                  meshZoneId: purposeRemovesAreaMesh(purpose)
                    ? undefined
                    : nextMeshZone?.id ?? area.meshZoneId,
                  extraMeshDesignZoneId:
                    purpose === "extra-mesh" ? area.extraMeshDesignZoneId : undefined,
                  purpose
                }
              : area
          ),
          extraMeshDesignZones: standardizedExtraMesh.zones,
          extraMeshScheduleTypes: standardizedExtraMesh.scheduleTypes
        };
      });
      setMeshZones((current) => {
        const retainedZones = meshZoneIdToRemove
          ? current.filter((zone) => zone.id !== meshZoneIdToRemove)
          : current;

        return nextMeshZone ? [...retainedZones, nextMeshZone] : retainedZones;
      });
      if (nextMeshZone) {
        setActiveZoneId(nextMeshZone.id);
        setSelectedDesignAreaId(areaId);
      }
      if (meshZoneIdToRemove) {
        setActiveZoneId((current) =>
          current === meshZoneIdToRemove ? "ZONE-MAIN" : current
        );
      }
    },
    [activeMeshZone.parameters, meshZones.length, slabGeometry]
  );

  const deleteDesignArea = useCallback(
    (areaId: string) => {
      const deletedArea = (slabGeometry.designAreas ?? []).find(
        (area) => area.id === areaId
      );
      const linkedMeshZoneId = deletedArea?.meshZoneId;
      const linkedExtraMeshDesignZoneId = deletedArea?.extraMeshDesignZoneId;

      setSlabGeometry((current) => {
        const nextExtraMeshZones = linkedExtraMeshDesignZoneId
          ? (current.extraMeshDesignZones ?? []).filter(
              (zone) => zone.id !== linkedExtraMeshDesignZoneId
            )
          : (current.extraMeshDesignZones ?? []);
        const standardizedExtraMesh =
          standardizeExtraMeshSchedules(nextExtraMeshZones);

        return {
          ...current,
          designAreas: (current.designAreas ?? []).filter(
            (area) => area.id !== areaId
          ),
          extraMeshDesignZones: standardizedExtraMesh.zones,
          extraMeshScheduleTypes: standardizedExtraMesh.scheduleTypes
        };
      });
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
    setDesignAreaDrawingPurpose("no-mesh");
    setDesignAreaDraftPoints([]);
    setIsDrawingZone(false);
  }, []);

  const finishDesignAreaEdit = useCallback(() => {
    setEditingDesignAreaId(null);
  }, []);

  const updateDesignAreaPoint = useCallback(
    (areaId: string, index: number, point: Point) => {
      setSlabGeometry((current) => {
        let recalculatedExtraMeshZone: ExtraMeshDesignZone | null = null;
        const nextSlabGeometry = {
          ...current,
          designAreas: (current.designAreas ?? []).map((area) =>
            area.id === areaId
              ? (() => {
                  const polygon = area.polygon.map((areaPoint, pointIndex) =>
                    pointIndex === index ? point : areaPoint
                  );
                  const linkedExtraMeshZone = (current.extraMeshDesignZones ?? []).find(
                    (zone) => zone.id === area.extraMeshDesignZoneId
                  );

                  if (linkedExtraMeshZone) {
                    recalculatedExtraMeshZone = calculateExtraMeshDesignZone(
                      polygon,
                      current,
                      activeMeshZone.parameters,
                      current.extraMeshDesignZones?.length ?? 0,
                      linkedExtraMeshZone
                    );
                  }

                  return {
                    ...area,
                    polygon
                  };
                })()
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

        if (!recalculatedExtraMeshZone) {
          return nextSlabGeometry;
        }

        const standardizedExtraMesh = standardizeExtraMeshSchedules(
          (nextSlabGeometry.extraMeshDesignZones ?? []).map((zone) =>
            zone.id === recalculatedExtraMeshZone?.id
              ? recalculatedExtraMeshZone
              : zone
          )
        );

        return {
          ...nextSlabGeometry,
          extraMeshDesignZones: standardizedExtraMesh.zones,
          extraMeshScheduleTypes: standardizedExtraMesh.scheduleTypes
        };
      });
    },
    [activeMeshZone.parameters]
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
                    ? "base-mesh"
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
    setDesignAreaDrawingPurpose("no-mesh");
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
    setActiveDxfUnderlayId(null);
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDrawingPurpose("no-mesh");
    setDesignAreaDraftPoints([]);
    setBoundaryDraftPoints([]);
  }, []);

  const importSlabGeometry = useCallback(
    (nextSlabGeometry: SlabGeometry) => {
      const baseParameters = activeMeshZone.parameters;
      const importedUnderlay = nextSlabGeometry.dwgUnderlay
        ? normalizeDxfUnderlay(nextSlabGeometry.dwgUnderlay)
        : undefined;
      const strapLayerX = nextSlabGeometry.strapLayerX
        ? normalizeDxfUnderlay(nextSlabGeometry.strapLayerX)
        : undefined;
      const strapLayerY = nextSlabGeometry.strapLayerY
        ? normalizeDxfUnderlay(nextSlabGeometry.strapLayerY)
        : undefined;
      const normalizedSlabGeometry = {
        ...nextSlabGeometry,
        dwgUnderlay: importedUnderlay,
        dxfUnderlays: importedUnderlay
          ? (nextSlabGeometry.dxfUnderlays ?? [importedUnderlay]).map(
              normalizeDxfUnderlay
            )
          : [],
        strapLayerX,
        strapLayerY
      };
      const nextMainZone = createMainZoneForSlab(
        normalizedSlabGeometry,
        baseParameters
      );

      setSlabGeometry(normalizedSlabGeometry);
      setMeshZones([nextMainZone]);
      setActiveZoneId(nextMainZone.id);
      setActiveDxfUnderlayId(importedUnderlay?.id ?? null);
      setSelectedDesignAreaId(null);
      setEditingDesignAreaId(null);
      setIsDrawingZone(false);
      setIsDrawingBoundary(false);
      setIsEditingBoundary(false);
      setIsDrawingDesignArea(false);
      setDesignAreaDrawingMode(null);
      setDesignAreaDrawingPurpose("no-mesh");
      setDesignAreaDraftPoints([]);
      setBoundaryDraftPoints([]);
    },
    [activeMeshZone.parameters]
  );

  const addDxfUnderlay = useCallback((underlay: DwgUnderlay) => {
    const nextUnderlay = normalizeDxfUnderlay(underlay);

    setSlabGeometry((current) => ({
      ...current,
      dwgUnderlay: current.dwgUnderlay ?? nextUnderlay,
      dxfUnderlays: [...(current.dxfUnderlays ?? []), nextUnderlay]
    }));
    setActiveDxfUnderlayId(nextUnderlay.id ?? null);
    setShowRawStrapLayers(true);
  }, []);

  const deleteDxfUnderlayById = useCallback((underlayId: string) => {
    setSlabGeometry((current) => {
      const nextUnderlays = (current.dxfUnderlays ?? []).filter(
        (underlay) => underlay.id !== underlayId
      );

      return {
        ...current,
        dxfUnderlays: nextUnderlays,
        dwgUnderlay:
          current.dwgUnderlay?.id === underlayId
            ? nextUnderlays[0] ?? undefined
            : current.dwgUnderlay
      };
    });
    setActiveDxfUnderlayId((current) =>
      current === underlayId ? null : current
    );
  }, []);

  const setDxfUnderlayVisible = useCallback(
    (underlayId: string, visible: boolean) => {
      setSlabGeometry((current) => ({
        ...current,
        dxfUnderlays: (current.dxfUnderlays ?? []).map((underlay) =>
          underlay.id === underlayId ? { ...underlay, visible } : underlay
        ),
        strapLayerX:
          current.strapLayerX?.id === underlayId
            ? { ...current.strapLayerX, visible }
            : current.strapLayerX,
        strapLayerY:
          current.strapLayerY?.id === underlayId
            ? { ...current.strapLayerY, visible }
            : current.strapLayerY
      }));
    },
    []
  );

  const setDxfUnderlayLayerVisible = useCallback(
    (underlayId: string, layerName: string, visible: boolean) => {
      setSlabGeometry((current) => ({
        ...current,
        dxfUnderlays: (current.dxfUnderlays ?? []).map((underlay) =>
          underlay.id === underlayId
            ? {
                ...underlay,
                layers: underlay.layers?.map((layer) =>
                  layer.name === layerName ? { ...layer, visible } : layer
                )
              }
            : underlay
        ),
        strapLayerX:
          current.strapLayerX?.id === underlayId
            ? {
                ...current.strapLayerX,
                layers: current.strapLayerX.layers?.map((layer) =>
                  layer.name === layerName ? { ...layer, visible } : layer
                )
              }
            : current.strapLayerX,
        strapLayerY:
          current.strapLayerY?.id === underlayId
            ? {
                ...current.strapLayerY,
                layers: current.strapLayerY.layers?.map((layer) =>
                  layer.name === layerName ? { ...layer, visible } : layer
                )
              }
            : current.strapLayerY
      }));
    },
    []
  );

  const setDxfUnderlayScale = useCallback((underlayId: string, scale: number) => {
    const nextScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

    setSlabGeometry((current) => ({
      ...current,
      dxfUnderlays: (current.dxfUnderlays ?? []).map((underlay) =>
        underlay.id === underlayId
          ? {
              ...underlay,
              scale: nextScale
            }
          : underlay
      ),
      strapLayerX:
        current.strapLayerX?.id === underlayId
          ? { ...current.strapLayerX, scale: nextScale }
          : current.strapLayerX,
      strapLayerY:
        current.strapLayerY?.id === underlayId
          ? { ...current.strapLayerY, scale: nextScale }
          : current.strapLayerY
    }));
  }, []);

  const translateDxfUnderlay = useCallback((underlayId: string, delta: Point) => {
    setSlabGeometry((current) => ({
      ...current,
      dxfUnderlays: (current.dxfUnderlays ?? []).map((underlay) =>
        underlay.id === underlayId
          ? {
              ...underlay,
              offset: {
                x: (underlay.offset?.x ?? 0) + delta.x,
                y: (underlay.offset?.y ?? 0) + delta.y
              }
            }
          : underlay
      ),
      strapLayerX:
        current.strapLayerX?.id === underlayId
          ? {
              ...current.strapLayerX,
              offset: {
                x: (current.strapLayerX.offset?.x ?? 0) + delta.x,
                y: (current.strapLayerX.offset?.y ?? 0) + delta.y
              }
            }
          : current.strapLayerX,
      strapLayerY:
        current.strapLayerY?.id === underlayId
          ? {
              ...current.strapLayerY,
              offset: {
                x: (current.strapLayerY.offset?.x ?? 0) + delta.x,
                y: (current.strapLayerY.offset?.y ?? 0) + delta.y
              }
            }
          : current.strapLayerY
    }));
  }, []);

  const setStrapLayer = useCallback((axis: StrapLayerAxis, underlay: DwgUnderlay) => {
    const nextUnderlay = normalizeDxfUnderlay({
      ...underlay,
      id:
        underlay.id ??
        createStrapUnderlayId(axis, underlay.importedFileName ?? "strap-analysis")
    });

    setSlabGeometry((current) => ({
      ...current,
      ...(axis === "x"
        ? { strapLayerX: nextUnderlay }
        : { strapLayerY: nextUnderlay })
    }));
    setActiveDxfUnderlayId(nextUnderlay.id ?? null);
    setShowRawStrapLayers(false);
  }, []);

  const deleteStrapLayer = useCallback((axis: StrapLayerAxis) => {
    const deletedLayerId =
      axis === "x" ? slabGeometry.strapLayerX?.id : slabGeometry.strapLayerY?.id;

    setSlabGeometry((current) => ({
        ...current,
        ...(axis === "x"
          ? { strapLayerX: undefined }
          : { strapLayerY: undefined })
    }));
    setActiveDxfUnderlayId((current) =>
      current === deletedLayerId ? null : current
    );
  }, [slabGeometry.strapLayerX?.id, slabGeometry.strapLayerY?.id]);

  const setStrapNumericalData = useCallback((data: StrapNumericalData[]) => {
    setSlabGeometry((current) => ({
      ...current,
      strapNumericalData: data,
      analysisEvidenceCells: [],
      analysisIslands: [],
      extraMeshDesignZones: [],
      extraMeshScheduleTypes: [],
      strapExtraMeshZones: [],
      strapOverloadedElements: [],
      strapAnalysisDebug: undefined
    }));
  }, []);

  const runThreeWayAnalysis = useCallback(() => {
    const numericalDataByElement = new Map(
      (slabGeometry.strapNumericalData ?? []).map((row) => [
        row.elementId,
        row
      ])
    );
    const elementLabels = [
      ...collectElementLabelsFromLayer("x", slabGeometry.strapLayerX),
      ...collectElementLabelsFromLayer("y", slabGeometry.strapLayerY)
    ];
    const xElementCells = reconstructStrapElementCells("x", slabGeometry.strapLayerX);
    const yElementCells = reconstructStrapElementCells("y", slabGeometry.strapLayerY);
    const elementCells =
      xElementCells.length > 0 ? xElementCells : yElementCells;
    const cellBasedElements =
      elementCells.length > 0
        ? collectOverloadedElementsFromCells(
            elementCells,
            slabGeometry.strapNumericalData ?? []
          )
        : [];
    const dxfIds = new Set(elementLabels.map((label) => label.elementId));
    const idResolver = createStrapIdResolver(numericalDataByElement, dxfIds);
    const polygonOverloadedElements = [
      ...collectOverloadedElementsFromLayer(
        "x",
        slabGeometry.strapLayerX,
        idResolver,
        slabGeometry.boundary
      ),
      ...collectOverloadedElementsFromLayer(
        "y",
        slabGeometry.strapLayerY,
        idResolver,
        slabGeometry.boundary
      )
    ];
    const intersectingIds = [...dxfIds].filter((id) =>
      Boolean(idResolver.resolveElementId(id))
    );
    const polygonKeys = new Set(
      polygonOverloadedElements.map((element) => `${element.axis}-${element.elementId}`)
    );
    const directLabelFallbackElements = collectOverloadedElementsFromLabels(
      elementLabels.filter(
        (label) => !polygonKeys.has(`${label.axis}-${label.elementId}`)
      ),
      idResolver
    );
    const hasRepeatedLocalLabels = dxfIds.size > 0 && elementLabels.length / dxfIds.size > 3;
    const shouldUseSequentialMapping =
      hasRepeatedLocalLabels ||
      intersectingIds.length < Math.min(25, Math.max(1, dxfIds.size * 0.25));
    const sequentialElements = shouldUseSequentialMapping
      ? collectOverloadedElementsSequentially(
          elementLabels,
          slabGeometry.strapNumericalData ?? []
        )
      : [];
    const strapOverloadedElements =
      elementCells.length > 0
        ? cellBasedElements
        : shouldUseSequentialMapping
          ? sequentialElements
          : [...polygonOverloadedElements, ...directLabelFallbackElements];
    const contourDeficitPointsByAxis = {
      x: collectRawDeficitPoints(slabGeometry.strapLayerX, slabGeometry.boundary),
      y: collectRawDeficitPoints(slabGeometry.strapLayerY, slabGeometry.boundary)
    };
    const contourDeficitPoints = [
      ...contourDeficitPointsByAxis.x,
      ...contourDeficitPointsByAxis.y
    ];
    const baseParameters =
      meshZones.find((zone) => zone.isMainZone)?.parameters ?? activeMeshZone.parameters;
    const analysis = createAnalysisIslands(
      createAnalysisEvidenceCells(
        strapOverloadedElements,
        contourDeficitPointsByAxis,
        slabGeometry.boundary,
        slabGeometry.openings,
        providedAsForSettings(baseParameters)
      )
    );
    const strapExtraMeshZones: StrapExtraMeshZone[] = [];
    const maxCsvRequiredAs = Math.max(
      0,
      ...(slabGeometry.strapNumericalData ?? []).map((row) => row.maxRequiredAs)
    );
    const overloadedCsvRows = (slabGeometry.strapNumericalData ?? []).filter(
      (row) => row.maxRequiredAs > BASE_CAPACITY
    ).length;
    const strapAnalysisDebug: StrapAnalysisDebug = {
      elementLabels: elementLabels.length,
      matchedElementLabels: elementLabels.filter((label) =>
        numericalDataByElement.has(label.elementId)
      ).length,
      polygonCandidates:
        (slabGeometry.strapLayerX?.closedPolylines?.length ?? 0) +
        (slabGeometry.strapLayerY?.closedPolylines?.length ?? 0),
      overloadedElements: strapOverloadedElements.length,
      contourDeficitPoints: contourDeficitPoints.length,
      extraMeshZones: analysis.islands.length,
      elementCellCandidates: elementCells.length,
      sampleCsvElementIds: [...numericalDataByElement.keys()].slice(0, 8),
      sampleDxfElementIds: [...dxfIds].slice(0, 8),
      sampleMatchedElementIds: intersectingIds.slice(0, 8),
      inferredIdOffset: idResolver.offset ?? undefined,
      matchedUniqueIds: intersectingIds.length,
      matchingMode:
        elementCells.length > 0
          ? "elements-grid"
          : shouldUseSequentialMapping
            ? "sequential"
            : "direct-or-offset",
      maxCsvRequiredAs,
      overloadedCsvRows
    };

    setSlabGeometry((current) => ({
      ...current,
      analysisEvidenceCells: analysis.evidenceCells,
      analysisIslands: analysis.islands,
      strapExtraMeshZones,
      strapOverloadedElements,
      strapAnalysisDebug
    }));
    setAnalysisViewMode("governing");
    setShowRawStrapLayers(false);

    return strapOverloadedElements.length;
  }, [
    slabGeometry.boundary,
    slabGeometry.strapLayerX,
    slabGeometry.strapLayerY,
    slabGeometry.strapNumericalData,
    slabGeometry.openings,
    activeMeshZone.parameters,
    meshZones
  ]);

  const clearStrapAnalysis = useCallback(() => {
    const extraMeshAreaIds = new Set(
      (slabGeometry.designAreas ?? [])
        .filter((area) => area.purpose === "extra-mesh")
        .map((area) => area.id)
    );

    setSlabGeometry((current) => ({
      ...current,
      analysisEvidenceCells: [],
      analysisIslands: [],
      extraMeshDesignZones: [],
      extraMeshScheduleTypes: [],
      rawDeficitZones: [],
      strapAnalysisDebug: undefined,
      strapExtraMeshZones: [],
      strapOverloadedElements: [],
      designAreas: (current.designAreas ?? []).filter(
        (area) => area.purpose !== "extra-mesh"
      )
    }));
    setSelectedDesignAreaId((current) =>
      current && extraMeshAreaIds.has(current) ? null : current
    );
    setEditingDesignAreaId((current) =>
      current && extraMeshAreaIds.has(current) ? null : current
    );
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDrawingPurpose("no-mesh");
    setDesignAreaDraftPoints([]);
  }, [slabGeometry.designAreas]);

  const generateRawDeficitZones = useCallback(() => {
    const deficitPoints = [
      ...collectRawDeficitPoints(slabGeometry.strapLayerX, slabGeometry.boundary),
      ...collectRawDeficitPoints(slabGeometry.strapLayerY, slabGeometry.boundary)
    ];
    const rawDeficitZones = clusterRawDeficitPoints(deficitPoints);

    setSlabGeometry((current) => ({
      ...current,
      rawDeficitZones
    }));

    return rawDeficitZones.length;
  }, [slabGeometry.boundary, slabGeometry.strapLayerX, slabGeometry.strapLayerY]);

  const generateSlabFromVisibleLayers = useCallback(() => {
    const tracedBoundary =
      boundaryDraftPoints.length >= 3
        ? boundaryDraftPoints
        : slabGeometry.boundary.length >= 3 &&
            slabGeometry.dwgUnderlay?.layers?.some((layer) =>
              isCalculatedSlabLayer(layer.name)
            ) &&
            !slabGeometry.hasActiveSlabBoundary
          ? slabGeometry.boundary
          : null;
    if (!tracedBoundary || slabGeometry.hasActiveSlabBoundary) {
      return false;
    }

    const nextUnderlay = slabGeometry.dwgUnderlay
      ? {
          ...slabGeometry.dwgUnderlay,
          reviewOnly: true,
          lines: [
            ...slabGeometry.dwgUnderlay.lines.filter(
              (line) => line.layer !== calculatedSlabLayer
            ),
            calculatedSlabLine(tracedBoundary)
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
      boundary: tracedBoundary,
      dwgUnderlay: nextUnderlay,
      hasActiveSlabBoundary: true
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
    setDesignAreaDrawingPurpose("no-mesh");
    setDesignAreaDraftPoints([]);
    setBoundaryDraftPoints([]);
    return true;
  }, [activeMeshZone.parameters, boundaryDraftPoints, slabGeometry]);

  const activateBaseMeshOnWorkingSlab = useCallback((patch?: BaseMeshSettingsUpdate) => {
    if (!slabGeometry.hasActiveSlabBoundary || !slabGeometry.dwgUnderlay) {
      return false;
    }
    const nextParameters = {
      ...activeMeshZone.parameters,
      ...patch
    };

    const nextSlabGeometry: SlabGeometry = {
      ...slabGeometry,
      dwgUnderlay: {
        ...slabGeometry.dwgUnderlay,
        reviewOnly: false
      }
    };
    const nextMainZone = createMainZoneForSlab(
      nextSlabGeometry,
      nextParameters
    );

    setSlabGeometry(nextSlabGeometry);
    setMeshZones((current) => [
      nextMainZone,
      ...current.filter((zone) => !zone.isMainZone)
    ]);
    setActiveZoneId(nextMainZone.id);
    setSelectedDesignAreaId(null);
    setEditingDesignAreaId(null);
    setIsDrawingZone(false);
    setIsDrawingBoundary(false);
    setIsEditingBoundary(false);
    setIsDrawingDesignArea(false);
    setDesignAreaDrawingMode(null);
    setDesignAreaDrawingPurpose("no-mesh");
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
    setDesignAreaDrawingPurpose("no-mesh");
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
      designAreaDrawingPurpose,
      boundaryDraftPoints,
      designAreaDraftPoints,
      activeDxfUnderlayId,
      analysisViewMode,
      showRawStrapLayers,
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
      deleteStrapLayer,
      runThreeWayAnalysis,
      clearStrapAnalysis,
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
      addDxfUnderlay,
      activateBaseMeshOnWorkingSlab,
      deleteDxfUnderlayById,
      generateRawDeficitZones,
      generateSlabFromVisibleLayers,
      importSlabGeometry,
      setActiveZoneId,
      setActiveDxfUnderlayId,
      setDxfUnderlayLayerVisible,
      setDxfUnderlayScale,
      setDxfUnderlayVisible,
      setAnalysisViewMode,
      setShowRawStrapLayers,
      setStrapLayer,
      setStrapNumericalData,
      setUnderlayLayerVisible,
      translateDxfUnderlay,
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
      designAreaDrawingPurpose,
      boundaryDraftPoints,
      designAreaDraftPoints,
      activeDxfUnderlayId,
      analysisViewMode,
      showRawStrapLayers,
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
      deleteStrapLayer,
      runThreeWayAnalysis,
      clearStrapAnalysis,
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
      addDxfUnderlay,
      activateBaseMeshOnWorkingSlab,
      deleteDxfUnderlayById,
      generateRawDeficitZones,
      generateSlabFromVisibleLayers,
      importSlabGeometry,
      setUnderlayLayerVisible,
      setActiveDxfUnderlayId,
      setDxfUnderlayLayerVisible,
      setDxfUnderlayScale,
      setDxfUnderlayVisible,
      setAnalysisViewMode,
      setShowRawStrapLayers,
      setStrapLayer,
      setStrapNumericalData,
      translateDxfUnderlay,
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
