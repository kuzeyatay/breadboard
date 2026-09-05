// Innate routing for the reviewed earthtojake/text-to-cad skill family.
//
// A person asking for a STEP bracket, a URDF edit, or G-code validation has
// already named the work. Requiring them to know twelve slash commands makes
// the skills a palette feature rather than an agent capability. This router is
// deliberately task-shaped: it needs an action plus a CAD artifact/domain (or
// an unmistakable fabrication operation), and stays out of explanatory chat.

import type { HermesSurface } from "./config.ts";
import type { TextToCadSkill } from "./text-to-cad.ts";

const ANY_URL = /\bhttps?:\/\/\S+/gi;
const TASK_VERB =
  /\b(?:make|create|build|design|model|generate|draw|author|write|edit|modify|change|revise|fix|repair|debug|inspect|check|validate|measure|compare|convert|export|render|preview|view|open|prepare|slice|print|upload|download|source|find|fit|mate|assemble)\b/i;
const DISCUSSION_ONLY =
  /^\s*(?:what|what'?s|why|when|where|who|which|how\s+(?:do|does|can|could|would|should))\b|\b(?:what\s+is|tell\s+me\s+about|explain|tutorial|course|learn|pros?\s+and\s+cons?|best\s+(?:cad|slicer)|which\s+(?:cad|slicer|software|tool))\b/i;

const CAD_FILE = /\.(?:step|stp|stl|3mf|glb|brep|iges|igs)\b/i;
const DXF_FILE = /\.dxf\b/i;
const URDF_FILE = /\.urdf\b/i;
const SRDF_FILE = /\.srdf\b/i;
const SDF_FILE = /\.sdf\b/i;
const GCODE_FILE = /\.(?:gcode|gco|bgcode)\b/i;

const CAD_DOMAIN =
  /\b(?:cad\s+(?:part|model|assembly|drawing|file|geometry|design)|step|stp|stl|3mf|build123d|cadquery|solidworks|freecad|openscad|mechanical\s+(?:part|assembly|model)|parametric\s+(?:part|assembly|model)|enclosure|case|housing|chassis|bracket|fixture|jig|mounting\s+plate|gear(?:box|\s+train)?|rack\s+and\s+pinion|linkage|cam|ratchet|lead\s+screw|linear\s+actuator|hinge|pulley|impeller|propeller|manifold|duct|nozzle|knob|handle|wearable|headset|headband|helmet|glasses|goggles|visor|waveguide|combiner|collimator|counterbore|countersink|boss|standoff|fillet|chamfer)\b/i;
const SOFTWARE_CONTEXT =
  /\b(?:app|application|website|codebase|repository|repo|api|sdk|library|package|plugin|extension|integration|unit\s+tests?|typescript|javascript|react)\b/i;
const DRAWING_DOMAIN = /\b(?:dxf|laser[-\s]?cut|water[-\s]?jet|sheet[-\s]?metal\s+(?:profile|drawing)|2d\s+technical\s+drawing)\b/i;
const ROBOT_DOMAIN = /\b(?:urdf|robot\s+description|robot_state_publisher|rviz)\b/i;
const MOVEIT_DOMAIN = /\b(?:srdf|moveit\s*2?|planning\s+group|end\s+effector|disabled\s+collision)\b/i;
const SIM_DOMAIN = /\b(?:sdformat|gazebo|ignition\s+(?:gazebo|sim)|simulation\s+(?:model|world)|sdf\s+(?:model|world|file))\b/i;
const GCODE_DOMAIN = /\b(?:g-?code|slice|slicer|orcaslicer|prusa\s*slicer|cura)\b/i;
const BAMBU_DOMAIN = /\b(?:bambu\s+lab|bambu\s+(?:a1|p1|x1)|lan\s+(?:print|printer)|ftps.*mqtt|mqtt.*ftps)\b/i;
const SENDCUTSEND_DOMAIN = /\bsend\s*cut\s*send\b/i;
const DFAM_DOMAIN = /\b(?:dfam|design\s+for\s+additive|printability|wall\s+thickness|overhang|support\s+volume|build\s+orientation)\b/i;
const STEP_PARTS_DOMAIN =
  /\b(?:step\.parts|off[-\s]?the[-\s]?shelf|catalog\s+(?:cad|step)|download\s+(?:a\s+)?step\s+(?:part|model)|find\s+(?:a\s+)?(?:cad|step)\s+(?:part|model)|(?:screw|bolt|nut|washer|bearing|servo|motor|connector)\s+(?:step|cad)\s+(?:file|model))\b/i;
const VIEWER_DOMAIN = /\b(?:cad\s+viewer|preview|view|open|orbit|explode|section\s+view)\b/i;
const IMPLICIT_DOMAIN = /\b(?:implicit\s+cad|signed\s+distance\s+field|sdf\s+shader|raymarch(?:ed|ing)?)\b/i;

const REVISION_REQUEST =
  /^(?:(?:can|could|would|will|please)\s+you\s+|please\s+|now\s+)?(?:make|move|change|add|remove|resize|thicken|thin|widen|shorten|lengthen|rebuild|regenerate|export|validate|slice|rotate|fillet|chamfer|fix|try)\b[^.!?]{0,140}[?.!]*$/i;
const RECENT_CONTEXT =
  /(?:\/cad\b|\/dxf\b|\/urdf\b|\/srdf\b|\/sdf\b|\/gcode\b|\/implicit-cad\b|Parametric CAD|text-to-cad|\.(?:step|stp|stl|3mf|dxf|urdf|srdf|sdf|gcode)\b)/i;

export interface TextToCadIntentInput {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}

function recentCadWork(
  messages: TextToCadIntentInput["priorMessages"],
): boolean {
  return (messages ?? [])
    .slice(-10)
    .some((message) => message.role === "assistant" && RECENT_CONTEXT.test(message.content));
}

export function textToCadSkillForRequest(
  input: TextToCadIntentInput,
): TextToCadSkill | null {
  const text = input.text.trim();
  if (
    !input.authenticated ||
    !["dashboard_terminal", "garden_chat"].includes(input.surface) ||
    !text ||
    text.startsWith("/")
  ) return null;

  const prose = text.replace(ANY_URL, " ");
  const hasTask = TASK_VERB.test(prose);
  if (DISCUSSION_ONLY.test(prose)) return null;
  // This suite authors engineering artifacts; it is not a router for work on
  // CAD software itself. A real artifact path wins because "fix the STEP
  // exporter in this repo using bad.step" may still explicitly ask to inspect
  // the file, but a bare library/plugin/codebase request stays with coding.
  if (
    SOFTWARE_CONTEXT.test(prose) &&
    ![CAD_FILE, DXF_FILE, URDF_FILE, SRDF_FILE, SDF_FILE, GCODE_FILE].some((pattern) =>
      pattern.test(prose)
    )
  ) return null;

  // Most-specific physical handoffs first; all also contain generic printing
  // words that must not demote them to the broad CAD skill.
  if (BAMBU_DOMAIN.test(prose) && (hasTask || GCODE_FILE.test(prose))) return "bambu-labs";
  if (SENDCUTSEND_DOMAIN.test(prose) && hasTask) return "sendcutsend";
  if (STEP_PARTS_DOMAIN.test(prose) && hasTask) return "step-parts";
  if (MOVEIT_DOMAIN.test(prose) && (hasTask || SRDF_FILE.test(prose))) return "srdf";
  if (ROBOT_DOMAIN.test(prose) && (hasTask || URDF_FILE.test(prose))) return "urdf";
  if (SIM_DOMAIN.test(prose) && (hasTask || SDF_FILE.test(prose))) return "sdf";
  if (DRAWING_DOMAIN.test(prose) && (hasTask || DXF_FILE.test(prose))) return "dxf";
  if (IMPLICIT_DOMAIN.test(prose) && hasTask) return "implicit-cad";
  if (GCODE_DOMAIN.test(prose) && (hasTask || GCODE_FILE.test(prose))) return "gcode";
  if (DFAM_DOMAIN.test(prose) && hasTask && (CAD_FILE.test(prose) || /\b(?:mesh|print|part|model)\b/i.test(prose))) {
    return "dfam-check";
  }
  if (CAD_FILE.test(prose) && VIEWER_DOMAIN.test(prose) && !/\b(?:edit|modify|change|revise|fix|convert|export|make|create|build|design|model|generate)\b/i.test(prose)) {
    return "cad-viewer";
  }
  if ((CAD_DOMAIN.test(prose) || CAD_FILE.test(prose)) && hasTask) return "cad";
  if (REVISION_REQUEST.test(prose) && recentCadWork(input.priorMessages)) return "cad";
  return null;
}

export function textToCadCommandText(
  input: TextToCadIntentInput,
): { text: string; automatic: boolean; skill: TextToCadSkill | null } {
  const skill = textToCadSkillForRequest(input);
  return {
    text: skill ? `/${skill} ${input.text}` : input.text,
    automatic: skill !== null,
    skill,
  };
}
