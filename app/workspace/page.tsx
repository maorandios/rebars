"use client";

import {
  MeshInspectorPanel,
  MeshZonesPanel
} from "@/components/structural/base-mesh-panel";
import { StructureCanvas } from "@/components/structural/structure-canvas";

export default function WorkspacePage() {
  return (
    <main
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
      suppressHydrationWarning
    >
      <div className="flex min-h-0 flex-1">
        <MeshZonesPanel />
        <section className="relative h-full min-w-0 flex-1">
          <StructureCanvas />
        </section>
        <MeshInspectorPanel />
      </div>
    </main>
  );
}
