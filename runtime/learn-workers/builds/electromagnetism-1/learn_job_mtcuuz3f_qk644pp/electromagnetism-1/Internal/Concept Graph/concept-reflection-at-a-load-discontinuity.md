---
title: "Reflection at a Load Discontinuity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "reflection-at-a-load-discontinuity"
locations: ["Page 334", "Page 335"]
related: ["characteristic-impedance-of-a-transmission-line", "power-reflection-and-load-absorption", "standing-wave-decomposition-and-voltage-extrema", "finite-lossless-line-input-impedance", "propagation-constant-and-traveling-wave-solutions"]
---

## ConceptNode: Reflection at a Load Discontinuity

Planning node for [[reflection-at-a-load-discontinuity|1.183 Reflection at a Load Discontinuity]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 334, Page 335

A reflected wave is required when an incident wave reaches a load whose impedance does not satisfy the voltage and current boundary conditions by itself. With the load placed at $z=0$, the incident and reflected voltage amplitudes are $V_{0i}$ and $V_{0r}$. At the load, $V_L=V_{0i}+V_{0r}$, while the current is $(V_{0i}-V_{0r})/Z_0$ because the reflected current has the opposite sign relative to reflected voltage. Enforcing $V_L/I_L=Z_L$ gives the complex voltage reflection coefficient $$\Gamma=\frac{V_{0r}}{V_{0i}}=\frac{Z_L-Z_0}{Z_L+Z_0}=|\Gamma|e^{j\phi_r}.$$ The voltage transmission coefficient at the load is $\tau=V_L/V_{0i}=1+\Gamma=2Z_L/(Z_0+Z_L)$. A matched load satisfies $Z_L=Z_0$, giving $\Gamma=0$ and no reflected wave. Figure 10.5 depicts the incident wave, reflected wave, line impedance, and complex terminating load that define this boundary-value problem.

### Key planning details

- Reflections arise from boundary conditions at impedance discontinuities.
- $V_L=V_{0i}+V_{0r}$.
- $I_L=(V_{0i}-V_{0r})/Z_0$.
- $\Gamma=(Z_L-Z_0)/(Z_L+Z_0)$.
- $\tau=1+\Gamma=2Z_L/(Z_0+Z_L)$.
- Impedance matching requires $Z_L=Z_0$.
- A complex $\Gamma$ represents both amplitude change and phase shift.

### Source coverage

- Figure 10.5 shows voltage-wave reflection from a complex load impedance.
- Equations (70a) and (70b) give incident and reflected phasor voltages.
- Equations (71) and (72) enforce load voltage and current conditions.
- Equation (73) defines $\Gamma$.
- Equation (75) defines $\tau$.
- The source states that the incident amplitude in these formulas is the amplitude at the load after line loss.
