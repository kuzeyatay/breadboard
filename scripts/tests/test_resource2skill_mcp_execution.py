"""Exercise subprocess tools through real MCP pipes, not direct Python calls."""
import asyncio
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import types
import unittest

ROOT = Path(os.environ.get("BREADBOARD_TEST_REPO", Path(__file__).resolve().parents[2]))
SOURCE = Path(os.environ.get("BREADBOARD_TEST_CANDIDATE", ROOT))


def serve_fixture():
    original = ROOT / "Resource2Skill/domains/web/mcp_server"
    candidate = SOURCE / "Resource2Skill/domains/web/mcp_server"
    sys.path[:0] = [str(original), str(ROOT / "Resource2Skill")]
    from core import llm
    def unexpected_provider(*args, **kwargs):
        raise AssertionError("This local MCP regression must not call a provider")
    llm.call_azure_openai = unexpected_provider
    engine = types.ModuleType("web_engine")
    engine.__file__ = str(original / "web_engine.py")
    sys.modules["web_engine"] = engine
    exec(compile((candidate / "web_engine.py").read_text(encoding="utf-8"), engine.__file__, "exec"), engine.__dict__)
    sys.argv = [str(original / "server.py"), *sys.argv[2:]]
    exec(compile((candidate / "server.py").read_text(encoding="utf-8"), sys.argv[0], "exec"), {"__name__":"__main__", "__file__":sys.argv[0]})


class McpSubprocessTests(unittest.IsolatedAsyncioTestCase):
    async def test_component_render_and_dom_through_real_mcp_input_pipe(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        with tempfile.TemporaryDirectory(prefix="owned-mcp-regression-") as directory:
            owned = Path(directory)
            skill = "responsive_flexbox_navbar_with_hamburger_ac938208"
            for name in ("meta.json", "text/overview.md"):
                dest = owned / "skills" / skill / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / "Resource2Skill/skills_wiki/web" / skill / name, dest)
            env = {key:value for key,value in os.environ.items() if key.upper() in {"SYSTEMROOT","WINDIR","PATH","PATHEXT","COMSPEC","PLAYWRIGHT_BROWSERS_PATH"}}
            env.update({"BREADBOARD_TEST_REPO":str(ROOT), "BREADBOARD_TEST_CANDIDATE":str(SOURCE), "TEMP":str(owned), "TMP":str(owned), "PYTHONUTF8":"1", "PYTHONDONTWRITEBYTECODE":"1", "PYTHONNOUSERSITE":"1"})
            params = StdioServerParameters(command=sys.executable, args=[__file__, "--server", "--skills-dir", str(owned / "skills"), "--demo-dir", str(owned / "output")], env=env)
            async with stdio_client(params) as (reader, writer):
                async with ClientSession(reader, writer) as session:
                    await asyncio.wait_for(session.initialize(), 30)
                    async def call(name, arguments):
                        result = await asyncio.wait_for(session.call_tool(name, arguments), 35)
                        return "\n".join(item.text for item in result.content if item.type == "text")
                    created = await call("create_project", {"name":"owned-regression"})
                    project = re.search(r"\(id: (proj_[a-f0-9]{8})\)", created).group(1)
                    added = await call("add_component_from_skill", {"project_id":project, "skill_id":skill, "content_brief":"Owned component"})
                    self.assertTrue(added.startswith("Added component"), added)
                    rendered = await call("render_page", {"project_id":project, "width":400, "height":240})
                    self.assertTrue(rendered.startswith("Rendered:"), rendered[:500])
                    inspected = await call("inspect_dom", {"project_id":project})
                    self.assertTrue(inspected.startswith("DOM:"), inspected[:500])
                    self.assertIn("Console errors: 0", inspected)
                    screenshots = list(owned.rglob("preview.png"))
                    self.assertEqual(len(screenshots), 1)
                    self.assertGreater(screenshots[0].stat().st_size, 200)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        serve_fixture()
    else:
        unittest.main()
