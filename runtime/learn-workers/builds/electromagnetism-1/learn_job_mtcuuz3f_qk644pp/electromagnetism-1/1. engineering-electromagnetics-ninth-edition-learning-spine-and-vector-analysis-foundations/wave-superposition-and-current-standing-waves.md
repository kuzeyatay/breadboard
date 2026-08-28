---
title: "1.208 Wave Superposition and Current Standing Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 372", "Page 373", "Page 374"]
related: ["charged-line-transients-and-reflection-diagrams", "transmission-line-reflection-and-standing-wave-analysis", "traveling-wave-direction-and-sinusoidal-solutions"]
---

# 1.208 Wave Superposition and Current Standing Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 372, Page 373, Page 374

Traveling waves on transmission lines combine by linear superposition. The problem set asks for single-wave representations formed from equal-frequency waves with a phase offset, as well as combinations of waves at frequencies $\omega$ and $3\omega$. For an open-circuited lossless line, the voltage reflection coefficient is unity, so the reflected voltage has the same phase at the load. The corresponding reflected current reverses sign, ensuring that incident and reflected currents cancel at the open end. Combining these current waves produces a standing-wave pattern whose temporal and spatial factors can be separated through trigonometric identities. In lossy lines, superposed waves also carry the attenuation factor $e^{-\alpha z}$, and the current includes the phase of the complex characteristic impedance $Z_0=|Z_0|e^{j\delta}$. The associated average power must therefore be formed consistently from voltage and current phase relationships. These exercises teach a reusable method: write each wave in complex instantaneous form, combine algebraically, then take the real part and simplify to expose amplitude modulation, spatial standing-wave structure, or average power.

## Page-Grounded Details

#### Page 372

The current through the resistor is most easily obtained by dividing the voltages in Figure 10.28a by $-R_{g}$. As a demonstration, we can also use the current diagram of Figure 10.22a to obtain this result. Using (120) and (121), we evaluate the current waves as follows:
$$
\begin{array}[]{rcl}I_{1}^{+}&=&V_{1}^{+}/Z_{0}=-1.2\ A\\ I_{1}^{-}&=&-V_{1}^{-}/Z_{0}=+1.2\ A\\ I_{2}^{+}&=&-I_{2}^{-}&=V_{2}^{+}/Z_{0}=+0.6\ A\\ I_{3}^{+}&=&-I_{3}^{-}&=V_{3}^{+}/Z_{0}=-0.30\ A\\ I_{4}^{+}&=&-I_{4}^{-}&=V_{4}^{+}/Z_{0}=+0.15\ A\end{array}
$$
Using these values on the current reflection diagram, Figure 10.22a, we add up currents in the resistor in time by moving up the left-hand axis, as we did with the voltage diagram. The result is shown in Figure 10.28b. As a further check to the correctness of our diagram construction, we note that current at the open end of the line ($Z=l$) must always be zero. Therefore, summing currents up the right-hand axis must give a zero result for all time. The reader is encouraged to verify this.

#### REFERENCES

1. White, H. J., P. R. Gillette, and J. V. Lebacqz. "The Pulse-Forming Network." Chapter 6 in Pulse Generators, edited by G. N, Glasoe and J. V.

[Truncated for analysis]

#### Page 373

10.3

A voltage pulse propagates within a lossless transmission line of characteristic impedance $Z_{0}=50\Omega$. The pulse is gaussian in shape, having a voltage envelope given by $V(t)=V_{0}e^{-t^{2}/2T^{2}}$ where $V_{0}=10V$ and $T=20ns$. The pulse is incident on a 100-$\Omega$ load at the far end of the line. Determine the energy in joules that is dissipated by the load.

10.4

A sinusoidal voltage wave of amplitude $V_{0}$, frequency $\omega$, and phase constant $\beta$ propagates in the forward $z$ direction toward the open load end in a lossless transmission line of characteristic impedance $Z_{0}$. At the end, the wave totally reflects with zero phase shift, and the reflected wave now interferes with the incident wave to yield a standing wave pattern over the line length (as per Example 10.1). Determine the standing wave pattern for the _current_ in the line. Express the result in real instantaneous form and simplify.

10.5

Two voltage waves of equal amplitude $V_{0}$ and radian frequency $\omega$ propagate in the forward $z$ direction in a lossy transmission line having attenuation coefficient $\alpha$, and characteristic impedance $ Z_{0}=|Z

[Truncated for analysis]

#### Page 374

10.9 $\blacktriangleleft$ A 100-m transmission line is used to propagate a signal from a transmitter to a receiver whose input impedance is 50 $\Omega$. The transmitter is capable of launching 12 dBm average power at the input end of the line (see Problem 10.8 for the definition of dBm). The line is lossy, having characteristic impedance $Z_{0}=75+j10~{}\Omega$, and power loss coefficient $A=0.05$ dB/m. Find the power that enters the receiver in both dBm and in mW.

10.10 $\blacktriangleleft$ Two lossless transmission lines having different characteristic impedances are to be joined end to end. The impedances are $Z_{01}=100~{}\Omega$ and $Z_{03}=25~{}\Omega$. The operating frequency is 1 GHz. ($a$) Find the required characteristic impedance, $Z_{02}$, of a quarter-wave section to be inserted between the two, which will impedance-match the joint, thus allowing total power transmission through the three lines. ($b$) The capacitance per unit length of the intermediate line is found to be 100 pF/m. Find the shortest length in meters of this line that is needed to satisfy the impedance-matching condition. ($c$) With the three-segment setup as found in parts ($a$

[Truncated for analysis]

## Core Ideas

- Linear wave solutions can be added before converting back to real instantaneous form.
- Equal-frequency waves with phase separation can be reduced to one sinusoid with a new amplitude and phase.
- An open circuit gives zero total load current through cancellation of incident and reflected current waves.
- Standing waves arise from equal-frequency waves traveling in opposite directions.
- A complex $Z_0$ introduces a voltage-current phase difference in lossy lines.
- Different-frequency waves can be combined in complex form to reveal a modulated spatial pattern.
- Average power depends on the relative phase between voltage and current.

## Source Anchors

- Problem 10.4 specifies total voltage reflection with zero phase shift at an open load and asks for the real instantaneous current standing wave.
- Problem 10.5 specifies two equal-amplitude waves separated by $\phi$ in a lossy line with $Z_0=|Z_0|e^{j\delta}$.
- Problem 10.11 combines forward waves at $\omega$ and $3\omega$, with phase constants $\beta$ and $3\beta$, and requests a plot versus $\beta z$ at $t=0$.
- Page 372 states that current at the open end must always sum to zero.
- The current-wave values on Page 372 explicitly use opposite signs for reflected waves.

## Related Pages

- [[charged-line-transients-and-reflection-diagrams|Charged-Line Transients and Reflection Diagrams]]
- [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]

## Concept Dependencies

- part-of: [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- related: [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
- enables: [[charged-line-transients-and-reflection-diagrams|Charged-Line Transients and Reflection Diagrams]]
