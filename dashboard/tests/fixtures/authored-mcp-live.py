"""One isolated Bread turn, using the production Hermes agent and MCP plugin."""
import json
import os
import sys
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "hermes-agent"))
from plugins.breadboard import _TOOLS, _call_breadboard
from run_agent import AIAgent
from tools.registry import registry

turn = json.load(sys.stdin)
names = {"mcp_call", "bot_manage"}
for name, route, kind, schema in _TOOLS:
    if name in names:
        registry.register(name=name, toolset="breadboard", schema=schema,
                          handler=partial(_call_breadboard, tool_name=name, route=route, route_kind=kind))
agent = AIAgent(
    base_url=os.environ["BREADBOARD_QA_MODEL_BASE_URL"], api_key="local",
    model=turn["model"], provider="custom", api_mode="chat_completions",
    enabled_toolsets=["breadboard"], session_id=turn["session"],
    max_iterations=14, quiet_mode=True, skip_context_files=True, skip_memory=True,
)
agent.tools = [tool for tool in agent.tools if tool["function"]["name"] in names]
agent.valid_tool_names = {tool["function"]["name"] for tool in agent.tools}
assert agent.valid_tool_names == names, "The Bread tools were not loaded"
answer = agent.run_conversation(user_message=turn["prompt"], system_message=turn["context"], task_id=turn["session"])
print(json.dumps({"answer": answer.get("final_response"), "error": answer.get("error")}), flush=True)
