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
  color?: string;
  heightPx?: number;
  position: Point;
  rotation?: number;
  text: string;
};

export type DwgUnderlay = {
  lines: CadLineEntity[];
  texts: CadTextEntity[];
};

export type SlabOpening = {
  id: string;
  label: string;
  polygon: Polygon;
  wallThickness?: number;
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
  meshBoundary?: Polygon;
  meshInteriorBoundary?: Polygon;
  dwgUnderlay?: DwgUnderlay;
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
