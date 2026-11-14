"""Breadboard's local, telemetry-free entry point for the pinned upstream MCP."""
import os
from importlib.metadata import version

# Set these before importing upstream: telemetry initializes during import.
os.environ["DISABLE_TELEMETRY"] = "true"
os.environ["BLENDER_MCP_CONTEXT_LOG"] = "0"
os.environ["BLENDER_HOST"] = "127.0.0.1"
os.environ["BLENDER_PORT"] = "9876"


def main():
    expected = "2.2.9"
    if version("mcp-for-blender") != expected:
        raise RuntimeError(f"Breadboard requires mcp-for-blender {expected}; rerun setup:blender.")
    from blender_mcp.server import main as upstream_main
    upstream_main()


if __name__ == "__main__":
    main()
