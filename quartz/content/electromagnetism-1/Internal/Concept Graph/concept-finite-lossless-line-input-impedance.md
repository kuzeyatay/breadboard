---
title: "Finite Lossless Line Input Impedance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "finite-lossless-line-input-impedance"
locations: ["Page 341", "Page 342", "Page 343"]
related: ["reflection-at-a-load-discontinuity", "standing-wave-decomposition-and-voltage-extrema", "half-wave-and-quarter-wave-impedance-transformation", "matched-and-mismatched-receiver-line-example", "propagation-constant-and-traveling-wave-solutions"]
---

## ConceptNode: Finite Lossless Line Input Impedance

Planning node for [[finite-lossless-line-input-impedance|1.188 Finite Lossless Line Input Impedance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 341, Page 342, Page 343

A finite unmatched line supports many individual reflections, but in sinusoidal steady state they can be represented by one net forward wave and one net backward wave. Their total phasor voltage and current define the position-dependent wave impedance $Z_w(z)=V_{sT}(z)/I_{sT}(z)$. Substituting the forward and backward amplitude relations and the load reflection coefficient gives $$Z_w(z)=Z_0\frac{Z_L\cos(\beta z)-jZ_0\sin(\beta z)}{Z_0\cos(\beta z)-jZ_L\sin(\beta z)}.$$ For a line of length $l$ occupying $-l\le z\le0$, evaluation at $z=-l$ produces the input impedance $$Z_{\mathrm{in}}=Z_0\frac{Z_L\cos(\beta l)+jZ_0\sin(\beta l)}{Z_0\cos(\beta l)+jZ_L\sin(\beta l)}.$$ Figure 10.7 shows the finite line, source phasor, generator impedance, load, and equivalent input circuit. The input impedance is the quantity seen by the source and incorporates all steady-state reflections without tracking each reflected wave separately.

### Key planning details

- Multiple steady-state reflections combine into net forward and backward waves.
- $Z_w(z)$ is the ratio of total phasor voltage to total phasor current.
- The input impedance is $Z_w(-l)$.
- $Z_{\mathrm{in}}$ depends on $Z_0$, $Z_L$, $\beta$, and $l$.
- The line transforms the load impedance according to electrical length.
- The transformed input impedance supports an equivalent source circuit.

### Source coverage

- Figure 10.7 shows the finite-length transmission-line configuration and equivalent circuit.
- Equations (93) and (94) define total voltage and current using net forward and backward waves.
- Equation (95) defines $Z_w(z)$.
- Equations (96) and (97) reduce the wave-impedance expression.
- Equation (98) gives the line input impedance.
