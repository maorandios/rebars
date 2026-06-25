export type Point = {
  x: number;
  y: number;
};

export type Polygon = Point[];

export type CadLineEntity = {
  id: string;
  layer: string;
  color?: string;
  lineWeightPx?: number;
  points: Point[];
};

export type CadTextEntity = {
  id: string;
  layer: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  color?: string;
  heightPx?: number;
  position: Point;
  rotation?: number;
  text: string;
};

export type CadCircleEntity = {
  id: string;
  layer: string;
  center: Point;
  color?: string;
  lineWeightPx?: number;
  radius: number;
};

export type CadArcEntity = {
  id: string;
  layer: string;
  center: Point;
  color?: string;
  endAngle: number;
  lineWeightPx?: number;
  radius: number;
  startAngle: number;
};

export type DwgUnderlayLayer = {
  entityCount: number;
  name: string;
  visible: boolean;
};

export type CadClosedPolylineCandidate = {
  area: number;
  id: string;
  layer: string;
  polygon: Polygon;
};

export type DwgUnderlay = {
  arcs?: CadArcEntity[];
  bounds?: {
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
  };
  circles?: CadCircleEntity[];
  closedPolylines?: CadClosedPolylineCandidate[];
  id?: string;
  importedFileName?: string;
  offset?: Point;
  reviewOnly?: boolean;
  scale?: number;
  dxfVertices?: Point[];
  layers?: DwgUnderlayLayer[];
  lines: CadLineEntity[];
  texts: CadTextEntity[];
  visible?: boolean;
};

export type SlabOpening = {
  id: string;
  label: string;
  polygon: Polygon;
  wallThickness?: number;
};

export type SlabDesignAreaPurpose =
  | "void"
  | "no-mesh"
  | "base-mesh"
  | "extra-mesh"
  | "analysis-zone"
  | "custom";

export type SlabDesignAreaSource = "user" | "dxf" | "fea";

export type SlabDesignArea = {
  id: string;
  label: string;
  polygon: Polygon;
  purpose: SlabDesignAreaPurpose;
  priority: number;
  visible: boolean;
  source: SlabDesignAreaSource;
  meshZoneId?: string;
};

export type RawDeficitZone = {
  x: number;
  y: number;
  width: number;
  height: number;
  maxRequiredAs: number;
};

export type StrapNumericalData = {
  elementId: string;
  maxAsxTop: number;
  maxAsyTop: number;
  maxAsxBottom: number;
  maxAsyBottom: number;
  maxRequiredAs: number;
};

export type StrapOverloadedElement = {
  id: string;
  axis: "x" | "y";
  elementId: string;
  polygon: Polygon;
  maxRequiredAs: number;
};

export type StrapExtraMeshZone = {
  id: string;
  label: string;
  kind: "patch" | "strip";
  orientation?: "horizontal" | "vertical";
  polygon: Polygon;
  contourPointCount: number;
  overloadedElementCount: number;
  maxRequiredAs: number;
  recommendedExtraAs: number;
};

export type StrapAnalysisDebug = {
  contourDeficitPoints?: number;
  elementCellCandidates?: number;
  extraMeshZones?: number;
  elementLabels: number;
  matchedElementLabels: number;
  polygonCandidates: number;
  overloadedElements: number;
  sampleCsvElementIds?: string[];
  sampleDxfElementIds?: string[];
  sampleMatchedElementIds?: string[];
  inferredIdOffset?: number;
  matchingMode?: "direct-or-offset" | "elements-grid" | "sequential";
  matchedUniqueIds?: number;
  maxCsvRequiredAs?: number;
  overloadedCsvRows?: number;
};

export type StructuralElementType = "perimeter_wall" | "core_wall" | "column";

export type StructuralElement = {
  id: string;
  label: string;
  type: StructuralElementType;
  polygon: Polygon;
};

export type SlabGeometry = {
  boundary: Polygon;
  hasActiveSlabBoundary?: boolean;
  meshBoundary?: Polygon;
  meshInteriorBoundary?: Polygon;
  dwgUnderlay?: DwgUnderlay;
  dxfUnderlays?: DwgUnderlay[];
  strapLayerX?: DwgUnderlay;
  strapLayerY?: DwgUnderlay;
  strapNumericalData?: StrapNumericalData[];
  strapOverloadedElements?: StrapOverloadedElement[];
  strapExtraMeshZones?: StrapExtraMeshZone[];
  strapAnalysisDebug?: StrapAnalysisDebug;
  rawDeficitZones?: RawDeficitZone[];
  designAreas?: SlabDesignArea[];
  openings: SlabOpening[];
  structuralElements: StructuralElement[];
  concreteCover: number;
};

export type BaseMeshSettings = {
  diameter: 8 | 10 | 12;
  spacing: 150 | 200 | 250;
  sheetWidth: number;
  sheetLength: number;
  overlapX: number;
  overlapY: number;
  originCorner: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  gridOffsetX: number;
  gridOffsetY: number;
  orientation: "horizontal" | "vertical";
  wallAnchorageDepth: number;
};

export type MeshZone = {
  id: string;
  name: string;
  isMainZone: boolean;
  geometry: Polygon;
  parameters: BaseMeshSettings;
};

export type StructuralModel = {
  slabGeometry: SlabGeometry;
  meshZones: MeshZone[];
  activeZoneId: string;
};

export type BaseMeshSettingsUpdate = Partial<BaseMeshSettings>;
export type MeshZoneUpdate = Partial<Omit<MeshZone, "id" | "parameters">> & {
  parameters?: BaseMeshSettingsUpdate;
};

export interface MeshSheet {
  id: string;
  width: number;
  length: number;
  activeWidth: number;
  activeLength: number;
  x: number;
  y: number;
  orientation: BaseMeshSettings["orientation"];
  isCut: boolean;
  visiblePolygon: { x: number; y: number }[];
  visiblePolygons: { x: number; y: number }[][];
  diagonalSegments: { start: Point; end: Point }[];
  zoneId?: string;
}

export type MeshSheetLayoutResult = {
  sheets: MeshSheet[];
  discardedCount: number;
  requestedOrientation: BaseMeshSettings["orientation"];
  selectedOrientation: BaseMeshSettings["orientation"];
  sheetCount: number;
  rawSheetArea: number;
  visibleArea: number;
  cutWasteArea: number;
  optimizedOverlapX: number;
  optimizedOverlapY: number;
  stepX: number;
  stepY: number;
};

export type BaseMeshOrientationComparison = {
  horizontal: MeshSheetLayoutResult;
  vertical: MeshSheetLayoutResult;
  recommendedOrientation: BaseMeshSettings["orientation"];
  recommended: MeshSheetLayoutResult;
  active: MeshSheetLayoutResult;
};

export type ExportedReinforcementConfiguration = {
  exportedAt: string;
  standard: "IS-466";
  slabGeometry: SlabGeometry;
  meshZones: MeshZone[];
  activeZoneId: string;
};
