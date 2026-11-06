# 10 kHz Wien oscillator: isolated four-pole filtering and calibrated output

Backend: ngspice. Circuit SHA-256: `e185558ea1cc5600c7fff61aec1e5d6622f4f74606bf29b265f4f7cc8f73b2d8`.

Simulation: passed.

| Measurement | Value | Unit | Status |
| --- | --- | --- | --- |

Requirements: **pass**.

[Circuit IR](circuit.json) · [SPICE](circuit.cir) · [Data](data.csv) · [Log](run.log)

| Requirement | Measured value | Unit | Allowed range / target | Verdict |
| --- | --- | --- | --- | --- |
| frequency | 10012.935139214387 | Hz | 9900.0 to 10100.0 | pass |
| THD | 0.559674550534241 | % | None to 1.0 | pass |
| power | 0.0009987409544336538 | W | 0.00099 to 0.001 | pass |

Built-in op amp has finite gain and bandwidth and rail limiting, but no intrinsic noise, slew or output current limit. Use a validated vendor model for device-level claims.

Assumptions:
- Educational BB_OPAMP and generic diode models only; no hardware qualification, noise, slew or current-limit claim.
- Working revision 2 feedback and startup path preserved. Original failures retained.
- Four isolated RC low-pass stages plus buffered high-pass. Gain calibration separate from limiter and potentiometer.
- Limiter references derived from +/-12 V through dividers and buffers.
- Full endpoint represented by direct connection to potentiometer top; mute connects output follower input to ground. Intermediate settings use complementary 100k potentiometer segments.
- Budget: at most five normal tuning candidates followed by control, filter and overload verification.
