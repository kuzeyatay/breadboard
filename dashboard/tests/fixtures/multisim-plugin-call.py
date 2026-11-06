"""Invoke the shipped Hermes registration and HTTP transport, not a test payload."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "hermes-agent"))
import plugins.breadboard as breadboard
from plugins.breadboard.multisim import register_tools
from tools.registry import registry
from tools.tool_search import assemble_tool_defs, resolve_underlying_call, ToolSearchConfig


class Context:
    def register_tool(self, **tool):
        self.tool = tool
        registry.register(**tool)


context = Context()
register_tools(context, breadboard._call_breadboard)
request = json.load(sys.stdin)
# Force the same deferred interface the live Super Agent uses. The actual
# wrapper parser must preserve both Multisim's action and its nested arguments.
assembled = assemble_tool_defs(
    [{"type": "function", "function": context.tool["schema"]}],
    config=ToolSearchConfig.from_raw({"enabled": "on"}),
)
assert assembled.activated
assert "tool_call" in [tool["function"]["name"] for tool in assembled.tool_defs]
name, arguments, error = resolve_underlying_call({"name": "multisim", "arguments": request["args"]})
assert name == "multisim" and error is None
print(registry.get_entry(name).handler(arguments, task_id=request["session_id"],
                              tool_call_id="multisim-transport-verification"))
