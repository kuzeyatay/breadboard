---
title: "1.183 Reflection at a Load Discontinuity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 334", "Page 335"]
related: ["characteristic-impedance-of-a-transmission-line", "power-reflection-and-load-absorption", "standing-wave-decomposition-and-voltage-extrema", "finite-lossless-line-input-impedance", "propagation-constant-and-traveling-wave-solutions"]
---

# 1.183 Reflection at a Load Discontinuity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 334, Page 335

A reflected wave is required when an incident wave reaches a load whose impedance does not satisfy the voltage and current boundary conditions by itself. With the load placed at $z=0$, the incident and reflected voltage amplitudes are $V_{0i}$ and $V_{0r}$. At the load, $V_L=V_{0i}+V_{0r}$, while the current is $(V_{0i}-V_{0r})/Z_0$ because the reflected current has the opposite sign relative to reflected voltage. Enforcing $V_L/I_L=Z_L$ gives the complex voltage reflection coefficient
$$
\Gamma=\frac{V_{0r}}{V_{0i}}=\frac{Z_L-Z_0}{Z_L+Z_0}=|\Gamma|e^{j\phi_r}
$$
 The voltage transmission coefficient at the load is $\tau=V_L/V_{0i}=1+\Gamma=2Z_L/(Z_0+Z_L)$. A matched load satisfies $Z_L=Z_0$, giving $\Gamma=0$ and no reflected wave. Figure 10.5 depicts the incident wave, reflected wave, line impedance, and complex terminating load that define this boundary-value problem.

## Page-Grounded Details

#### Page 334

are all end-to-end connected, the net loss in dB for the entire span is just the sum of the dB losses of the individual elements.

D10.2. Two transmission lines are to be joined end to end. Line 1 is 30 m long and is rated at 0.1 dB/m. Line 2 is 45 m long and is rated at 0.15 dB/m. The joint is not done well and imparts a 3-dB loss. What percentage of the input power reaches the output of the combination?

Ans. 5.3%

#### 10.9 WAVE REFLECTION AT DISCONTINUITIES

The concept of wave reflection was introduced in Section 10.1. As implied there, the need for a reflected wave originates from the necessity to satisfy all voltage and current boundary conditions at the ends of transmission lines and at locations at which two dissimilar lines are connected to each other. The consequences of reflected waves are usually less than desirable, in that some of the power that was intended to be transmitted to a load, for example, reflects and propagates back to the source. Conditions for achieving no reflected waves are therefore important to understand.

The basic reflection problem is illustrated in Figure 10.5. In it, a transmission line of characteristic impedance $Z_{0}$ is terminated by a

[Truncated for analysis]

#### Page 335

The phasor voltage at the load is now the sum of the incident and reflected voltage phasors, evaluated at $z=0$ :
$$
V_{L}=V_{0i}+V_{0r}\quad{(71)}
$$
Additionally, the current through the load is the sum of the incident and reflected currents, also at $z=0$ :
$$
I_{L}=I_{0i}+I_{0r}=\frac{1}{Z_{0}}\left[V_{0i}-V_{0r}\right]=\frac{V_{L}}{Z_{L}}=\frac{1}{Z_{L}}\left[V_{0i}+V_{0r}\right]\quad{(72)}
$$
We can now solve for the ratio of the reflected voltage amplitude to the incident voltage amplitude, defined as the reflection coefficient, $\Gamma$ :
$$
\Gamma\equiv\frac{V_{0r}}{V_{0i}}=\frac{Z_{L}-Z_{0}}{Z_{L}+Z_{0}}=|\Gamma|e^{j\phi_{r}}\quad{(73)}
$$
where we emphasize the complex nature of $\Gamma$ - meaning that, in general, a reflected wave will experience a reduction in amplitude and a phase shift, relative to the incident wave.

Now, using (71) with (73), we may write
$$
V_{L}=V_{0i}+\Gamma\,V_{0i}\quad{(74)}
$$
from which we find the transmission coefficient, defined as the ratio of the load voltage amplitude to the incident voltage amplitude:
$$
\tau\equiv\frac{V_{L}}{V_{0i}}=1+\Gamma=\frac{2Z_{L}}{Z_{0}+Z_{L}}=|\tau|e^{j\phi_{i}}\quad{(75)}
$$
A point that

[Truncated for analysis]

## Core Ideas

- Reflections arise from boundary conditions at impedance discontinuities.
- $V_L=V_{0i}+V_{0r}$.
- $I_L=(V_{0i}-V_{0r})/Z_0$.
- $\Gamma=(Z_L-Z_0)/(Z_L+Z_0)$.
- $\tau=1+\Gamma=2Z_L/(Z_0+Z_L)$.
- Impedance matching requires $Z_L=Z_0$.
- A complex $\Gamma$ represents both amplitude change and phase shift.

## Source Anchors

- Figure 10.5 shows voltage-wave reflection from a complex load impedance.
- Equations (70a) and (70b) give incident and reflected phasor voltages.
- Equations (71) and (72) enforce load voltage and current conditions.
- Equation (73) defines $\Gamma$.
- Equation (75) defines $\tau$.
- The source states that the incident amplitude in these formulas is the amplitude at the load after line loss.

## Related Pages

- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- [[power-reflection-and-load-absorption|Power Reflection and Load Absorption]]
- [[standing-wave-decomposition-and-voltage-extrema|Standing-Wave Decomposition and Voltage Extrema]]
- [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]
- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]

## Concept Dependencies

- depends-on: [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- depends-on: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
