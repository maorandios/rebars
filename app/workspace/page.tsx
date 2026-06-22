"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BaseMeshPanel } from "@/components/structural/base-mesh-panel";
import { StructureCanvas } from "@/components/structural/structure-canvas";
import { Button } from "@/components/ui/button";

export default function WorkspacePage() {
  return (
    <main className="min-h-screen bg-background" suppressHydrationWarning>
      <section
        className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col gap-5 px-6 py-6"
        suppressHydrationWarning
      >
        <header
          className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between"
          suppressHydrationWarning
        >
          <div>
            <div className="text-sm text-muted-foreground">
              Phase 1 MVP | Slab geometry workspace
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Slab Boundary And Base Mesh Canvas
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Use the asymmetric mock slab to test polygon openings, concrete
              cover, and clipped base mesh generation.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </header>

        <div className="grid flex-1 gap-5 xl:grid-cols-[1fr_380px]">
          <StructureCanvas />
          <BaseMeshPanel />
        </div>
      </section>
    </main>
  );
}
