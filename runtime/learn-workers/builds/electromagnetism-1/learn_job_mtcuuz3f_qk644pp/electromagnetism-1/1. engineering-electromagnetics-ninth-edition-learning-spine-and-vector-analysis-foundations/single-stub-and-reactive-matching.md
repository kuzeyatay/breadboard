---
title: "1.212 Single-Stub and Reactive Matching"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 378", "Page 379"]
related: ["smith-chart-impedance-and-admittance-procedures", "transmission-line-reflection-and-standing-wave-analysis", "quarter-wave-impedance-transformation"]
---

# 1.212 Single-Stub and Reactive Matching

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 378, Page 379

Single-stub matching removes the reactive part of a transformed load admittance at a selected point on a lossless line. The main-line distance is chosen so that the normalized conductance equals unity. A shunt stub then supplies an equal and opposite susceptance, leaving the input matched to $Z_0$ on the source side. The source problems treat both short-circuited and open-circuited stubs, ask for shortest attachment distances and stub lengths, and include inverse problems in which a known matched geometry must be used to recover the original load. A related task replaces the stub with a shunt capacitor after finding a point where the input admittance has real part $1/Z_0$ and negative imaginary part. The capacitor contributes positive susceptance at the operating frequency and restores unity standing-wave ratio. Because stub and line lengths are electrical lengths, the chosen solution depends on wavelength and may have multiple periodic equivalents. Figures 10.35 and 10.36 contain the line and stub geometries required for Problems 10.34 and 10.36 and must remain attached to this matching procedure.

## Page-Grounded Details

#### Page 378

Figure 10.34 See Problem 10.30.

10.31 In order to compare the relative sharpness of the maxima and minima of a standing wave, assume a load $z_{L}=4+j0$ is located at $z=0$. Let $\left|V\right|_{\min}=1$ and $\lambda=1$ m. Determine the width of the (a) minimum where $\left|V\right|<1.1$; (b) maximum where $\left|V\right|>4/1.1$.

10.32 In Figure 10.17, let $Z_{L}=250\Omega$ and $Z_{0}=50\Omega$. Find the shortest attachment distance d and the shortest length $d_{1}$ of a short-circuited stub line that will provide a perfect match on the main line to the left of the stub. Express all answers in wavelengths.

10.33 In Figure 10.17, let $Z_{L}=100+j150\Omega$ and $Z_{0}=100\Omega$. Find the shortest length $d_{1}$ of a short-circuited stub and the shortest distance d that it may be located from the load to provide a perfect match on the main line to the left of the stub. (b) Repeat for an open-circuited stub. Express all answers in wavelengths.

10.34 The lossless line shown in Figure 10.35 is operating with $\lambda=100$ cm. If $d_{1}=10$ cm, d=25 cm, and the line is matched to the left of the stub, what is $Z_{L}$?

10.35 A load, $ Z_{L}=25+j75\Omega

[Truncated for analysis]

#### Page 379

Figure 10.36 See Problem 10.36.

10.37 In the transmission line of Figure 10.20, $R_{g}=Z_{0}=50\Omega$, and $R_{L}=25\Omega$. Determine and plot the voltage at the load resistor and the current in the battery as functions of time by constructing appropriate voltage and current reflection diagrams.

10.38 Repeat Problem 10.37, with $Z_{0}=50\Omega$, and $R_{L}=R_{g}=25\Omega$. Carry out the analysis for the time period $0<t<8l/v$.

10.39 In the transmission line of Figure 10.20, $Z_{0}=50\Omega$, and $R_{L}=R_{g}=25\Omega$. The switch is closed at $t=0$ and is opened again at time $t=l/4v$, thus creating a rectangular voltage pulse in the line. Construct an appropriate voltage reflection diagram for this case, and use it to make a plot of the voltage at the load resistor as a function of time for $0<t<8l/v$ (note that the effect of opening the switch is to initiate a second voltage wave, whose value is such that it leaves a net current of zero in its wake).

10.40 In the charged line of Figure 10.25, the characteristic impedance is $Z_{0}=100\Omega$, and $R_{g}=300\Omega$. The line is charged to initial voltage, $V_{0}=160V$, and the switch is closed at $

[Truncated for analysis]

## Core Ideas

- Transform the load to a point where normalized conductance is unity.
- Cancel the remaining susceptance with a shunt stub or lumped reactance.
- Short- and open-circuited stubs realize different susceptance-length relations.
- The shortest solution is selected among periodic line-length alternatives.
- A matched line has unity standing-wave ratio to the source side of the matching element.
- A shunt capacitor supplies frequency-dependent positive susceptance.
- Inverse matching problems recover the load from known stub geometry and a matched-input condition.

## Source Anchors

- Problem 10.32 asks for the shortest attachment distance and short-circuited stub length for $Z_L=250\,\Omega$ and $Z_0=50\,\Omega$.
- Problem 10.33 uses $Z_L=100+j150\,\Omega$ and $Z_0=100\,\Omega$ and requests both short- and open-circuited stub solutions.
- Problem 10.34 gives $\lambda=100$ cm, $d_1=10$ cm, and $d=25$ cm, with the line matched to the left of the stub, and asks for $Z_L$.
- Problem 10.35 uses $Z_L=25+j75\,\Omega$, $Z_0=50\,\Omega$, $v=c$, and $f=300$ MHz, then asks for a shunt capacitance that produces unity standing-wave ratio.
- Figures 10.35 and 10.36 should be retained as S1.P378.F2 and S1.P379.F1 and used to reconstruct the exact stub topologies.

## Related Pages

- [[smith-chart-impedance-and-admittance-procedures|Smith-Chart Impedance and Admittance Procedures]]
- [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]

## Concept Dependencies

- depends-on: [[smith-chart-impedance-and-admittance-procedures|Smith-Chart Impedance and Admittance Procedures]]
- applies-to: [[transmission-line-reflection-and-standing-wave-analysis|Transmission-Line Reflection and Standing-Wave Analysis]]
- contrasts-with: [[quarter-wave-impedance-transformation|Quarter-Wave Impedance Transformation]]
