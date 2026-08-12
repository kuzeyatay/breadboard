// Shared pin constructor for the component library.
//
// Every definition builds its pins the same way, so the shape of a pin — its
// electrical type, what it can be used for, and its own voltage and current
// ceilings — is described in one place rather than re-declared per file.

import type { ComponentPin } from "../types.ts";

export function pin(
  id: string,
  label: string,
  electricalType: ComponentPin["electricalType"],
  functions: string[],
  extra: Partial<Pick<ComponentPin, "maximumVoltage" | "maximumCurrentMa">> = {},
): ComponentPin {
  return { id, label, electricalType, functions, ...extra };
}
