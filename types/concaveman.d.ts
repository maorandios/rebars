declare module "concaveman" {
  export default function concaveman(
    points: number[][],
    concavity?: number,
    lengthThreshold?: number
  ): number[][];
}
