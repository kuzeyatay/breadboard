import type { HermesSurface } from "./config.ts";
import { PATENT_DISCLOSURE_SKILL } from "./patent-disclosure-source.ts";

const CHINESE_PATENT_TASK =
  /(?:读专利|专利(?:交底书|交底|挖掘|点|查新|检索|解读|分析|对比|答复|案例入库|政策动向)|交底书|实用新型(?:专利)?|外观设计专利|审查意见(?:通知书)?[^，。]{0,12}答复|权利要求(?:分析|解读))/u;

const ENGLISH_PATENT_TASK =
  /\b(?:patent disclosure|invention disclosure|prior[-\s]?art search|patentability search|patent landscape|patent claim(?:s)? analysis|office action response|respond to (?:an? )?office action)\b/i;

const PATENT_ACTION =
  /\b(?:analy[sz]e|compare|draft|explain|extract|prepare|read|review|rewrite|summari[sz]e|write)\b/i;

const PATENT_OBJECT =
  /\b(?:patent|patent application|claims?|office action|invention disclosure|utility model|design patent)\b/i;

const WORKFLOW_CONTEXT =
  /(?:交底书|专利点|查新结果|权利要求树|审查意见|figure_plan\.yaml|structure_schema|appearance_schema|patent disclosure|prior art|claim tree|office action)/iu;

const CONTINUATION =
  /^(?:(?:yes|no|是|否|好|好的|继续|下一步|继续吧|可以|go ahead|continue|next|proceed|yes|no)\b|[\s\S]{0,220}(?:修改|补充|合并|纠正|导出|成稿|权要|附图|claim|figure|draft|export|revise|merge))/iu;

function isContinuation(input: {
  text: string;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): boolean {
  const recentAssistant = [...(input.priorMessages ?? [])]
    .reverse()
    .filter((message) => message.role === "assistant")
    .slice(0, 3)
    .map((message) => message.content)
    .find((message) => WORKFLOW_CONTEXT.test(message));
  return Boolean(recentAssistant) &&
    input.text.trim().length <= 2_000 &&
    CONTINUATION.test(input.text.trim());
}

export function patentDisclosureCommandText(input: {
  text: string;
  surface: HermesSurface;
  authenticated: boolean;
  internalContinuation?: boolean;
  priorMessages?: ReadonlyArray<{ role: string; content: string }>;
}): { text: string; automatic: boolean } {
  const text = input.text.trim();
  const available = input.authenticated &&
    (input.surface === "dashboard_terminal" || input.surface === "garden_chat");
  const automatic = available && input.internalContinuation !== true &&
    Boolean(text) &&
    !text.startsWith("/") &&
    (
      CHINESE_PATENT_TASK.test(text) ||
      ENGLISH_PATENT_TASK.test(text) ||
      (PATENT_ACTION.test(text) && PATENT_OBJECT.test(text)) ||
      isContinuation({ text, priorMessages: input.priorMessages })
    );
  return {
    text: automatic ? `/${PATENT_DISCLOSURE_SKILL} ${input.text}` : input.text,
    automatic,
  };
}
