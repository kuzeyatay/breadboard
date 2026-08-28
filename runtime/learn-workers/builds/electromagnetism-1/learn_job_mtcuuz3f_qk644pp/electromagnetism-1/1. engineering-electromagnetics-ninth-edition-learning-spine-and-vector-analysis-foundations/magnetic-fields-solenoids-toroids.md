---
title: "1.111 Magnetic Fields of Solenoids and Toroids"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 207", "Page 208", "Page 209", "Section 7.2.5: Magnetic Fields Within Solenoids and Toroids", "Figure S1.P208.F1", "Figure S1.P209.F1", "Exercise D7.3"]
related: ["ampere-circuital-law-enclosed-current", "magnetic-field-infinite-current-sheet", "magnetic-field-within-coaxial-cable"]
---

# 1.111 Magnetic Fields of Solenoids and Toroids

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 207, Page 208, Page 209, Section 7.2.5: Magnetic Fields Within Solenoids and Toroids, Figure S1.P208.F1, Figure S1.P209.F1, Exercise D7.3

Ampere's circuital law gives compact ideal or approximate fields for solenoids and toroids. An infinitely long solenoid of radius $a$ with surface current $\mathbf{K}=K_a\mathbf{a}_\phi$ has
$$
\mathbf{H}=K_a\mathbf{a}_z\quad(\rho<a),\qquad \mathbf{H}=0\quad(\rho>a)
$$
For a finite, closely wound $N$-turn solenoid of length $d$ carrying current $I$, points well inside have
$$
\mathbf{H}\approx\frac{NI}{d}\mathbf{a}_z
$$
The approximation should not be used close to the open ends or close to the winding surface. For an ideal toroid, the field is azimuthal inside and zero outside. For an $N$-turn filamentary toroid,
$$
\mathbf{H}\approx\frac{NI}{2\pi\rho}\mathbf{a}_\phi
$$
inside, with approximately zero field outside. The toroidal approximation applies away from the winding surface by several turn spacings. These examples show how winding geometry confines or concentrates a magnetic field.

## Page-Grounded Details

#### Page 207

or
$$
H_{x1}-H_{x2}=K_{y}
$$
If the path 3-3'-2'-2-3 is now chosen, the same current is enclosed, and
$$
H_{x3}-H_{x2}=K_{y}
$$
and therefore
$$
H_{x3}=H_{x1}
$$
It follows that $H_{x}$ is the same for all positive $z$. Similarly, $H_{x}$ is the same for all nega-tive $z$. Because of the symmetry, then, the magnetic field intensity on one side of the current sheet is the negative of that on the other. Above the sheet,
$$
H_{x}=\frac{1}{2}K_{y}\quad(z>0)
$$
while below it
$$
H_{x}=-\frac{1}{2}K_{y}\quad(z<0)
$$
Letting $\mathbf{a}_{N}$ be a unit vector normal (outward) to the current sheet, the result may be written in a form correct for all $z$ as
$$
\mathbf{H}=\frac{1}{2}\mathbf{K}\times\mathbf{a}_{N}\quad{(11)}
$$
If a second sheet of current flowing in the opposite direction, $\mathbf{K}=-K_{y}\mathbf{a}_{y}$, is placed at $z=h$, (11) shows that the field in the region between the current sheets is
$$
\mathbf{H}=\mathbf{K}\times\mathbf{a}_{N}\quad(0<z<h)\quad{(12)}
$$
and is zero elsewhere,
$$
\mathbf{H}=0\quad(z<0,z>h)\quad{(13)}
$$
The most difficult part of the application of Ampère's circuital law is the deter-mination of the components of the

[Truncated for analysis]

#### Page 208

Figure 7.11 (a) An ideal solenoid of infinite length with a circular current sheet $\mathbf{K}=K_{o}\mathbf{a}_{\phi}$. (b) An $N$-turn solenoid of finite length $d$.

If the solenoid has a finite length $d$ and consists of $N$ closely wound turns of a filament that carries a current $I$ (Figure 7.11$b$), then the field at points well within the solenoid is given closely by
$$
\mathbf{H}=\frac{NI}{d}\mathbf{a}_{z}\quad{(well within the solenoid)}\quad{(15)}
$$
The approximation is useful if it is not applied closer than two radii to the open ends, nor closer to the solenoid surface than twice the separation between turns.

For the toroids shown in Figure 7.12, it can be shown that the magnetic field intensity for the ideal case, Figure 7.12$a$, is
$$
\mathbf{H}=K_{a}\frac{\rho_{0}-a}{\rho}\mathbf{a}_{\phi}\quad{(inside toroid)}\quad{(16a)}
$$
$$
\mathbf{H}=0\qquad{(outside)}\quad{(16b)}
$$
For the $N$-turn toroid of Figure 7.12$b$, we have the good approximations,
$$
\mathbf{H}=\frac{NI}{2\pi\rho}\;\mathbf{a}_{\phi}\;\quad{(inside toroid)}\quad{(17a)}
$$
$$
\mathbf{H}=0\qquad{(outside)}\quad{(17b)}
$$
as long as we consider points removed from the toroid

[Truncated for analysis]

#### Page 209

Figure 7.12 (a) An ideal toroid carrying a surface current $\mathbf{K}$ in the direction shown. (b) An N-turn toroid carrying a filamentary current I.

D7.3. Express the value of $\mathbf{H}$ in rectangular components at $P(0,0.2,0)$ in the field of: (a) a current filament, 2.5 A in the $\mathbf{a}_{z}$ direction at $x=0.1,y=0.3$; (b) a coax, centered on the z axis, with $a=0.3,b=0.5,c=0.6,I=2.5$ A in the $\mathbf{a}_{z}$ direction in the center conductor; (c) three current sheets, $2.7\mathbf{a}_{x}$ A/m at $y=0.1,-1.4\mathbf{a}_{x}$ A/m at $y=0.15$, and $-1.3\mathbf{a}_{x}$ A/m at $y=0.25$.

Ans. (a) $1.989\mathbf{a}_{x}-1.989\mathbf{a}_{y}$ A/m; (b) $-0.884\mathbf{a}_{x}$ A/m; (c) $1.300\mathbf{a}_{z}$ A/m

#### 7.3 CURL

We completed our study of Gauss's law by applying it to a differential volume element and were led to the concept of divergence. We now apply Ampère's circuital law to the perimeter of a differential surface element and discuss the third and last of the special derivatives of vector analysis, the curl. Our objective is to obtain the point form of Ampère's circuital law.

#### 7.3.1 Development and Definition of Curl

Again we choos

[Truncated for analysis]

## Core Ideas

- An ideal infinite solenoid has a uniform axial field inside and zero field outside.
- The finite-solenoid approximation is $\mathbf{H}\approx(NI/d)\mathbf{a}_z$ well inside.
- Finite-solenoid end and turn-spacing effects limit the approximation.
- A toroid produces an azimuthal field inside its core region.
- The $N$-turn toroid approximation is $\mathbf{H}\approx NI\mathbf{a}_\phi/(2\pi\rho)$.
- Ideal and sufficiently dense toroidal windings have approximately zero external field.

## Source Anchors

- Page 207 gives the ideal-solenoid results $\mathbf{H}=K_a\mathbf{a}_z$ inside and zero outside.
- Figure S1.P208.F1 compares an ideal infinite solenoid with a finite $N$-turn solenoid.
- Page 208 gives $\mathbf{H}=NI\mathbf{a}_z/d$ well within a finite solenoid.
- Page 208 limits that approximation near open ends and near the winding surface.
- Page 208 gives the ideal-toroid field and zero external field.
- Page 208 gives $\mathbf{H}=NI\mathbf{a}_\phi/(2\pi\rho)$ for an $N$-turn toroid.
- Figure S1.P209.F1 compares ideal surface-current and $N$-turn toroids.
- Page 209 exercise D7.3 tests fields from a filament, coaxial cable, and multiple current sheets.

## Related Pages

- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- [[magnetic-field-infinite-current-sheet|Magnetic Field of an Infinite Current Sheet]]
- [[magnetic-field-within-coaxial-cable|Magnetic Field Within a Coaxial Cable]]

## Concept Dependencies

- applies-to: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- depends-on: [[magnetic-field-infinite-current-sheet|Magnetic Field of an Infinite Current Sheet]]
