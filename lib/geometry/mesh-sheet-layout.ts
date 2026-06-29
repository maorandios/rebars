import type {
  BaseMeshSettings,
  BaseMeshOrientationComparison,
  MeshSheet,
  MeshSheetLayoutResult,
  Point,
  Polygon,
  SlabDesignArea,
  SlabGeometry
} from "@/types/structure";

import {
  applyConcreteCoverToBoundary,
  pointInPolygon,
  polygonBounds
} from "./clipping";
import {
  intersectPolygons,
  polygonArea,
  subtractPolygons
} from "./polygon-boolean";

type Bounds = ReturnType<typeof polygonBounds>;

type SheetCandidate = {
  id: string;
  row: number;
  column: number;
  x: number;
  y: number;
  activeWidth: number;
  activeLength: number;
  polygon: Polygon;
};

type SupportAlignedDirection = BaseMeshSettings["orientation"];
type SupportAxisAnchor = {
  coordinate: number;
  id: string;
};

type ActiveLayoutSettings = BaseMeshSettings & {
  orientation: BaseMeshSettings["orientation"];
};

type AxisLayout = {
  positions: number[];
  optimizedOverlap: number;
  step: number;
};

type Span = {
  start: number;
  end: number;
};

const defaultPerimeterWallThickness = 400;
const standardSheetLength = 6_000;
const standardSheetWidth = 2_500;
const supportAlignedOverlap = 400;
const supportAlignedHalfOverlap = supportAlignedOverlap / 2;

function normalizeSpan(span: Span): Span | null {
  const start = Math.max(0, Math.min(1, Math.min(span.start, span.end)));
  const end = Math.max(0, Math.min(1, Math.max(span.start, span.end)));

  if (end - start <= 0.0001) {
    return null;
  }

  return { start, end };
}

function pointAt(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
}

function segmentPolygonSpans(start: Point, end: Point, polygon: Polygon): Span[] {
  const values = [0, 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const edgeDx = b.x - a.x;
    const edgeDy = b.y - a.y;
    const denominator = dx * edgeDy - dy * edgeDx;

    if (Math.abs(denominator) < 0.000001) {
      continue;
    }

    const t = ((a.x - start.x) * edgeDy - (a.y - start.y) * edgeDx) / denominator;
    const u = ((a.x - start.x) * dy - (a.y - start.y) * dx) / denominator;

    if (t >= -0.000001 && t <= 1.000001 && u >= -0.000001 && u <= 1.000001) {
      values.push(Math.max(0, Math.min(1, t)));
    }
  }

  const sortedValues = [...new Set(values.map((value) => Number(value.toFixed(8))))].sort(
    (a, b) => a - b
  );
  const spans: Span[] = [];

  for (let index = 0; index < sortedValues.length - 1; index += 1) {
    const startT = sortedValues[index];
    const endT = sortedValues[index + 1];
    const midpoint = pointAt(start, end, (startT + endT) / 2);

    if (pointInPolygon(midpoint, polygon)) {
      const span = normalizeSpan({ start: startT, end: endT });

      if (span) {
        spans.push(span);
      }
    }
  }

  return spans;
}

function subtractSpan(spans: Span[], cut: Span) {
  return spans.flatMap((span) => {
    if (cut.end <= span.start || cut.start >= span.end) {
      return [span];
    }

    return [
      normalizeSpan({ start: span.start, end: cut.start }),
      normalizeSpan({ start: cut.end, end: span.end })
    ].filter((nextSpan): nextSpan is Span => Boolean(nextSpan));
  });
}

function subtractPolygonSpans(
  start: Point,
  end: Point,
  spans: Span[],
  holes: Polygon[]
) {
  let result = spans;

  for (const hole of holes) {
    for (const holeSpan of segmentPolygonSpans(start, end, hole)) {
      result = subtractSpan(result, holeSpan);
    }
  }

  return result;
}

function createDiagonalSegments(
  candidate: SheetCandidate,
  fragments: Polygon[],
  holes: Polygon[],
  originCorner: BaseMeshSettings["originCorner"]
): MeshSheet["diagonalSegments"] {
  return fragments.flatMap((fragment) => {
    const bounds = polygonBounds(fragment);
    const isLeftOrigin = originCorner.endsWith("left");
    const isTopOrigin = originCorner.startsWith("top");
    const start = {
      x: isLeftOrigin ? bounds.minX : bounds.maxX,
      y: isTopOrigin ? bounds.minY : bounds.maxY
    };
    const end = {
      x: isLeftOrigin ? bounds.maxX : bounds.minX,
      y: isTopOrigin ? bounds.maxY : bounds.minY
    };

    return subtractPolygonSpans(
      start,
      end,
      segmentPolygonSpans(start, end, fragment),
      holes
    ).map((span) => ({
      start: pointAt(start, end, span.start),
      end: pointAt(start, end, span.end)
    }));
  });
}

function interpolateBoundary(
  from: Polygon,
  to: Polygon,
  distance: number
): Polygon {
  if (from.length !== to.length) {
    return to;
  }

  return from.map((point, index) => {
    const target = to[index];
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const length = Math.hypot(dx, dy);

    if (length === 0) {
      return point;
    }

    const ratio = Math.min(1, Math.max(0, distance / length));

    return {
      x: point.x + dx * ratio,
      y: point.y + dy * ratio
    };
  });
}

function getOuterCoverBoundary(slabGeometry: SlabGeometry) {
  if (slabGeometry.dwgUnderlay && !slabGeometry.dwgUnderlay.reviewOnly) {
    return slabGeometry.meshBoundary ?? slabGeometry.boundary;
  }

  return (
    slabGeometry.meshBoundary ??
    applyConcreteCoverToBoundary(slabGeometry.boundary, slabGeometry.concreteCover)
  );
}

function getMeshInteriorBoundary(slabGeometry: SlabGeometry) {
  if (slabGeometry.meshInteriorBoundary) {
    return slabGeometry.meshInteriorBoundary;
  }

  if (slabGeometry.dwgUnderlay && !slabGeometry.dwgUnderlay.reviewOnly) {
    return applyConcreteCoverToBoundary(
      slabGeometry.boundary,
      defaultPerimeterWallThickness
    );
  }

  return undefined;
}

function getMeshPlacementBoundary(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings
) {
  const outerCoverBoundary = getOuterCoverBoundary(slabGeometry);
  const meshInteriorBoundary = getMeshInteriorBoundary(slabGeometry);

  if (!meshInteriorBoundary) {
    return outerCoverBoundary;
  }

  return interpolateBoundary(
    outerCoverBoundary,
    meshInteriorBoundary,
    settings.wallAnchorageDepth
  );
}

function getGridOriginBoundary(slabGeometry: SlabGeometry) {
  return slabGeometry.boundary;
}

function polygonCollectionArea(polygons: Polygon[]) {
  return polygons.reduce(
    (sum, polygon) => sum + Math.abs(polygonArea(polygon)),
    0
  );
}

function expandAxisAlignedVoid(polygon: Polygon, offset: number): Polygon {
  const bounds = polygonBounds(polygon);

  return createSheetRectangle(
    bounds.minX - offset,
    bounds.minY - offset,
    bounds.maxX - bounds.minX + offset * 2,
    bounds.maxY - bounds.minY + offset * 2
  );
}

function getOpeningExclusionPolygons(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings
) {
  const structuralOpeningExclusions = slabGeometry.openings.map((opening) => {
    if (opening.wallThickness === 0) {
      return opening.polygon;
    }

    return expandAxisAlignedVoid(
      opening.polygon,
      Math.max(
        slabGeometry.concreteCover,
        (opening.wallThickness ?? 250) - settings.wallAnchorageDepth
      )
    );
  });
  const designAreaExclusions = (slabGeometry.designAreas ?? [])
    .filter(isMeshExclusionArea)
    .map((area) => area.polygon);

  return [...structuralOpeningExclusions, ...designAreaExclusions];
}

function isMeshExclusionArea(area: SlabDesignArea) {
  return area.purpose === "void" || area.purpose === "no-mesh";
}

export function getActiveSheetDimensions(settings: BaseMeshSettings) {
  return settings.orientation === "horizontal"
    ? {
        activeWidth: settings.sheetWidth,
        activeLength: settings.sheetLength,
        stepX: Math.max(1, settings.sheetWidth - settings.overlapX),
        stepY: Math.max(1, settings.sheetLength - settings.overlapY)
      }
    : {
        activeWidth: settings.sheetLength,
        activeLength: settings.sheetWidth,
        stepX: Math.max(1, settings.sheetLength - settings.overlapX),
        stepY: Math.max(1, settings.sheetWidth - settings.overlapY)
      };
}

export function createSheetRectangle(
  x: number,
  y: number,
  width: number,
  length: number
): Polygon {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + length },
    { x, y: y + length }
  ];
}

function supportAxisDirection(axis: NonNullable<SlabGeometry["supportAxes"]>[number]) {
  const dx = axis.end.x - axis.start.x;
  const dy = axis.end.y - axis.start.y;

  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
}

function samePoint(first: Point, second: Point) {
  return Math.abs(first.x - second.x) < 0.001 && Math.abs(first.y - second.y) < 0.001;
}

function isSlabBoundaryZone(slabGeometry: SlabGeometry, zoneGeometry?: Polygon) {
  if (!zoneGeometry) {
    return true;
  }

  return (
    zoneGeometry.length === slabGeometry.boundary.length &&
    zoneGeometry.every((point, index) => samePoint(point, slabGeometry.boundary[index]))
  );
}

function supportAxisAnchors(
  slabGeometry: SlabGeometry,
  direction: SupportAlignedDirection
) {
  const targetAxisDirection = direction === "horizontal" ? "horizontal" : "vertical";

  return (slabGeometry.supportAxes ?? [])
    .filter(
      (supportAxis) =>
        supportAxis.visible !== false &&
        supportAxisDirection(supportAxis) === targetAxisDirection
    )
    .map<SupportAxisAnchor>((axis) => ({
      coordinate:
        targetAxisDirection === "horizontal"
          ? (axis.start.y + axis.end.y) / 2
          : (axis.start.x + axis.end.x) / 2,
      id: axis.id
    }));
}

function anchoredPositions(
  min: number,
  max: number,
  size: number,
  step: number,
  anchorStart: number
) {
  const positions = [];
  let current = anchorStart;

  while (current > min) {
    current -= step;
  }

  while (current + size < min) {
    current += step;
  }

  for (let value = current; value <= max; value += step) {
    positions.push(value);
  }

  if (positions.length === 0 || positions[positions.length - 1] + size < max) {
    positions.push((positions.at(-1) ?? current) + step);
  }

  return positions;
}

function supportAlignedSettings(
  settings: BaseMeshSettings,
  orientation: SupportAlignedDirection
): ActiveLayoutSettings {
  return {
    ...settings,
    sheetLength: standardSheetLength,
    sheetWidth: standardSheetWidth,
    overlapX: supportAlignedOverlap,
    overlapY: supportAlignedOverlap,
    orientation
  };
}

function generateSupportAlignedSheetCandidates(
  bounds: Bounds,
  settings: ActiveLayoutSettings,
  supportAnchors: {
    x: SupportAxisAnchor | null;
    y: SupportAxisAnchor | null;
  }
) {
  const isHorizontal = settings.orientation === "horizontal";
  const activeWidth = isHorizontal ? standardSheetLength : standardSheetWidth;
  const activeLength = isHorizontal ? standardSheetWidth : standardSheetLength;
  const stepX = activeWidth - supportAlignedOverlap;
  const stepY = activeLength - supportAlignedOverlap;
  const anchorX =
    supportAnchors.x
      ? supportAnchors.x.coordinate - supportAlignedHalfOverlap
      : bounds.minX;
  const anchorY =
    supportAnchors.y
      ? supportAnchors.y.coordinate - supportAlignedHalfOverlap
      : bounds.minY;
  const xPositions = anchoredPositions(
    bounds.minX,
    bounds.maxX,
    activeWidth,
    stepX,
    anchorX
  );
  const yPositions = anchoredPositions(
    bounds.minY,
    bounds.maxY,
    activeLength,
    stepY,
    anchorY
  );

  return {
    candidates: yPositions.flatMap((y, row) =>
      xPositions.map((x, column) => ({
        id: `MS-SA-${settings.orientation === "horizontal" ? "H" : "V"}-R${String(
          row + 1
        ).padStart(2, "0")}-C${String(column + 1).padStart(2, "0")}`,
        row,
        column,
        x,
        y,
        activeWidth,
        activeLength,
        polygon: createSheetRectangle(x, y, activeWidth, activeLength)
      }))
    ),
    overlapX: supportAlignedOverlap,
    overlapY: supportAlignedOverlap,
    stepX,
    stepY
  };
}

function optimizeAxisLayout(
  min: number,
  max: number,
  originMin: number,
  originMax: number,
  size: number,
  overlap: number,
  reverse: boolean,
  offset: number
): AxisLayout {
  const minimumEndStrip = 500;
  const baseStep = Math.max(1, size - overlap);
  const anchorStart = reverse
    ? originMax - size - offset
    : originMin + offset;
  const anchorEnd = reverse ? originMax - offset : anchorStart + size;
  const effectiveMin = reverse ? min : Math.max(min, anchorStart);
  const effectiveMax = reverse ? Math.min(max, anchorEnd) : max;
  const extent = Math.max(0, effectiveMax - effectiveMin);

  if (extent <= 0) {
    return {
      positions: [],
      optimizedOverlap: overlap,
      step: baseStep
    };
  }

  if (extent <= size) {
    return {
      positions: [anchorStart],
      optimizedOverlap: overlap,
      step: baseStep
    };
  }

  const sheetCount = Math.ceil((extent - size) / baseStep) + 1;
  const finalVisibleLength = extent - (sheetCount - 1) * baseStep;
  const shouldRedistribute =
    finalVisibleLength > 0 &&
    finalVisibleLength < minimumEndStrip &&
    sheetCount > 1;
  const step = shouldRedistribute
    ? Math.max(1, (extent - minimumEndStrip) / (sheetCount - 1))
    : baseStep;
  const optimizedOverlap = Math.max(0, size - step);
  let start = anchorStart;

  if (reverse) {
    while (start > max) {
      start -= step;
    }
  } else {
    while (start + size < min) {
      start += step;
    }
  }

  const positions: number[] = [];

  if (reverse) {
    for (let value = start; value + size >= min; value -= step) {
      positions.push(value);
    }

    return {
      positions: positions.reverse(),
      optimizedOverlap,
      step
    };
  }

  for (let value = start; value <= max; value += step) {
    positions.push(value);
  }

  if (positions.length === 0 || positions[positions.length - 1] + size < max) {
    positions.push(
      (positions.length > 0 ? positions[positions.length - 1] : start) + step
    );
  }

  return {
    positions,
    optimizedOverlap,
    step
  };
}

export function generateSheetCandidates(
  bounds: Bounds,
  originBounds: Bounds,
  settings: ActiveLayoutSettings
): {
  candidates: SheetCandidate[];
  overlapX: number;
  overlapY: number;
  stepX: number;
  stepY: number;
} {
  const { activeWidth, activeLength } = getActiveSheetDimensions(settings);
  const reverseX = settings.originCorner.endsWith("right");
  const reverseY = settings.originCorner.startsWith("bottom");
  const xLayout = optimizeAxisLayout(
    bounds.minX,
    bounds.maxX,
    originBounds.minX,
    originBounds.maxX,
    activeWidth,
    settings.overlapX,
    reverseX,
    settings.gridOffsetX
  );
  const yLayout = optimizeAxisLayout(
    bounds.minY,
    bounds.maxY,
    originBounds.minY,
    originBounds.maxY,
    activeLength,
    settings.overlapY,
    reverseY,
    settings.gridOffsetY
  );

  return {
    candidates: yLayout.positions.flatMap((y, row) =>
      xLayout.positions.map((x, column) => ({
        id: `MS-${settings.orientation === "horizontal" ? "H" : "V"}-R${String(
          row + 1
        ).padStart(2, "0")}-C${String(column + 1).padStart(2, "0")}`,
        row,
        column,
        x,
        y,
        activeWidth,
        activeLength,
        polygon: createSheetRectangle(x, y, activeWidth, activeLength)
      }))
    ),
    overlapX: xLayout.optimizedOverlap,
    overlapY: yLayout.optimizedOverlap,
    stepX: xLayout.step,
    stepY: yLayout.step
  };
}

export function clipSheetToSlab(
  candidate: SheetCandidate,
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = []
) {
  const placementBoundary = getMeshPlacementBoundary(slabGeometry, settings);
  const insideSlab = intersectPolygons(candidate.polygon, placementBoundary);
  const insideZone = zoneGeometry
    ? insideSlab.flatMap((fragment) => intersectPolygons(fragment, zoneGeometry))
    : insideSlab;

  return insideZone.flatMap((fragment) =>
    subtractPolygons(
      fragment,
      [...getOpeningExclusionPolygons(slabGeometry, settings), ...exclusionPolygons]
    )
  );
}

function isSheetCut(candidate: SheetCandidate, visiblePolygons: Polygon[]) {
  return (
    visiblePolygons.length !== 1 ||
    visiblePolygons[0].length !== candidate.polygon.length ||
    visiblePolygons[0].some((point, index) => {
      const original = candidate.polygon[index];

      return !original || original.x !== point.x || original.y !== point.y;
    })
  );
}

export function generateBaseMeshLayout(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = []
): MeshSheetLayoutResult {
  if (
    slabGeometry.baseMeshSelection &&
    slabGeometry.supportAxes?.length &&
    isSlabBoundaryZone(slabGeometry, zoneGeometry)
  ) {
    return generateSupportAlignedLayout(
      slabGeometry,
      settings,
      zoneGeometry,
      exclusionPolygons
    );
  }

  return generateLayoutForOrientation(
    slabGeometry,
    settings,
    zoneGeometry,
    exclusionPolygons
  );
}

export function findMostEfficientLayoutDirection(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = []
) {
  const horizontal = generateBestSupportAlignedLayoutForOrientation(
    slabGeometry,
    supportAlignedSettings(settings, "horizontal"),
    zoneGeometry,
    exclusionPolygons
  );
  const vertical = generateBestSupportAlignedLayoutForOrientation(
    slabGeometry,
    supportAlignedSettings(settings, "vertical"),
    zoneGeometry,
    exclusionPolygons
  );

  return vertical.rawSheetArea < horizontal.rawSheetArea ||
    (vertical.rawSheetArea === horizontal.rawSheetArea &&
      vertical.cutWasteArea < horizontal.cutWasteArea)
    ? vertical
    : horizontal;
}

function generateSupportAlignedLayout(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = []
) {
  return findMostEfficientLayoutDirection(
    slabGeometry,
    settings,
    zoneGeometry,
    exclusionPolygons
  );
}

export function compareBaseMeshOrientations(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings,
  zoneGeometry?: Polygon
): BaseMeshOrientationComparison {
  const horizontal = generateLayoutForOrientation(
    slabGeometry,
    {
      ...settings,
      orientation: "horizontal"
    },
    zoneGeometry
  );
  const vertical = generateLayoutForOrientation(
    slabGeometry,
    {
      ...settings,
      orientation: "vertical"
    },
    zoneGeometry
  );

  const recommended =
    vertical.cutWasteArea < horizontal.cutWasteArea ||
    (vertical.cutWasteArea === horizontal.cutWasteArea &&
      vertical.sheetCount < horizontal.sheetCount)
      ? vertical
      : horizontal;
  const active =
    settings.orientation === "horizontal" ? horizontal : vertical;

  return {
    horizontal,
    vertical,
    recommendedOrientation: recommended.selectedOrientation,
    recommended,
    active
  };
}

function generateLayoutForOrientation(
  slabGeometry: SlabGeometry,
  settings: ActiveLayoutSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = []
): MeshSheetLayoutResult {
  const placementBoundary = getMeshPlacementBoundary(slabGeometry, settings);
  const emptyResult: MeshSheetLayoutResult = {
    sheets: [],
    discardedCount: 0,
    requestedOrientation: settings.orientation,
    selectedOrientation: settings.orientation,
    sheetCount: 0,
    rawSheetArea: 0,
    visibleArea: 0,
    cutWasteArea: 0,
    optimizedOverlapX: settings.overlapX,
    optimizedOverlapY: settings.overlapY,
    stepX: Math.max(1, settings.sheetWidth - settings.overlapX),
    stepY: Math.max(1, settings.sheetLength - settings.overlapY)
  };

  if (placementBoundary.length < 3) {
    return emptyResult;
  }

  const layoutBoundary = zoneGeometry
    ? intersectPolygons(placementBoundary, zoneGeometry)[0] ?? placementBoundary
    : placementBoundary;

  if (layoutBoundary.length < 3) {
    return emptyResult;
  }

  const originBoundary = getGridOriginBoundary(slabGeometry);
  const candidateLayout = generateSheetCandidates(
    polygonBounds(layoutBoundary),
    polygonBounds(originBoundary),
    settings
  );
  const holes = getOpeningExclusionPolygons(slabGeometry, settings);
  let discardedCount = 0;
  let visibleArea = 0;
  const sheets = candidateLayout.candidates.flatMap<MeshSheet>((candidate) => {
    const visiblePolygons = clipSheetToSlab(
      candidate,
      slabGeometry,
      settings,
      zoneGeometry,
      exclusionPolygons
    );

    if (visiblePolygons.length === 0) {
      discardedCount += 1;
      return [];
    }

    visibleArea += polygonCollectionArea(visiblePolygons);

    return {
      id: candidate.id,
      width: settings.sheetWidth,
      length: settings.sheetLength,
      activeWidth: candidate.activeWidth,
      activeLength: candidate.activeLength,
      x: candidate.x,
      y: candidate.y,
      orientation: settings.orientation,
      isCut: isSheetCut(candidate, visiblePolygons),
      visiblePolygon: visiblePolygons[0],
      visiblePolygons,
      diagonalSegments: createDiagonalSegments(
        candidate,
        visiblePolygons,
        holes,
        settings.originCorner
      )
    };
  });
  const rawSheetArea =
    sheets.length * sheets[0]?.activeWidth * sheets[0]?.activeLength || 0;

  return {
    sheets,
    discardedCount,
    requestedOrientation: settings.orientation,
    selectedOrientation: settings.orientation,
    sheetCount: sheets.length,
    rawSheetArea,
    visibleArea,
    cutWasteArea: Math.max(0, rawSheetArea - visibleArea),
    optimizedOverlapX: candidateLayout.overlapX,
    optimizedOverlapY: candidateLayout.overlapY,
    stepX: candidateLayout.stepX,
    stepY: candidateLayout.stepY
  };
}

function generateSupportAlignedLayoutForOrientation(
  slabGeometry: SlabGeometry,
  settings: ActiveLayoutSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = [],
  supportAnchors: {
    x: SupportAxisAnchor | null;
    y: SupportAxisAnchor | null;
  } = { x: null, y: null }
): MeshSheetLayoutResult {
  const placementBoundary = getMeshPlacementBoundary(slabGeometry, settings);
  const emptyResult: MeshSheetLayoutResult = {
    sheets: [],
    discardedCount: 0,
    requestedOrientation: settings.orientation,
    selectedOrientation: settings.orientation,
    sheetCount: 0,
    rawSheetArea: 0,
    visibleArea: 0,
    cutWasteArea: 0,
    optimizedOverlapX: supportAlignedOverlap,
    optimizedOverlapY: supportAlignedOverlap,
    stepX:
      (settings.orientation === "horizontal"
        ? standardSheetLength
        : standardSheetWidth) - supportAlignedOverlap,
    stepY:
      (settings.orientation === "horizontal"
        ? standardSheetWidth
        : standardSheetLength) - supportAlignedOverlap
  };

  if (placementBoundary.length < 3) {
    return emptyResult;
  }

  const layoutBoundary = zoneGeometry
    ? intersectPolygons(placementBoundary, zoneGeometry)[0] ?? placementBoundary
    : placementBoundary;

  if (layoutBoundary.length < 3) {
    return emptyResult;
  }

  const candidateLayout = generateSupportAlignedSheetCandidates(
    polygonBounds(layoutBoundary),
    settings,
    supportAnchors
  );
  const holes = getOpeningExclusionPolygons(slabGeometry, settings);
  let discardedCount = 0;
  let visibleArea = 0;
  const sheets = candidateLayout.candidates.flatMap<MeshSheet>((candidate) => {
    const visiblePolygons = clipSheetToSlab(
      candidate,
      slabGeometry,
      settings,
      zoneGeometry,
      exclusionPolygons
    );

    if (visiblePolygons.length === 0) {
      discardedCount += 1;
      return [];
    }

    visibleArea += polygonCollectionArea(visiblePolygons);

    return {
      id: candidate.id,
      width: standardSheetWidth,
      length: standardSheetLength,
      activeWidth: candidate.activeWidth,
      activeLength: candidate.activeLength,
      x: candidate.x,
      y: candidate.y,
      orientation: settings.orientation,
      isCut: isSheetCut(candidate, visiblePolygons),
      visiblePolygon: visiblePolygons[0],
      visiblePolygons,
      diagonalSegments: createDiagonalSegments(
        candidate,
        visiblePolygons,
        holes,
        settings.originCorner
      )
    };
  });
  const rawSheetArea = sheets.length * standardSheetLength * standardSheetWidth;

  return {
    sheets,
    discardedCount,
    requestedOrientation: settings.orientation,
    selectedOrientation: settings.orientation,
    sheetCount: sheets.length,
    rawSheetArea,
    visibleArea,
    cutWasteArea: Math.max(0, rawSheetArea - visibleArea),
    optimizedOverlapX: candidateLayout.overlapX,
    optimizedOverlapY: candidateLayout.overlapY,
    stepX: candidateLayout.stepX,
    stepY: candidateLayout.stepY
  };
}

function isBetterSupportAlignedLayout(
  candidate: MeshSheetLayoutResult,
  current: MeshSheetLayoutResult
) {
  return (
    candidate.rawSheetArea < current.rawSheetArea ||
    (candidate.rawSheetArea === current.rawSheetArea &&
      candidate.cutWasteArea < current.cutWasteArea) ||
    (candidate.rawSheetArea === current.rawSheetArea &&
      candidate.cutWasteArea === current.cutWasteArea &&
      candidate.visibleArea > current.visibleArea)
  );
}

function nearestLapDistance(coordinate: number, sheetStarts: number[]) {
  if (sheetStarts.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return sheetStarts.reduce(
    (nearest, start) =>
      Math.min(nearest, Math.abs(coordinate - (start + supportAlignedHalfOverlap))),
    Number.POSITIVE_INFINITY
  );
}

function axisAlignmentPenalty(anchors: SupportAxisAnchor[], sheetStarts: number[]) {
  return anchors.reduce(
    (sum, anchor) => sum + nearestLapDistance(anchor.coordinate, sheetStarts),
    0
  );
}

function supportAlignedLayoutScore(
  slabGeometry: SlabGeometry,
  settings: ActiveLayoutSettings,
  supportAnchors: {
    x: SupportAxisAnchor | null;
    y: SupportAxisAnchor | null;
  },
  layoutBoundary: Polygon
) {
  const bounds = polygonBounds(layoutBoundary);
  const candidateLayout = generateSupportAlignedSheetCandidates(
    bounds,
    settings,
    supportAnchors
  );
  const verticalAxes = supportAxisAnchors(slabGeometry, "vertical");
  const horizontalAxes = supportAxisAnchors(slabGeometry, "horizontal");
  const xStarts = [
    ...new Set(candidateLayout.candidates.map((candidate) => candidate.x))
  ];
  const yStarts = [
    ...new Set(candidateLayout.candidates.map((candidate) => candidate.y))
  ];

  return (
    axisAlignmentPenalty(verticalAxes, xStarts) +
    axisAlignmentPenalty(horizontalAxes, yStarts)
  );
}

function isBetterScoredSupportAlignedLayout(
  candidate: {
    alignmentPenalty: number;
    layout: MeshSheetLayoutResult;
  },
  current: {
    alignmentPenalty: number;
    layout: MeshSheetLayoutResult;
  }
) {
  return (
    candidate.alignmentPenalty < current.alignmentPenalty ||
    (candidate.alignmentPenalty === current.alignmentPenalty &&
      isBetterSupportAlignedLayout(candidate.layout, current.layout))
  );
}

function generateBestSupportAlignedLayoutForOrientation(
  slabGeometry: SlabGeometry,
  settings: ActiveLayoutSettings,
  zoneGeometry?: Polygon,
  exclusionPolygons: Polygon[] = []
) {
  const placementBoundary = getMeshPlacementBoundary(slabGeometry, settings);

  if (placementBoundary.length < 3) {
    return generateSupportAlignedLayoutForOrientation(
      slabGeometry,
      settings,
      zoneGeometry,
      exclusionPolygons
    );
  }

  const layoutBoundary = zoneGeometry
    ? intersectPolygons(placementBoundary, zoneGeometry)[0] ?? placementBoundary
    : placementBoundary;

  if (layoutBoundary.length < 3) {
    return generateSupportAlignedLayoutForOrientation(
      slabGeometry,
      settings,
      zoneGeometry,
      exclusionPolygons
    );
  }

  const xAnchors = supportAxisAnchors(slabGeometry, "vertical");
  const yAnchors = supportAxisAnchors(slabGeometry, "horizontal");
  const candidateXAnchors = xAnchors.length > 0 ? xAnchors : [null];
  const candidateYAnchors = yAnchors.length > 0 ? yAnchors : [null];
  const scoredLayouts = candidateXAnchors.flatMap((xAnchor) =>
    candidateYAnchors.map((yAnchor) => {
      const supportAnchors = { x: xAnchor, y: yAnchor };
      const layout = generateSupportAlignedLayoutForOrientation(
        slabGeometry,
        settings,
        zoneGeometry,
        exclusionPolygons,
        supportAnchors
      );

      return {
        alignmentPenalty: supportAlignedLayoutScore(
          slabGeometry,
          settings,
          supportAnchors,
          layoutBoundary
        ),
        layout
      };
    })
  );

  return scoredLayouts
    .reduce((best, candidate) =>
      isBetterScoredSupportAlignedLayout(candidate, best) ? candidate : best
    )
    .layout;
}

export const generateMeshSheetLayout = generateBaseMeshLayout;
