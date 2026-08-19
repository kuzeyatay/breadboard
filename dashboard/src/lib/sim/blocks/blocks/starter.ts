// Vendored from simstudioai/sim (Apache-2.0) — apps/sim/blocks/blocks/starter.ts; adapted for Breadboard.
import { StartIcon } from '@/lib/sim/blocks/icons'
import type { BlockConfig } from '@/lib/sim/blocks/types'

export const StarterBlock: BlockConfig = {
  type: 'starter',
  name: 'Starter',
  description: 'Start workflow',
  longDescription: 'Initiate your workflow manually with optional structured input.',
  category: 'blocks',
  bgColor: '#2FB3FF',
  icon: StartIcon,
  hideFromToolbar: true,
  sunset: { status: 'legacy', replacedBy: 'start_trigger' },
  subBlocks: [
    // Main trigger selector
    {
      id: 'startWorkflow',
      title: 'Start Workflow',
      type: 'dropdown',
      options: [
        { label: 'Run manually', id: 'manual' },
        { label: 'Chat', id: 'chat' },
      ],
      value: () => 'manual',
    },
    // Structured Input format - visible if manual run is selected (advanced mode)
    {
      id: 'inputFormat',
      title: 'Input Format',
      type: 'input-format',
      description:
        'Name and Type define your input schema. Value is used only for manual test runs.',
      mode: 'advanced',
      condition: { field: 'startWorkflow', value: 'manual' },
    },
  ],
  tools: {
    access: [],
  },
  inputs: {
    input: { type: 'json', description: 'Workflow input data' },
  },
  outputs: {}, // No outputs - starter blocks initiate workflow execution
}
