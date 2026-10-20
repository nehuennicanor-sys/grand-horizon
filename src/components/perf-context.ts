import { createContext } from "react";

// Frame-rate governor state, shared with the scenery so weak integrated GPUs
// can shed decorative detail while the car itself always stays complete.
export type Perf = { level: 0 | 1 | 2; fps: number; dpr: number; gpuMs?: number };

export const PerfContext = createContext<Perf>({ level: 2, fps: 60, dpr: 1 });
