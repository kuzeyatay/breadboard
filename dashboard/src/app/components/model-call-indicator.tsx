import { formatAssistantModelName } from "@/lib/ai-models";

export default function ModelCallIndicator({ model }: { model?: string }) {
  const normalized = model?.trim();
  if (!normalized) return null;

  return (
    <span
      className="inline-flex items-center whitespace-nowrap text-gray-500"
      title={`Model making these calls: ${normalized}`}
      aria-label={`Model making these calls: ${formatAssistantModelName(normalized)}`}
    >
      {formatAssistantModelName(normalized)}
    </span>
  );
}
