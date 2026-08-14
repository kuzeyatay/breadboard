// The Hardware Blueprint data model.
//
// Three kinds of data live here and must never be confused:
//   * ComponentDefinition — source-controlled knowledge about a real part. Never
//     model-generated; an unknown value stays undefined rather than invented.
//   * HardwareProjectRequest — the model's reading of what the user asked for.
//     Always validated through ../hardware/schemas.ts before it is trusted.
//   * HardwareDesign — the compiler's output. Components, nets, validation and
//     pin assignments in it are produced by deterministic TypeScript only.

export const HARDWARE_DESIGN_SCHEMA_VERSION = "1.0.0";

export type HardwareProjectStatus =
  | "ready"
  | "ready-with-warnings"
  | "needs-changes"
  | "concept-only";

export type CommunicationInterface =
  | "i2c"
  | "spi"
  | "uart"
  | "can"
  | "usb"
  | "wifi"
  | "bluetooth"
  | "ethernet";

export type PowerSource = "usb" | "battery" | "external-supply" | "unknown";

export type PrototypeType = "breadboard" | "perfboard" | "pcb";

export type FirmwarePlatform = "arduino" | "platformio" | "esp-idf" | "pico-sdk";

export type FirmwareLanguage = "cpp" | "c" | "micropython";

export interface RequestedPeripheral {
  type: string;
  quantity: number;
  constraints?: Record<string, unknown>;
}

export interface HardwareProjectRequest {
  title?: string;
  purpose: string;
  controller?: string;

  inputs: RequestedPeripheral[];
  outputs: RequestedPeripheral[];

  /**
   * Passive optical and mechanical requirements that belong in the physical
   * assembly, not on an electrical net. Optional for stored v1 designs; new
   * requests are normalised to an array before compilation.
   */
  physicalParts?: RequestedPeripheral[];

  communication: CommunicationInterface[];

  power: {
    source: PowerSource;
    /** Exact battery, cell, or supply module requested by the person. */
    part?: string;
    voltage?: number;
    maximumCurrentMa?: number;
  };

  prototypeType: PrototypeType;

  firmware: {
    platform: FirmwarePlatform;
    language: FirmwareLanguage;
  };

  constraints: {
    maximumCost?: number;
    beginnerFriendly: boolean;
    preferredComponents: string[];
    forbiddenComponents: string[];
  };
}

export interface DesignDecision {
  category: string;
  selection: string;
  rationale: string;
}

export interface ComponentInstance {
  id: string;
  definitionId: string;
  reference: string;
  name: string;
  value?: string;
  quantity: number;
  properties: Record<string, string | number | boolean>;
  position?: {
    x: number;
    y: number;
    rotation?: number;
  };
  automaticallyAdded?: boolean;
  additionReason?: string;
}

export type NetRole =
  | "power"
  | "ground"
  | "digital"
  | "analog"
  | "i2c-sda"
  | "i2c-scl"
  | "spi-clock"
  | "spi-data"
  | "chip-select"
  | "uart-tx"
  | "uart-rx"
  | "other";

export interface NetConnection {
  componentId: string;
  pinId: string;
}

export interface ElectricalNet {
  id: string;
  name: string;
  role: NetRole;
  nominalVoltage?: number;
  connections: NetConnection[];
}

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationResult {
  id: string;
  rule: string;
  severity: ValidationSeverity;
  title: string;
  message: string;
  componentIds: string[];
  netIds: string[];
  remediation?: string;
}

export interface BomItem {
  reference: string;
  componentDefinitionId: string;
  name: string;
  valueOrModel?: string;
  quantity: number;
  purpose: string;
  manufacturer?: string;
  manufacturerPartNumber?: string;
  estimatedUnitPrice?: number;
  estimatedTotalPrice?: number;
  priceIsEstimate: boolean;
  substitutes: string[];
}

export interface AssemblyStep {
  id: string;
  index: number;
  title: string;
  instruction: string;
  componentIds: string[];
  netIds: string[];
  verification?: string;
  warning?: string;
}

export interface FirmwareFile {
  path: string;
  language: string;
  content: string;
}

export interface FirmwareProject {
  platform: string;
  language: string;
  entryFile: string;
  files: FirmwareFile[];
  dependencies: Array<{ name: string; version?: string }>;
  buildInstructions: string[];
  uploadInstructions: string[];
  expectedSerialOutput?: string;
}

/**
 * The compiler's current figures, carried on the design so a view never has to
 * read them back out of the prose summary. Optional because designs stored
 * before this field existed are still readable.
 */
export interface PowerEstimate {
  totalTypicalMa: number;
  totalMaximumMa: number;
  /** Typical load per supply rail, keyed by net id. */
  perRailTypicalMa: Record<string, number>;
  /** Parts whose draw the library does not document. */
  unknownComponentIds: string[];
}

export interface HardwareDesign {
  schemaVersion: string;
  id: string;
  title: string;
  summary: string;
  status: HardwareProjectStatus;

  request: HardwareProjectRequest;
  decisions: DesignDecision[];

  components: ComponentInstance[];
  nets: ElectricalNet[];

  validationResults: ValidationResult[];
  bom: BomItem[];
  assemblySteps: AssemblyStep[];

  /**
   * Parts researched for this design after a local catalogue lookup failed or
   * only found a mechanical placeholder.  The definition snapshot makes the
   * artifact deterministic after a reload; it never mutates the shared,
   * source-controlled component library.
   */
  componentResearch?: ComponentResearchRecord[];

  powerEstimate?: PowerEstimate;
  firmware?: FirmwareProject;
  circuitJson?: unknown;
}

// ---------------------------------------------------------------------------
// Component library
// ---------------------------------------------------------------------------

export type PinElectricalType =
  | "power-input"
  | "power-output"
  | "ground"
  | "digital-input"
  | "digital-output"
  | "digital-io"
  | "analog-input"
  | "analog-output"
  | "passive"
  | "open-drain";

export interface ComponentPin {
  id: string;
  label: string;
  electricalType: PinElectricalType;
  /**
   * What the pin can be used for. The compiler matches on these, so they are a
   * controlled vocabulary: `i2c-sda`, `i2c-scl`, `spi-sck`, `spi-mosi`,
   * `spi-miso`, `spi-cs`, `uart-tx`, `uart-rx`, `pwm`, `adc`, `gpio`,
   * `supply-3v3`, `supply-5v`, `supply-vin`, `ground`, `boot-strap`.
   */
  functions: string[];
  maximumVoltage?: number;
  maximumCurrentMa?: number;
}

export interface ComponentVisual {
  renderer: "wokwi-element" | "svg" | "generic";
  elementName?: string;
  assetId?: string;
  /** Intrinsic drawing width in CSS pixels; wire anchors share this space. */
  width: number;
  height: number;
  pinAnchors: Record<string, { x: number; y: number }>;
}

export interface ComponentDefinition {
  id: string;
  aliases: string[];
  name: string;
  category: string;
  description: string;

  manufacturer?: string;
  manufacturerPartNumber?: string;

  electrical: {
    minimumSupplyVoltage?: number;
    typicalSupplyVoltage?: number;
    maximumSupplyVoltage?: number;
    logicVoltage?: number;
    typicalCurrentMa?: number;
    maximumCurrentMa?: number;
  };

  interfaces: string[];

  pins: ComponentPin[];

  rules: {
    /**
     * This entry reserves mechanical/BOM space for an active part, but does
     * not yet describe a real part's supply, pins or electrical interface.
     * Placing one is intentionally a blocking validation error until it is
     * replaced by an electrically specified component definition.
     */
    electricalPlaceholder?: boolean;
    requiresCurrentLimiting?: boolean;
    requiresFlybackDiode?: boolean;
    requiresDriver?: boolean;
    requiresLevelShifter?: boolean;
    requiresDecoupling?: boolean;
    requiresPullups?: boolean;
    i2cAddresses?: string[];
  };

  firmware?: {
    libraries: string[];
    includeStatements?: string[];
  };

  visual: ComponentVisual;

  /** Estimated unit price in EUR. Undefined when no defensible figure exists. */
  estimatedUnitPrice?: number;
  substitutes?: string[];

  /** Physical envelope used by enclosure CAD when a module has a stable form. */
  mechanical?: {
    length: number;
    width: number;
    height: number;
    notes?: string;
    /** Features the product CAD must provide around this envelope. */
    integration?: string[];
    /** Named functional directions/lines the assembly must preserve. */
    functionalAxes?: string[];
    /** Faces or regions that cannot be buried inside an enclosure. */
    exposedRegions?: string[];
    /** Approximate assembled mass when the source documents it. */
    massGrams?: number;
  };
}

export type ComponentResearchStatus =
  | "used"
  | "reference-only"
  | "not-found"
  | "insufficient-evidence"
  | "timed-out"
  | "deferred";

export interface ComponentResearchSource {
  title: string;
  url: string;
  kind: "manufacturer-product" | "manufacturer-datasheet" | "distributor" | "other";
}

/** One bounded, source-backed online lookup retained with the blueprint. */
export interface ComponentResearchRecord {
  /** The exact phrase from the person's request. */
  requestedAs: string;
  status: ComponentResearchStatus;
  /** Why the result was or was not safe for the deterministic compiler. */
  note: string;
  /** Present only when enough facts were found to create a useful record. */
  definition?: ComponentDefinition;
  sources: ComponentResearchSource[];
}

/** Controller-only metadata: what the compiler is allowed to allocate. */
export interface ControllerProfile {
  definitionId: string;
  /** Board logic level; every peripheral signal is checked against it. */
  logicVoltage: number;
  /** Regulated rails the board can source, with a conservative budget. */
  rails: Array<{
    pinId: string;
    voltage: number;
    /** Conservative continuous current the on-board regulator can supply. */
    budgetMa: number;
    /**
     * The rail is the raw USB input rather than a regulator output, so it is
     * dead whenever the board runs from a battery. Hanging a part on one of
     * these in a portable build produces a circuit that only works on a cable.
     */
    usbOnly?: boolean;
  }>;
  groundPinIds: string[];
  /** Maximum continuous current a single GPIO may source or sink. */
  maximumPinCurrentMa: number;
  /** Ordered preference for general digital allocation. */
  digitalPinOrder: string[];
  /** Ordered preference for PWM-capable allocation (servos, dimming). */
  pwmPinOrder: string[];
  analogPinOrder: string[];
  i2c: { sdaPinId: string; sclPinId: string } | null;
  spi: { sckPinId: string; mosiPinId: string; misoPinId: string } | null;
  uart: { txPinId: string; rxPinId: string } | null;
  /** Further hardware UARTs, in the order the compiler should spend them. */
  additionalUarts?: Array<{ txPinId: string; rxPinId: string }>;
  /** Pins that work but constrain boot or are shared with the USB console. */
  cautionPins: Record<string, string>;
  firmware: {
    platformioEnvironment: string;
    platformioBoard: string;
    platformioPlatform: string;
    framework: string;
    /** Arduino IDE board menu entry, for users not on PlatformIO. */
    arduinoBoardName: string;
    serialBaud: number;
  };
}
