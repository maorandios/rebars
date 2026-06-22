import polygonClipping from "polygon-clipping";
import type {
  MultiPolygon,
  Pair,
  Ring
} from "polygon-clipping";

import type { Polygon } from "@/types/structure";

function closeRing(ring: Ring): Ring {
  const first = ring[0];
  const last = ring[ring.length - 1];

  if (!first || !last || (first[0] === last[0] && first[1] === last[1])) {
    return ring;
  }

  return [...ring, first];
}

function toRing(polygon: Polygon): Ring {
  return closeRing(polygon.map<Pair>((point) => [point.x, point.y]));
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
  return fromMultiPolygon(
    polygonClipping.intersection(
      toMultiPolygon(subject),
      toMultiPolygon(clip)
    ) as MultiPolygon
  );
}

export function subtractPolygons(subject: Polygon, holes: Polygon[]): Polygon[] {
  if (holes.length === 0) {
    return [subject];
  }

  return fromMultiPolygon(
    polygonClipping.difference(
      toMultiPolygon(subject),
      ...holes.map(toMultiPolygon)
    ) as MultiPolygon
  );
}

export function largestPolygonFragment(polygons: Polygon[]) {
  return polygons.toSorted(
    (a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a))
  )[0];
}
