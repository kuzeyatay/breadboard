// Breadboard stand-in for sim's tools/loops/types.ts (simstudioai/sim, Apache-2.0).
// Sim's block generic here names the Loops.so (email marketing) integration
// response union — Breadboard doesn't vendor that integration, only the
// control-flow "loops" block, and only needs a `ToolResponse`-shaped generic
// to satisfy `BlockConfig<LoopsResponse>`.

import type { ToolResponse } from '@/lib/sim/tools/types'

export type LoopsResponse = ToolResponse
