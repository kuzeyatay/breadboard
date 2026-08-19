// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/tools/response/types.ts; adapted for Breadboard.
import type { ToolResponse } from '@/lib/sim/tools/types'

export interface ResponseBlockOutput extends ToolResponse {
  success: boolean
  output: {
    data: Record<string, any>
    status: number
    headers: Record<string, string>
  }
}
