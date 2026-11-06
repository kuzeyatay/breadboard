import numpy as np
import pytest

from breadboard_multisim.circuit import Circuit
from breadboard_multisim.measurements import Measurement, measure


def waveform(t, y):
    return {"rows": np.column_stack([t, y]).tolist(),
            "variables": [{"name": "time"}, {"name": "v(out)"}]}


def test_frequency_and_thd_on_nonuniform_spice_samples():
    rng = np.random.default_rng(43)
    t = np.r_[0, np.cumsum(rng.uniform(0.15e-6, 0.25e-6, 10000))]
    f = 9975.0
    y = 0.12 + 4 * np.sin(2*np.pi*f*t) + 0.12 * np.sin(6*np.pi*f*t)
    raw = waveform(t, y)
    for kind, expected in [("frequency", f), ("thd", 3.0)]:
        result = measure(Circuit(), raw, {"kind": "tran"}, Measurement(
            name=kind, kind=kind, node="out", start=.0005, stop=.0019))
        assert result["status"] == "measured", result
        assert result["value"] == pytest.approx(expected, rel=5e-4)
        assert result["fundamental_peak_v"] == pytest.approx(4, rel=5e-4)
        assert result["cycles"] >= 5


@pytest.mark.parametrize("case", ["dc", "short", "coarse", "startup", "outside", "ac"])
def test_periodic_measurements_do_not_invent_missing_evidence(case):
    t = np.linspace(0, .002, 10001 if case != "coarse" else 101)
    y = np.sin(2*np.pi*10000*t)
    if case == "dc":
        y[:] = 0
    if case == "startup":
        y *= np.exp(t * 1000)
    spec = Measurement(name="thd", kind="thd", node="out", start=.0005,
                       stop=.0007 if case == "short" else .003 if case == "outside" else .0019)
    result = measure(Circuit(), waveform(t, y), {"kind": "ac" if case == "ac" else "tran"}, spec)
    assert result["status"] == "unverified", result
    assert result["value"] is None
