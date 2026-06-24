import type { Point, Polygon, SlabGeometry } from "@/types/structure";

export type Axis = "horizontal" | "vertical";

export type AxisLine = {
  axis: Axis;
  coordinate: number;
  min: number;
  max: number;
};

export type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

type Span = {
  start: number;
  end: number;
};

export function polygonBounds(polygon: Polygon) {
  return {
    minX: Math.min(...polygon.map((point) => point.x)),
    minY: Math.min(...polygon.map((point) => point.y)),
    maxX: Math.max(...polygon.map((point) => point.x)),
    maxY: Math.max(...polygon.map((point) => point.y))
  };
}

export function pointInPolygon(point: Point, polygon: Polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function signedPolygonArea(polygon: Polygon) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];

    return sum + point.x * next.y - next.x * point.y;
  }, 0);
}

function intersectInfiniteLines(
  firstStart: Point,
  firstEnd: Point,
  secondStart: Point,
  secondEnd: Point
) {
  const firstDx = firstEnd.x - firstStart.x;
  const firstDy = firstEnd.y - firstStart.y;
  const secondDx = secondEnd.x - secondStart.x;
  const secondDy = secondEnd.y - secondStart.y;
  const denominator = firstDx * secondDy - firstDy * secondDx;

  if (Math.abs(denominator) < 0.000001) {
    return null;
  }

  const t =
    ((secondStart.x - firstStart.x) * secondDy -
      (secondStart.y - firstStart.y) * secondDx) /
    denominator;

  return {
    x: firstStart.x + firstDx * t,
    y: firstStart.y + firstDy * t
  };
}

export function applyConcreteCoverToBoundary(boundary: Polygon, cover: number) {
  if (boundary.length < 3 || cover <= 0) {
    return boundary;
  }

  const area = signedPolygonArea(boundary);
  const inwardSign = area >= 0 ? 1 : -1;
  const offsetEdges = boundary.map((start, index) => {
    const end = boundary[(index + 1) % boundary.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length === 0) {
      return { end, start };
    }

    const normal = {
      x: (-dy / length) * cover * inwardSign,
      y: (dx / length) * cover * inwardSign
    };

    return {
      start: { x: start.x + normal.x, y: start.y + normal.y },
      end: { x: end.x + normal.x, y: end.y + normal.y }
    };
  });

  return boundary.map((point, index) => {
    const previousEdge =
      offsetEdges[(index - 1 + offsetEdges.length) % offsetEdges.length];
    const currentEdge = offsetEdges[index];

    return (
      intersectInfiniteLines(
        previousEdge.start,
        previousEdge.end,
        currentEdge.start,
        currentEdge.end
      ) ?? point
    );
  });
}

export function segmentIntersectionsWithPolygon(
  line: AxisLine,
  polygon: Polygon
) {
  const intersections: number[] = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];

    if (line.axis === "horizontal") {
      const crosses =
        start.y > line.coordinate !== end.y > line.coordinate;

      if (!crosses) {
        continue;
      }

      const x =
        start.x +
        ((line.coordinate - start.y) * (end.x - start.x)) / (end.y - start.y);

      if (x >= line.min && x <= line.max) {
        intersections.push(x);
      }
    } else {
      const crosses =
        start.x > line.coordinate !== end.x > line.coordinate;

      if (!crosses) {
        continue;
      }

      const y =
        start.y +
        ((line.coordinate - start.x) * (end.y - start.y)) / (end.x - start.x);

      if (y >= line.min && y <= line.max) {
        intersections.push(y);
      }
    }
  }

  return intersections.sort((a, b) => a - b);
}

function spansToSegments(line: AxisLine, spans: Span[]): Segment[] {
  return spans.map((span) =>
    line.axis === "horizontal"
      ? {
          x1: span.start,
          y1: line.coordinate,
          x2: span.end,
          y2: line.coordinate
        }
      : {
          x1: line.coordinate,
          y1: span.start,
          x2: line.coordinate,
          y2: span.end
        }
  );
}

function lineIntersectionsToSpans(line: AxisLine, intersections: number[]) {
  const spans: Span[] = [];

  for (let index = 0; index < intersections.length - 1; index += 2) {
    const start = Math.max(line.min, intersections[index]);
    const end = Math.min(line.max, intersections[index + 1]);

    if (end - start > 0.1) {
      spans.push({ start, end });
    }
  }

  return spans;
}

export function clipAxisAlignedLineToPolygon(
  line: AxisLine,
  polygon: Polygon
) {
  const intersections = segmentIntersectionsWithPolygon(line, polygon);

  return spansToSegments(line, lineIntersectionsToSpans(line, intersections));
}

function segmentsToSpans(line: AxisLine, segments: Segment[]): Span[] {
  return segments.map((segment) =>
    line.axis === "horizontal"
      ? { start: segment.x1, end: segment.x2 }
      : { start: segment.y1, end: segment.y2 }
  );
}

function subtractSpan(spans: Span[], voidSpan: Span) {
  return spans.flatMap((span) => {
    if (voidSpan.end <= span.start || voidSpan.start >= span.end) {
      return [span];
    }

    return [
      { start: span.start, end: Math.max(span.start, voidSpan.start) },
      { start: Math.min(span.end, voidSpan.end), end: span.end }
    ].filter((nextSpan) => nextSpan.end - nextSpan.start > 0.1);
  });
}

export function subtractPolygonVoidSpans(
  line: AxisLine,
  segments: Segment[],
  openingPolygon: Polygon
) {
  let spans = segmentsToSpans(line, segments);
  const openingSegments = clipAxisAlignedLineToPolygon(line, openingPolygon);
  const openingSpans = segmentsToSpans(line, openingSegments);

  for (const openingSpan of openingSpans) {
    spans = subtractSpan(spans, openingSpan);
  }

  return spansToSegments(line, spans);
}

export function generateAxisAlignedGrid(
  boundary: Polygon,
  spacing: number
): AxisLine[] {
  const bounds = polygonBounds(boundary);
  const lines: AxisLine[] = [];
  const startX = Math.floor(bounds.minX / spacing) * spacing;
  const startY = Math.floor(bounds.minY / spacing) * spacing;
  const endX = Math.ceil(bounds.maxX / spacing) * spacing;
  const endY = Math.ceil(bounds.maxY / spacing) * spacing;

  for (let y = startY; y <= endY; y += spacing) {
    lines.push({
      axis: "horizontal",
      coordinate: y,
      min: bounds.minX,
      max: bounds.maxX
    });
  }

  for (let x = startX; x <= endX; x += spacing) {
    lines.push({
      axis: "vertical",
      coordinate: x,
      min: bounds.minY,
      max: bounds.maxY
    });
  }

  return lines;
}

export function generateClippedBaseMeshSegments(
  slabGeometry: SlabGeometry,
  spacing: number
) {
  const coveredBoundary = applyConcreteCoverToBoundary(
    slabGeometry.boundary,
    slabGeometry.concreteCover
  );
  const lines = generateAxisAlignedGrid(coveredBoundary, spacing);

  return lines.flatMap((line) => {
    let segments = clipAxisAlignedLineToPolygon(line, coveredBoundary);

    for (const opening of slabGeometry.openings) {
      segments = subtractPolygonVoidSpans(line, segments, opening.polygon);
    }

    return segments;
  });
}
