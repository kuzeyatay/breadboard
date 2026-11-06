import os
from pathlib import Path

import pytest

from breadboard_multisim.backends import NgspiceBackend
from breadboard_multisim.service import CircuitService, read_json

EXAMPLES = Path(__file__).resolve().parents[2] / "skills/multisim-agent/examples"


@pytest.fixture
def service(tmp_path):
    return CircuitService(tmp_path)


@pytest.fixture
def real_service(tmp_path):
    backend = NgspiceBackend()
    if not backend.status().get("available"):
        if os.environ.get("BREADBOARD_REQUIRE_NGSPICE") == "1":
            pytest.fail("Real ngspice is required for this test run")
        pytest.skip("Install ngspice; CI sets BREADBOARD_REQUIRE_NGSPICE=1")
    return CircuitService(tmp_path, backend)


@pytest.fixture
def example():
    return lambda name: read_json(EXAMPLES / (name + ".json"))
