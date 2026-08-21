---
title: "1.124 Magnetic Circuit Analogy and Reluctance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 269", "Page 270", "Page 271", "Section 8.8"]
related: ["linear-magnetic-constitive-relations", "air-core-toroid-circuit-calculation", "ferromagnetic-magnetization-and-hysteresis", "nonlinear-gapped-magnetic-circuit-analysis", "linear-magnetic-constitutive-relations"]
---

# 1.124 Magnetic Circuit Analogy and Reluctance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 269, Page 270, Page 271, Section 8.8

A magnetic circuit provides a lumped approximation analogous to a dc resistive circuit. Electric potential and magnetic scalar potential satisfy parallel gradient relations, $\mathbf{E}=-\nabla V$ and $\mathbf{H}=-\nabla V_m$. In this context $V_m$ is called magnetomotive force, or mmf, and is measured in amperes or ampere-turns. The constitutive analog of $\mathbf{J}=\sigma\mathbf{E}$ is $\mathbf{B}=\mu\mathbf{H}$, while current $I=\int_S\mathbf{J}\cdot d\mathbf{S}$ corresponds to magnetic flux $\Phi=\int_S\mathbf{B}\cdot d\mathbf{S}$. Resistance satisfies $V=IR$, and reluctance satisfies $V_m=\Phi\mathcal{R}$. For a uniform linear material of length $d$ and area $S$, $R=d/(\sigma S)$ and $\mathcal{R}=d/(\mu S)$. A coil linking the magnetic path supplies the source mmf, with $\oint\mathbf{H}\cdot d\mathbf{L}=NI$. Unlike a voltage source inserted between two circuit terminals, the coil surrounds or links the magnetic circuit. The analogy is exact enough to organize calculations, but ferromagnetic nonlinearity, leakage, and fringing limit the simple lumped model.

## Page-Grounded Details

#### Page 269

D8.8. Let the permittivity be 5 $\mu H/m$ in region A where $x<0$, and 20 $\mu H/m$ in region B where $x>0$. If there is a surface current density $\mathbf{K}=150\mathbf{a}_{y}-200\mathbf{a}_{z}$ A/m at $x=0$, and if $H_{A}=300\mathbf{a}_{x}-400\mathbf{a}_{y}+500\mathbf{a}_{z}$ A/m, find: (a) $|\mathbf{H}_{tA}|$; (b) $|\mathbf{H}_{NA}|$; (c) $|\mathbf{H}_{tB}|$; (d) $|\mathbf{H}_{NB}|$.

Answer: (a) 640 A/m; (b) 300 A/m; (c) 695 A/m; (d) 75 A/m

#### 8.8 THE MAGNETIC CIRCUIT

In this section, we digress briefly to discuss the fundamental techniques involved in solving a class of magnetic problems known as magnetic circuits. As we will see shortly, the name arises from the great similarity to the dc-resistive-circuit analysis with which it is assumed we are all familiar. The only important difference lies in the non-linear nature of the ferromagnetic portions of the magnetic circuit; the methods which must be adopted are similar to those required in nonlinear electric circuits which contain diodes, thermistors, incandescent filaments, and other nonlinear elements.

As a convenient starting point, we identify those field equations on which resistive circuit anal

[Truncated for analysis]

#### Page 270

Ohm's law for the electric circuit has the point form
$$
J=\sigma E\quad{(40a)}
$$
and we see that the magnetic flux density will be the analog of the current density,
$$
B=\mu H\quad{(40b)}
$$
To find the total current, we must integrate:
$$
I=\int_{S}J\cdot dS\quad{(41a)}
$$
A corresponding operation is necessary to determine the total magnetic flux flowing through the cross section of a magnetic circuit:
$$
\Phi=\int_{S} B\cdot dS\quad{(41b)}
$$
We then defined resistance as the ratio of potential difference and current, or
$$
V=IR\quad{(42a)}
$$
and we shall now define reluctance as the ratio of the magnetomotive force to the total flux; thus
$$
V_{m}=\Phi R\quad{(42b)}
$$
where reluctance is measured in ampere-turns per weber (A*t/Wb). In resistors that are made of a linear isotropic homogeneous material of conductivity $\sigma$ and have a uniform cross section of area S and length d, the total resistance is
$$
R=\frac{d}{\sigma S}\quad{(43a)}
$$
If we are fortunate enough to have such a linear isotropic homogeneous magnetic material of length d and uniform cross section S, then the total reluctance is
$$
R=\frac{d}{\mu S}\quad{(43b)}
$$
The only such materia

[Truncated for analysis]

#### Page 271

for the closed line integral is not zero. Because the total current linked by the path is usually obtained by allowing a current $I$ to flow through an $N$-turn coil, we may express this result as
$$
\oint\mathbf{H}\cdot d\mathbf{L}=N\mathbf{I}\qquad(44)
$$
In an electric circuit, the voltage source is a part of the closed path; in the magnetic circuit, the current-carrying coil will surround or link the magnetic circuit. In tracing a magnetic circuit, we will not be able to identify a pair of terminals at which the magnetomotive force is applied. The analogy is closer here to a pair of coupled circuits in which induced voltages exist (and in which we will see in Chapter 9 that the closed line integral of $\mathbf{E}$ is also not zero).

We will try out some of these ideas on a simple magnetic circuit. In order to avoid the complications of ferromagnetic materials at this time, we will assume that we have an air-core toroid with 500 turns, a cross-sectional area of $6\,{\rm cm}^{2}$, a mean radius of 15 cm, and a coil current of 4 A. As we already know, the magnetic field is confined to the interior of the toroid, and if we consider the closed path of our magnetic circuit

[Truncated for analysis]

## Core Ideas

- Magnetomotive force is the magnetic analog of electric potential difference.
- The field-potential relation is $\mathbf{H}=-\nabla V_m$ in current-free regions.
- Magnetic flux is $\Phi=\int_S\mathbf{B}\cdot d\mathbf{S}$.
- Reluctance is defined by $V_m=\Phi\mathcal{R}$.
- Uniform linear sections have $\mathcal{R}=d/(\mu S)$.
- Reluctance is measured in ampere-turns per weber.
- An $N$-turn coil carrying current $I$ supplies mmf $NI$.
- Ferromagnetic sections generally make the circuit nonlinear.

## Source Anchors

- Equations (38a) and (38b) compare $\mathbf{E}=-\nabla V$ with $\mathbf{H}=-\nabla V_m$.
- Equations (40a) and (40b) compare $\mathbf{J}=\sigma\mathbf{E}$ with $\mathbf{B}=\mu\mathbf{H}$.
- Equations (41a) and (41b) compare total current with total magnetic flux.
- Equations (42a) and (42b) compare $V=IR$ with $V_m=\Phi\mathcal{R}$.
- Equation (43b) gives $\mathcal{R}=d/(\mu S)$.
- Equation (44) gives $\oint\mathbf{H}\cdot d\mathbf{L}=NI$.

## Related Pages

- [[air-core-toroid-circuit-calculation|Air-Core Toroid Circuit Calculation]]
- [[ferromagnetic-magnetization-and-hysteresis|Ferromagnetic Magnetization and Hysteresis]]
- [[nonlinear-gapped-magnetic-circuit-analysis|Nonlinear Gapped Magnetic Circuit Analysis]]
- [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]

## Concept Dependencies

- depends-on: [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
