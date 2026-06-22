"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type ToggleGroupContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
};

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({});

type ToggleGroupProps = Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ className, onValueChange, value, ...props }, ref) => (
    <ToggleGroupContext.Provider value={{ onValueChange, value }}>
      <div
        ref={ref}
        className={cn("inline-flex rounded-md border bg-muted p-1", className)}
        role="radiogroup"
        suppressHydrationWarning
        {...props}
      />
    </ToggleGroupContext.Provider>
  )
);
ToggleGroup.displayName = "ToggleGroup";

type ToggleGroupItemProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string;
};

const ToggleGroupItem = React.forwardRef<
  HTMLButtonElement,
  ToggleGroupItemProps
>(({ className, value, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);
  const pressed = context.value === value;

  return (
    <button
      ref={ref}
      aria-checked={pressed}
      className={cn(
        "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        pressed && "bg-background text-foreground shadow-sm",
        className
      )}
      role="radio"
      suppressHydrationWarning
      type="button"
      onClick={() => context.onValueChange?.(value)}
      {...props}
    />
  );
});
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
