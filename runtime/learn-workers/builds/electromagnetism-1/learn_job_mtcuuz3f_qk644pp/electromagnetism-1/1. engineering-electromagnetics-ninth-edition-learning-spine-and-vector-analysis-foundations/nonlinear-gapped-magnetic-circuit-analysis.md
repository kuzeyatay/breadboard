---
title: "1.127 Nonlinear Gapped Magnetic Circuit Analysis"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 273", "Page 274", "Page 275", "Section 8.8", "Example 8.7", "Example 8.8", "Figure 8.13", "Problems D8.9 and D8.10"]
related: ["magnetic-circuit-analogy-and-reluctance", "ferromagnetic-magnetization-and-hysteresis", "magnetic-field-energy-and-air-gap-force", "air-core-toroid-circuit-calculation"]
---

# 1.127 Nonlinear Gapped Magnetic Circuit Analysis

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 273, Page 274, Page 275, Section 8.8, Example 8.7, Example 8.8, Figure 8.13, Problems D8.9 and D8.10

A magnetic circuit containing ferromagnetic steel and an air gap is analogous to a series circuit with one nonlinear element. When the desired flux density is given, the same flux passes through the steel and gap if leakage and fringing are neglected. Example 8.7 specifies $B=1$ T, a 2 mm air gap, a $6\,\mathrm{cm}^2$ cross section, a steel path of approximately $0.30\pi$ m, and 500 turns. The gap reluctance is $2.65\times10^6$ A-turn/Wb, the flux is $6\times10^{-4}$ Wb, and the gap requires 1590 A-turn. Figure 8.11 indicates that the steel requires $H=200$ A/m at 1 T, so its mmf drop is 188 A-turn. The total is 1778 A-turn, requiring 3.56 A. For the reverse problem in Example 8.8, a specified current gives total mmf while the nonlinear flux density is unknown. A straight-line approximation gives 1.13 T, while trial values and interpolation give 1.10 T. The air-gap reluctance dominates, allowing a comparatively crude steel model to remain useful.

## Page-Grounded Details

#### Page 273

Figure 8.12 A hysteresis loop for silicon steel. The coercive force $H_{c}$ and remnant flux density $B_{r}$ are indicated.

hysteresis loops are obtained, and the locus of the tips is about the same as the virgin magnetization curve of Figure 8.11.

#### EXAMPLE 8.7

We may use the magnetization curve for silicon steel to solve a magnetic circuit problem that is slightly different from our previous example. We use a steel core in the toroid, except for an air gap of 2 mm. Magnetic circuits with air gaps occur because gaps are deliberately introduced in some devices, such as inductors, which must carry large direct currents, because they are unavoidable in other devices such as rotating machines, or because of unavoidable problems in assembly. There are still 500 turns about the toroid, and we ask what current is required to establish a flux density of 1 T everywhere in the core.

**Solution.** This magnetic circuit is analogous to an electric circuit containing a voltage source and two resistors, one of which is nonlinear. Because we are given the "current," it is easy to find the "voltage" across each series element, and hence the total "emf." In the air gap,
$$
\begin{split

[Truncated for analysis]

#### Page 274

which is the same in both steel and air, we may find the mmf required for the gap
$$
 V_{m,\mathrm{air}}=(6\times 10^{-4})(2.65\times 10^{6})=1590~\mathrm{~A}\cdot\mathrm{t}
$$
Referring to Figure 8.11, a magnetic field strength of 200 A $\cdot$ t/m is required to produce a flux density of 1 T in the steel. Thus
$$
 \begin{align*}H_{\mathrm{steel}}&=200~\mathrm{~A}\cdot\mathrm{t}\\ V_{m,\mathrm{steel}}&=H_{\mathrm{steel}}d_{\mathrm{steel}}=200\times 0.30\pi\\ &=188~\mathrm{~A}\cdot\mathrm{t}\end{align*} $$
The total mmf is therefore 1778 A $\cdot$ t, and a coil current of 3.56 A is required.

We have made several approximations in obtaining this answer. We have already mentioned the lack of a completely uniform cross section, or cylindrical symmetry; the path of every flux line is not of the same length. The choice of a "mean" path length can help compensate for this error in problems in which it may be more important than it is in our example. Fringing flux in the air gap is another source of error, and formulas are available by which we may calculate an effective length and cross-sectional area for the gap which will yield more accurate results. There is also a leakage fl

[Truncated for analysis]

#### Page 275

Figure 8.13 See Problem D8.9.

D8.9. Given the magnetic circuit of Figure 8.13, assume $B=0.6\$T at the mid-point of the left leg and find: (a) $V_{m,\text{air}}$; (b) $V_{m,\text{steel}}$; (c) the current required in a 1300-turn coil linking the left leg.

Ans. (a) 3980 A*t; (b) 72 A*t; (c) 3.12 A

D8.10. The magnetization curve for material X under normal operating conditions may be approximated by the expression $B=(H/160)(0.25+e^{-H/320})$, where H is in A/m and B is in T. If a magnetic circuit contains a 12 cm length of material X, as well as a 0.25-mm air gap, assume a uniform cross section of 2.5 $\mathrm{cm}^{2}$ and find the total mmf required to produce a flux of (a) 10 $\mu$Wb; (b) 100 $\mu$Wb.

Ans. (a) 8.58 A*t; (b) 86.7 A*t

#### 8.9 POTENTIAL ENERGY AND FORCES ON MAGNETIC MATERIALS

In the electrostatic field we first introduced the point charge and the experimental law of force between point charges. After defining electric field intensity, electric flux density, and electric potential, we were able to find an expression for the energy in an electrostatic field by establishing the work necessary to bring the prerequisite point charges from infinity to

[Truncated for analysis]

## Core Ideas

- Series magnetic sections carry approximately the same flux when leakage is neglected.
- Each linear section has mmf drop $V_m=\Phi\mathcal{R}=Hd$.
- A nonlinear steel section requires its magnetization curve rather than a constant permeability.
- The total coil mmf equals the sum of the section mmf drops.
- An air gap can dominate the total reluctance even when it is physically short.
- Given flux density, the steel $H$ value can be read from the magnetization curve.
- Given current, nonlinear solutions can use trial values, plotting, and interpolation.
- Fringing, leakage, unequal path lengths, and nonuniform cross sections limit accuracy.

## Source Anchors

- Example 8.7 uses a 2 mm air gap, 500 turns, and desired $B=1$ T.
- The air-gap reluctance is $2.65\times10^6$ A-turn/Wb and its mmf drop is 1590 A-turn.
- At $B=1$ T, Figure 8.11 gives $H_{steel}=200$ A/m, producing a steel mmf drop of 188 A-turn.
- The total mmf is 1778 A-turn and the required current is 3.56 A.
- Example 8.8 obtains 1.13 T from a linearized model and 1.10 T from trial calculations and interpolation.
- The source identifies nonuniform path length, gap fringing, and leakage flux as approximation errors.
- Figure S13.P275.F8.13 supports Problem D8.9, which partitions mmf into air and steel contributions.
- Problem D8.10 supplies a nonlinear law $B=(H/160)(0.25+e^{-H/320})$ for material X.

## Related Pages

- [[magnetic-circuit-analogy-and-reluctance|Magnetic Circuit Analogy and Reluctance]]
- [[ferromagnetic-magnetization-and-hysteresis|Ferromagnetic Magnetization and Hysteresis]]
- [[magnetic-field-energy-and-air-gap-force|Magnetic Field Energy and Air-Gap Force]]
- [[air-core-toroid-circuit-calculation|Air-Core Toroid Circuit Calculation]]

## Concept Dependencies

- applies-to: [[magnetic-circuit-analogy-and-reluctance|Magnetic Circuit Analogy and Reluctance]]
- depends-on: [[ferromagnetic-magnetization-and-hysteresis|Ferromagnetic Magnetization and Hysteresis]]
- contrasts-with: [[air-core-toroid-circuit-calculation|Air-Core Toroid Circuit Calculation]]
