"""Tool discovery must not advertise an unusable computer-use transport."""
import sys
from types import SimpleNamespace
from unittest.mock import patch

from tools.computer_use.tool import check_computer_use_requirements


def test_driver_alone_is_insufficient_without_mcp_client():
    with (patch("tools.computer_use.tool.sys.platform", "win32"),
          patch("tools.computer_use.cua_backend.cua_driver_binary_available", return_value=True),
          patch.dict(sys.modules, {"mcp.client.session": None})):
        assert check_computer_use_requirements() is False


def test_both_driver_and_client_are_required():
    with (patch("tools.computer_use.tool.sys.platform", "win32"),
          patch.dict(sys.modules, {"mcp.client.session": SimpleNamespace(ClientSession=object)}),
          patch("tools.computer_use.cua_backend.cua_driver_binary_available", return_value=True)):
        assert check_computer_use_requirements() is True
