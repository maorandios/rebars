import type {
  BaseMeshSettings,
  BaseMeshOrientationComparison,
  MeshSheet,
  MeshSheetLayoutResult,
  Point,
  Polygon,
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
  return (
    slabGeometry.meshBoundary ??
    applyConcreteCoverToBoundary(slabGeometry.boundary, slabGeometry.concreteCover)
  );
}

function getMeshPlacementBoundary(
  slabGeometry: SlabGeometry,
  settings: BaseMeshSettings
) {
  const outerCoverBoundary = getOuterCoverBoundary(slabGeometry);

  if (!slabGeometry.meshInteriorBoundary) {
    return outerCoverBoundary;
  }

  return interpolateBoundary(
    slabGeometry.meshInteriorBoundary,
    outerCoverBoundary,
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
  return slabGeometry.openings.map((opening) =>
    expandAxisAlignedVoid(
      opening.polygon,
      Math.max(
        slabGeometry.concreteCover,
        (opening.wallThickness ?? 250) - settings.wallAnchorageDepth
      )
    )
  );
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
  return generateLayoutForOrientation(
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
  const layoutBoundary = zoneGeometry
    ? intersectPolygons(placementBoundary, zoneGeometry)[0] ?? placementBoundary
    : placementBoundary;
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

export const generateMeshSheetLayout = generateBaseMeshLayout;
