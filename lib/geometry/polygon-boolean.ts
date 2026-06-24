import polygonClipping from "polygon-clipping";
import type {
  MultiPolygon,
  Pair,
  Ring
} from "polygon-clipping";

import type { Polygon } from "@/types/structure";

function sameCoordinate(a: Pair, b: Pair, tolerance = 0.001) {
  return Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;
}

function closeRing(ring: Ring): Ring {
  const first = ring[0];
  const last = ring[ring.length - 1];

  if (!first || !last || (first[0] === last[0] && first[1] === last[1])) {
    return ring;
  }

  return [...ring, first];
}

function toRing(polygon: Polygon): Ring {
  const ring = polygon
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map<Pair>((point) => [point.x, point.y])
    .reduce<Ring>((points, point) => {
      const previous = points.at(-1);

      if (!previous || !sameCoordinate(previous, point)) {
        points.push(point);
      }

      return points;
    }, []);

  return closeRing(ring);
}

function toMultiPolygon(polygon: Polygon): MultiPolygon {
  return [[toRing(polygon)]];
}

function fromRing(ring: Ring): Polygon {
  const openRing = ring.slice(0, -1);

  return openRing.map(([x, y]) => ({ x, y }));
}

function fromMultiPolygon(result: MultiPolygon): Polygon[] {
  return result
    .flatMap((polygon) => polygon.slice(0, 1))
    .map(fromRing)
    .filter((polygon) => polygon.length >= 3 && Math.abs(polygonArea(polygon)) > 1);
}

export function polygonArea(polygon: Polygon) {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length];

    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

export function intersectPolygons(subject: Polygon, clip: Polygon): Polygon[] {
  if (subject.length < 3 || clip.length < 3) {
    return [];
  }

  try {
    return fromMultiPolygon(
      polygonClipping.intersection(
        toMultiPolygon(subject),
        toMultiPolygon(clip)
      ) as MultiPolygon
    );
  } catch {
    return [];
  }
}

export function subtractPolygons(subject: Polygon, holes: Polygon[]): Polygon[] {
  if (holes.length === 0) {
    return [subject];
  }

  if (subject.length < 3) {
    return [];
  }

  try {
    return fromMultiPolygon(
      polygonClipping.difference(
        toMultiPolygon(subject),
        ...holes.filter((hole) => hole.length >= 3).map(toMultiPolygon)
      ) as MultiPolygon
    );
  } catch {
    return [subject];
  }
}

export function largestPolygonFragment(polygons: Polygon[]) {
  return polygons.toSorted(
    (a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a))
  )[0];
}
