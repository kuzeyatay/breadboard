---
title: "1.209 Quarter-Wave Impedance Transformation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 374", "Page 375"]
related: ["distributed-line-parameters-attenuation-and-power-budgets", "transmission-line-reflection-and-standing-wave-analysis", "single-stub-and-reactive-matching"]
---

# 1.209 Quarter-Wave Impedance Transformation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 374, Page 375

A quarter-wave transmission-line section transforms its terminating impedance and can match two lines with different real characteristic impedances. The problem set develops this through lines joined by an intermediate section, loaded quarter-wave lines, and frequency changes that alter the section's electrical length. For two real line impedances $Z_{01}$ and $Z_{03}$, the matching section uses the geometric-mean characteristic impedance $Z_{02}=\sqrt{Z_{01}Z_{03}}$. Its physical length follows from the wavelength in that section, which can be inferred from its distributed capacitance and characteristic impedance for a lossless line. The match is frequency-specific: doubling frequency turns a section that was one quarter wavelength long into a half-wavelength section, changing the impedance seen at the junction and generally restoring mismatch. Related problems use the general lossless-line input-impedance transformation to calculate source loading, dissipated power, load voltage, standing-wave ratio, and reflected power. A separate maximum-power-transfer problem asks for the line length that transforms a complex load into the complex conjugate required by the source impedance.

## Page-Grounded Details

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

- A quarter-wave line transforms a load according to $Z_{\mathrm{in}}=Z_0^2/Z_L$.
- A real-to-real quarter-wave match uses $Z_{02}=\sqrt{Z_{01}Z_{03}}$.
- The shortest matching section has electrical length $\lambda/4$ at the design frequency.
- Changing frequency changes electrical length even when physical length is fixed.
- A half-wave section repeats its terminating impedance at the input.
- Mismatch after a frequency shift can be quantified by reflection coefficient, standing-wave ratio, and reflected-power fraction.
- A line can transform a displaced complex load to satisfy the source's conjugate-match condition.

## Source Anchors

- Problem 10.10 joins $100\,\Omega$ and $25\,\Omega$ lines with a quarter-wave section at 1 GHz and then doubles the frequency to 2 GHz.
- Problem 10.10 gives the intermediate-line capacitance as 100 pF/m and asks for the shortest physical length.
- Problem 10.12 asks for an equation in line length $\ell$ that makes the transformed load the complex conjugate of $Z_g=R_g+jX_g$.
- Problem 10.14 uses a one-quarter-wavelength $50\,\Omega$ line terminated by $50-j50\,\Omega$.
- Problem 10.16 uses a $40\,\Omega$, $\lambda/4$ section terminated by $25\,\Omega$ and asks how its input impedance changes when frequency is halved.
- Figure 10.29, retained as S1.P375.F1, belongs to Problem 10.15 and should support a source-aware circuit interpretation before solution.

## Related Pages

- [[distributed-line-parameters-attenuation-and-power-budgets|Distributed Line Parameters, Attenuation, and Power Budgets]]
- [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- [[single-stub-and-reactive-matching|Single-Stub and Reactive Matching]]

## Concept Dependencies

- applies-to: [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- contrasts-with: [[single-stub-and-reactive-matching|Single-Stub and Reactive Matching]]
- depends-on: [[distributed-line-parameters-attenuation-and-power-budgets|Distributed Line Parameters, Attenuation, and Power Budgets]]
