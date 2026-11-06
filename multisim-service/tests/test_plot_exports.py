"""Plots must show the requested engineering signal and measured time window."""

import numpy as np
import pytest

from breadboard_multisim import artifacts
from breadboard_multisim.circuit import Circuit
from breadboard_multisim.measurements import Constraint, Measurement, verify
from breadboard_multisim.tools import dispatch


def transient():
    time = np.linspace(0, 0.02, 201)
    # Put output after the default twelve traces to catch alphabetical truncation.
    columns = ["time", *[f"v(bias{i})" for i in range(13)], "v(out)", "v(in)"]
    rows = np.column_stack(
        [time, *[time * 0 + i for i in range(13)], np.sin(2 * np.pi * 1000 * time), time * 2]
    )
    return {"variables": [{"name": name} for name in columns], "rows": rows.tolist()}


def test_selected_output_and_time_window_are_exported(tmp_path, monkeypatch):
    figures = []
    close = artifacts.plt.close
    monkeypatch.setattr(artifacts.plt, "close", lambda figure: figures.append(figure))
    paths = artifacts.plot(
        transient(), {"kind": "tran"}, tmp_path, output_node="out", input_node="in", start=0.015, stop=0.016
    )
    figure = figures[-1]
    lines = figure.axes[0].lines
    assert [line.get_label() for line in lines] == ["v(out)", "v(in)"]
    for line in lines:
        assert line.get_xdata().min() >= 0.015
        assert line.get_xdata().max() <= 0.016
    np.testing.assert_allclose(lines[1].get_ydata(), lines[1].get_xdata() * 2)
    assert all(artifacts.Path(path).stat().st_size > 1000 for path in paths)
    assert "v(out)" in (tmp_path / "waveform.svg").read_text(encoding="utf-8")
    close(figure)


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"start": -0.001}, "outside"),
        ({"stop": 0.021}, "outside"),
        ({"start": 0.016, "stop": 0.015}, "start < stop"),
        ({"start": float("nan")}, "finite"),
        ({"start": 0.01501, "stop": 0.01502}, "two simulated samples"),
        ({"output_node": "missing"}, "Missing simulated vector"),
        ({"input_node": "in"}, "Specify output_node"),
    ],
)
def test_plot_rejects_unavailable_evidence(tmp_path, kwargs, message):
    with pytest.raises(ValueError, match=message):
        artifacts.plot(transient(), {"kind": "tran"}, tmp_path, **kwargs)
    assert not list(tmp_path.iterdir())


def test_time_window_does_not_silently_clip_other_analyses(tmp_path):
    with pytest.raises(ValueError, match="transient time bounds"):
        artifacts.plot(transient(), {"kind": "ac"}, tmp_path, start=0.001)


def test_report_includes_constraint_only_measurements(tmp_path):
    circuit = Circuit(title="Report test")
    requirement = Constraint(
        measurement=Measurement(name="input", kind="voltage", node="in", statistic="max"),
        minimum=0.03,
        maximum=0.05,
    )
    verification = verify(circuit, transient(), {"kind": "tran"}, [requirement])
    artifacts.report(tmp_path, circuit, {"backend": "ngspice", "success": True, "verification": verification})
    report = (tmp_path / "report.md").read_text(encoding="utf-8")
    assert "| input | 0.04 | V | 0.03 to 0.05 | pass |" in report


def test_native_plot_exports_selected_samples_without_touching_original(service, monkeypatch):
    run_id = "a" * 32
    directory = service.path("runs", run_id)
    directory.mkdir(parents=True)
    original = directory / "data.csv"
    original.write_text("original immutable export", encoding="utf-8")
    monkeypatch.setattr(service, "_run_data", lambda _: (None, transient(), {"kind": "tran"}))
    result = dispatch(
        service, "plot_results", {"run_id": run_id, "output_node": "out", "start": 0.015, "stop": 0.016}
    )
    exported = next(artifacts.Path(p) for p in result["paths"] if p.endswith(".csv"))
    rows = list(artifacts.csv.reader(exported.open(encoding="utf-8")))
    assert rows[0] == ["time_s", "v(out)"]
    expected = np.asarray(transient()["rows"])
    selected = expected[(expected[:, 0] >= 0.015) & (expected[:, 0] <= 0.016)][:, [0, 14]]
    np.testing.assert_array_equal(np.asarray(rows[1:], dtype=float), selected)
    assert original.read_text(encoding="utf-8") == "original immutable export"
    assert exported.parent.parent.name == "plots"


def test_ac_export_preserves_real_and_imaginary_parts(tmp_path):
    raw = {
        "variables": [{"name": n} for n in ["frequency", "v(out)", "v(in)"]],
        "rows": [[100, 2, 1], [1000, 3, 1]],
        "imaginary_rows": [[0, -1, 0], [0, -2, 0]],
    }
    artifacts.plot(raw, {"kind": "ac"}, tmp_path, "out", "in", export_csv=True)
    with (tmp_path / "plotted-data.csv").open(encoding="utf-8") as handle:
        rows = list(artifacts.csv.reader(handle))
    assert rows[0] == ["frequency_Hz", "v(out).real", "v(out).imag", "v(in).real", "v(in).imag"]
    np.testing.assert_array_equal(
        np.asarray(rows[1:], dtype=float), [[100, 2, -1, 1, 0], [1000, 3, -2, 1, 0]]
    )
