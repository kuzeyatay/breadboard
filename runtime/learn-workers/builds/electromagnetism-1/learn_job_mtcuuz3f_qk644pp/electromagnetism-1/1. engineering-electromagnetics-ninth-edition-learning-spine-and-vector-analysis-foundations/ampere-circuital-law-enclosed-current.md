---
title: "1.107 Ampere's Circuital Law and Enclosed Current"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 202", "Page 203", "Section 7.2: Ampere's Circuital Law", "Section 7.2.1: Definition of Ampere's Law", "Figure S1.P203.F1"]
related: ["integral-biot-savart-law-closed-steady-currents", "ampere-circuital-law-applied-filament", "magnetic-field-within-coaxial-cable", "curl-circulation-per-unit-area"]
---

# 1.107 Ampere's Circuital Law and Enclosed Current

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 202, Page 203, Section 7.2: Ampere's Circuital Law, Section 7.2.1: Definition of Ampere's Law, Figure S1.P203.F1

Ampere's circuital law states that the circulation of magnetic field intensity around any closed path equals the algebraic direct current enclosed by that path:
$$
\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}
$$
Positive current is defined by the right-hand relationship between the traversal direction and the surface normal. The enclosed current is not determined merely by whether a wire appears geometrically near the path. A closed path bounds many possible open surfaces, and the enclosed current is the algebraic current piercing any such surface. If a conductor passes through a surface once in each direction, the two contributions cancel. Different closed paths enclosing the same current can have different point-by-point integrands but the same final circulation. The law is analogous to Gauss's law: Gauss's law relates flux through a closed surface to enclosed charge, while Ampere's law relates circulation around a closed path to current piercing a bounded surface.

## Page-Grounded Details

#### Page 202

D7.1. Given the following values for $P_{1}$, $P_{2}$, and $I_{1}\Delta L_{1}$, calculate $\Delta H_{2}$:

(a) $P_{1}(0, 0, 2)$, $P_{2}(4, 2, 0)$, $2\pi a_{z}\mu A\cdot m$; (b) $P_{1}(0, 2, 0)$, $P_{2}(4, 2, 3)$, $2\pi a_{z}\mu A\cdot m$;

(c) $P_{1}(1, 2, 3)$, $P_{2}(-3, -1, 2)$, $2\pi(-a_{x}+a_{y}+2a_{z})\mu A\cdot m$.

Ans. (a) $-8.51a_{x}+17.01a_{y}$ nA/m; (b) $16a_{y}$ nA/m; (c) $18.9a_{x}-33.9a_{y}+26.4a_{z}$ nA/m

D7.2. A current filament carrying 15 A in the $a_{z}$ direction lies along the entire z axis. Find H in rectangular coordinates at: (a) $P_{A}(\sqrt{20}, 0, 4)$; (b) $P_{B}(2, -4, 4)$.

Ans. (a) $0.534a_{y}$ A/m; (b) $0.477a_{x}+0.239a_{y}$ A/m

#### 7.2 AMPÈRE'S CIRCUITAL LAW

After solving a number of simple electrostatic problems with Coulomb's law, we found that the same problems could be solved much more easily by using Gauss's law whenever a high degree of symmetry was present. Again, an analogous procedure exists in magnetic fields. Here, the law that helps us solve problems more easily is known as $Ampère'scircuital^{4}law$, sometimes called Ampère's work law. This law may be derived from the Biot-Savart law (see

[Truncated for analysis]

#### Page 203

Figure 7.7 A conductor has a total current $l$. The line integral of $\mathbf{H}$ about the closed paths $a$ and $b$ is equal to $l$, and the integral around path $c$ is less than $l$, since the entire current is not enclosed by the path.

We should also consider exactly what is meant by the expression "current enclosed by the path." Suppose we solder a circuit together after passing the conductor once through a rubber band, which we use to represent the closed path. Some strange and formidable paths can be constructed by twisting and knotting the rubber band, but if neither the rubber band nor the conducting circuit is broken, the current enclosed by the path is that carried by the conductor. Now replace the rubber band with a circular ring of spring steel across which is stretched a rubber sheet. The steel loop forms the closed path, and the current-carrying conductor must pierce the rubber sheet if the current is to be enclosed by the path. Again, we may twist the steel loop, and we may also deform the rubber sheet by pushing our fist into it or folding it in any way we wish. A single current-carrying conductor still pierces the sheet once, and this is the true mea

[Truncated for analysis]

## Core Ideas

- Ampere's law is $\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}$.
- Path orientation and positive current direction are linked by the right-hand rule.
- Current enclosed means algebraic current piercing a surface bounded by the path.
- The same boundary admits many surfaces, but each yields the same net piercing current.
- Oppositely directed crossings cancel algebraically.
- Different paths can produce different local integrands while giving the same total circulation.
- Ampere's law is especially efficient when the source has high symmetry.

## Source Anchors

- Page 202 introduces Ampere's circuital law as the magnetic analogue of using Gauss's law for symmetric electrostatic problems.
- Page 202 gives $\oint\mathbf{H}\cdot d\mathbf{L}=I$.
- Figure S1.P203.F1 shows paths $a$ and $b$ enclosing the total current and path $c$ enclosing only part of it.
- Page 203 uses a deformable loop and spanning sheet to explain current enclosed by a path.
- Page 203 states that opposite-direction surface crossings contribute an algebraic total of zero.
- Page 203 contrasts charge enclosed by a closed surface with current enclosed by a closed path.

## Related Pages

- [[integral-biot-savart-law-closed-steady-currents|Integral Biot-Savart Law and Closed Steady Currents]]
- [[ampere-circuital-law-applied-filament|Ampere's Circuital Law Applied to a Filament]]
- [[magnetic-field-within-coaxial-cable|Magnetic Field Within a Coaxial Cable]]
- [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]

## Concept Dependencies

- derives-from: [[integral-biot-savart-law-closed-steady-currents|Integral Biot-Savart Law and Closed Steady Currents]]
