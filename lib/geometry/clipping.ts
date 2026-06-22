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

export function applyConcreteCoverToBoundary(boundary: Polygon, cover: number) {
  const centroid = boundary.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  centroid.x /= boundary.length;
  centroid.y /= boundary.length;

  // Phase 1 approximation: move vertices toward the polygon centroid.
  // The clipping API stays stable for a later true offset-polygon replacement.
  return boundary.map((point) => {
    const dx = centroid.x - point.x;
    const dy = centroid.y - point.y;
    const length = Math.hypot(dx, dy);

    if (length === 0) {
      return point;
    }

    return {
      x: point.x + (dx / length) * cover,
      y: point.y + (dy / length) * cover
    };
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
