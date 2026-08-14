---
title: "1.207 Distributed Line Parameters, Attenuation, and Power Budgets"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 372", "Page 373", "Page 374", "Page 375"]
related: ["transmission-line-reflection-and-standing-wave-analysis", "quarter-wave-impedance-transformation", "lossy-dielectric-propagation-and-complex-wavenumber"]
---

# 1.207 Distributed Line Parameters, Attenuation, and Power Budgets

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 372, Page 373, Page 374, Page 375

The end-of-chapter problems consolidate how the distributed parameters $R$, $L$, $G$, and $C$ determine propagation, characteristic impedance, attenuation, phase, and wavelength. They also connect field and circuit quantities to practical power budgets. Tasks include calculating $\alpha$, $\beta$, $\lambda$, and $Z_0$ from per-unit-length parameters; converting attenuation between propagation coefficients and decibels per meter; accumulating losses across cascaded line sections and splices; and determining the power delivered to a mismatched receiver. The dBm scale is defined relative to one milliwatt, making additive loss accounting possible in logarithmic form. Several problems require separating line attenuation from mismatch loss so that transmitted, reflected, and absorbed powers are not confused. Skin effect supplies a frequency-dependent extension: line resistance follows $R=A_0f^{1/2}$, so attenuation and delivered power must be recomputed when frequency changes. The Gaussian-pulse problem also asks for load-dissipated energy, requiring the reflected and transmitted pulse amplitudes or powers to be integrated over time.

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

#### Page 375

Figure 10.29 See Problem 10.15.

per unit length, G, is zero. The 50-$\Omega$ line has a measured power loss of 10.0 dB over a 100-m length at f = 100 MHz. (a) Find the value of $A_{0}$ and the line resistance per meter at 100 MHz. (b) At the line input, a 10-W power transmitter is attached. At the far end of the line, a 100-$\Omega$ load impedance is attached. How much power is dissipated by the load at frequency 400 MHz?

10.14 [1] A lossless transmission line having characteristic impedance $Z_{0}=50\,\Omega$ is driven by a source at the input end that consists of the series combination of a 10-V sinusoidal generator and a 50-$\Omega$ resistor. The line is one-quarter wavelength long. At the other end of the line, a load impedance $Z_{L}=50-j50\,\Omega$ is attached. (a) Evaluate the input impedance to the line seen by the voltage source-resistor combination. (b) Evaluate the power that is dissipated by the load. (c) Evaluate the voltage amplitude that appears across the load.

10.15 [1] For the transmission line represented in Figure 10.29, find $V_{s,\rm out}$ if f = (a) 60 Hz; (b) 500 kHz.

10.16 [1] A 100-$\Omega$ lossless transmission line is connected to a s

[Truncated for analysis]

## Core Ideas

- Distributed parameters $R$, $L$, $G$, and $C$ determine $\alpha$, $\beta$, $\lambda$, and $Z_0$.
- Power loss ratings in dB/m add linearly with distance when forming a link budget.
- Splice loss adds to distributed losses in a cascaded transmission path.
- The dBm definition is $P(\mathrm{dBm})=10\log_{10}[P(\mathrm{mW})/1\,\mathrm{mW}]$.
- Receiver sensitivity specifies the minimum received power, not the required line-input power.
- Load mismatch causes reflection and must be included separately from propagation loss.
- Skin-effect resistance follows $R=A_0f^{1/2}$ in the stated model.
- Pulse energy is obtained by integrating instantaneous load power over time.

## Source Anchors

- Problem 10.1 gives $\omega=6\times10^8\,\mathrm{rad/s}$, $L=0.350\,\mu\mathrm{H/m}$, $C=40\,\mathrm{pF/m}$, $G=0$, and $R=15.0\,\Omega/\mathrm{m}$.
- Problem 10.3 specifies $V(t)=V_0e^{-t^2/(2T^2)}$, with $V_0=10\,\mathrm{V}$, $T=20\,\mathrm{ns}$, $Z_0=50\,\Omega$, and a $100\,\Omega$ load.
- Problem 10.7 combines 40 m at 0.1 dB/m, 25 m at 0.2 dB/m, and a 2 dB splice loss.
- Problem 10.8 explicitly defines dBm and gives a receiver sensitivity of $-20$ dBm.
- Problem 10.9 uses a complex characteristic impedance $Z_0=75+j10\,\Omega$ and a power loss coefficient of 0.05 dB/m.
- Problem 10.13 states the skin-effect model $R=A_0f^{1/2}$ and supplies a measured 10.0 dB loss over 100 m at 100 MHz.

## Related Pages

- [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]
- [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]

## Concept Dependencies

- related: [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- applies-to: [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]
- related: [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
