---
title: "1.157 Maxwell-Equation Application Problems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 312", "Page 313", "Page 314", "Section: Chapter 9 Problems 9.10 through 9.22"]
related: ["electromagnetic-boundary-conditions", "electromagnetic-induction-problem-methods", "potential-and-duality-problems", "general-transmission-line-wave-equations"]
---

# 1.157 Maxwell-Equation Application Problems

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 312, Page 313, Page 314, Section: Chapter 9 Problems 9.10 through 9.22

A second group of chapter problems develops procedures for using Maxwell's point-form equations as a mutually constrained system rather than as isolated formulas. The tasks compare conduction current density $\mathbf{J}_c=\sigma\mathbf{E}$ with displacement current density $\mathbf{J}_d=\partial\mathbf{D}/\partial t$, calculate total currents through capacitor geometries, infer missing fields from curl equations, and enforce consistency between spatial and temporal field variation. Other problems derive the continuity equation, test whether proposed electric and magnetic fields satisfy both curl equations, and obtain source-free wave equations. The recurring method is to identify the applicable constitutive relations, evaluate the required divergence or curl in the stated coordinate system, and then use the remaining Maxwell equations to constrain unknown components or propagation constants.

## Page-Grounded Details

#### Page 312

Figure 9.6 See Problem 9.7.

9.7

The rails in Figure 9.6 each have a resistance of 2.2 $\Omega$/m. The bar moves to the right at a constant speed of 9 m/s in a uniform magnetic field of 0.8 T. Find $I(t)$, $0<t<1$ s, if the bar is at x = 2 m at t = 0 and (a) a 0.3 $\Omega$ resistor is present across the left end with the right end open-circuited; (b) a 0.3 $\Omega$ resistor is present across each end.

9.8

A perfectly conducting filament is formed into a circular ring of radius a. At one point, a resistance R is inserted into the circuit, and at another a battery of voltage $V_{0}$ is inserted. Assume that the loop current itself produces negligible magnetic field. (a) Apply Faraday's law, Eq. (4), evaluating each side of the equation carefully and independently to show the equality; (b) repeat part a, assuming the battery is removed, the ring is closed again, and a linearly increasing B field is applied in a direction normal to the loop surface.

9.9

A square filamentary loop of wire is 25 cm on a side and has a resistance of 125 $\Omega$ per meter length. The loop lies in the z = 0 plane with its corners at (0, 0, 0), (0.25, 0, 0), (0.25, 0.25, 0), and (0, 0.25,

[Truncated for analysis]

#### Page 313

total conduction current $I_{c}$ through the capacitor; (c) the total displacement current $I_{d}$ through the capacitor; (d) the ratio of the amplitude of $I_{d}$ to that of $I_{c}$, the quality factor of the capacitor.

9.12 The magnetic flux density $B = B_{0}\cos(\omega t)\cos(k_{0}z)\mathbf{a}_{y}$ Wb/m^2 exists in free space. $B_{0}$ and $k_{0}$ are constants. Find (a) the displacement current density; (b) the electric field intensity; (c) $k_{0}$.

9.13 In free space it is known that $E = E_{0}/r\sin\theta\cos(\omega t - k_{0}r)\mathbf{a}_{\theta}=E_{\theta}\,\mathbf{a}_{\theta}$. Show that a component of $\mathbf{H}$ in the $\mathbf{a}_{\varphi}$ direction arises, where $H_{\varphi}=E_{\theta}\,(\epsilon_{0}/\mu_{0})^{1/2}$. Do this by applying Eqs. (20) and (21) and requiring consistency.

9.14 A voltage source $V_{0}\sin\omega t$ is connected between two concentric conducting spheres, $r = a$ and $r = b$, $b > a$, where the region between them is a material for which $\epsilon = \epsilon_{r}\epsilon_{0}$, $\mu = \mu_{0}$, and $\sigma = 0$. Find the total displacement current through the dielectric and compare it with the source curren

[Truncated for analysis]

#### Page 314

$\underline{9.19}$ In Section 9.1, Faraday's law was used to show that the field $\mathbf{E}=-\frac{1}{2} kB_{0}e^{kt}$ $\rho\mathbf{a}_{\phi}$ results from the changing magnetic field $\mathbf{B}=B_{0}e^{kt}\mathbf{a}_{z}$. (a) Show that these fields do not satisfy Maxwell's other curl equation. (b) If we let $B_{0}=1\$ T and $k=10^{6}\,s^{-1}$, we are establishing a fairly large magnetic flux density in $1\,\mu$ s. Use the $\nabla\times\mathbf{H}$ equation to show that the rate at which $B_{z}$ should (but does not) change with $\rho$ is only about $5\times 10^{-6}\$ T per meter in free space at $t=0$.

$\underline{9.20}$ Given Maxwell's equations in point form, assume that all fields vary as $e^{st}$ and write the equations without explicitly involving time.

$\underline{9.21}$ (a) Show that under static field conditions, Eq. (55) reduces to Ampère's circuital law. (b) Verify that Eq. (51) becomes Faraday's law when we take the curl.

$\underline{9.22}$ In a sourceless medium in which $\mathbf{J}=0$ and $\rho_{v}=0$, assume a rectangular coordinate system in which $\mathbf{E}$ and $\mathbf{H}$ are functions only of $z$ and $t$. The m

[Truncated for analysis]

## Core Ideas

- Compare conduction and displacement currents through their constitutive definitions.
- Use both curl equations to test whether proposed fields are self-consistent.
- Derive the continuity equation from Maxwell's equations.
- Infer spatial constants by requiring all Maxwell equations to hold.
- Integrate current density over the appropriate surface to obtain total current.

## Source Anchors

- Problems 9.10 and 9.11 on Pages 312 and 313 compare conduction and displacement currents and define a capacitor quality-factor ratio.
- Problems 9.12 through 9.18 on Page 313 infer fields, propagation constants, continuity, and displacement current from Maxwell's equations.
- Figure 9.7 on Page 313 provides the parallel-plate transmission-line geometry used in Problem 9.18.
- Problem 9.19 on Page 314 tests a Faraday-law field pair against Ampère's curl equation.
- Problem 9.22 on Page 314 derives a source-free second-order wave equation and its sinusoidal solution.

## Related Pages

- [[electromagnetic-boundary-conditions|Electromagnetic Boundary Conditions]]
- [[electromagnetic-induction-problem-methods|Electromagnetic Induction Problem Methods]]
- [[potential-and-duality-problems|Potential and Duality Problems]]
- [[general-transmission-line-wave-equations|General Transmission-Line Wave Equations]]

## Concept Dependencies

- applies-to: [[electromagnetic-boundary-conditions|Electromagnetic Boundary Conditions]]
- related: [[electromagnetic-induction-problem-methods|Electromagnetic Induction Problem Methods]]
- related: [[general-transmission-line-wave-equations|General Transmission-Line Wave Equations]]
