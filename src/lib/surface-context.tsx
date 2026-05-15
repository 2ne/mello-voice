import { createContext, use, type ReactNode } from "react";

const SurfaceContext = createContext<number>(1);

export function useSurface(): number {
  return use(SurfaceContext);
}

export function SurfaceProvider({ value, children }: { value: number; children: ReactNode }) {
  return <SurfaceContext.Provider value={value}>{children}</SurfaceContext.Provider>;
}
