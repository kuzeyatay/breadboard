---
title: "1.106 Finite Straight Current Filaments and Superposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 200", "Page 201", "Page 202", "Equation 7.9", "Example 7.1", "Figure S1.P200.F1", "Figure S1.P201.F1", "Exercises D7.1-D7.2"]
related: ["magnetic-field-infinite-straight-current-filament", "differential-biot-savart-law", "current-source-representations"]
---

# 1.106 Finite Straight Current Filaments and Superposition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 200, Page 201, Page 202, Equation 7.9, Example 7.1, Figure S1.P200.F1, Figure S1.P201.F1, Exercises D7.1-D7.2

For a finite straight current filament, the magnetic field at a point a perpendicular distance $\rho$ from the filament is conveniently expressed using endpoint angles $\alpha_1$ and $\alpha_2$:
$$
\mathbf{H}=\frac{I}{4\pi\rho}(\sin\alpha_2-\sin\alpha_1)\mathbf{a}_\phi
$$
Angles associated with endpoints below the field point are negative according to the geometry used in the text. This result supports piecewise analysis of conductors composed of multiple straight segments. Example 7.1 applies it to an 8 A current that travels inward along the positive $x$ axis to the origin and then outward along the positive $y$ axis. At $P_2(0.4,0.3,0)$, the semi-infinite $x$ segment contributes $-(12/\pi)\mathbf{a}_z$ A/m, while the $y$ segment contributes $-(8/\pi)\mathbf{a}_z$ A/m. Vector superposition gives $\mathbf{H}_2=-(20/\pi)\mathbf{a}_z=-6.37\mathbf{a}_z$ A/m. Correctly translating each local azimuthal direction into a common coordinate basis is essential.

## Page-Grounded Details

#### Page 200

has been adjusted so that the addition of this second set of lines will produce an array of curvilinear squares.

A comparison of Figure 7.4 with the map of the $electric$ field about an infinite line $charge$ shows that the streamlines of the magnetic field correspond exactly to the equipotentials of the electric field, and the unnamed (and undrawn) perpendicular family of lines in the magnetic field corresponds to the streamlines of the electric field. This correspondence is not an accident, but there are several other concepts which must be mastered before the analogy between electric and magnetic fields can be explored more thoroughly.

Using the Biot-Savart law to find $\mathbf{H}$ is in many respects similar to the use of Coulomb's law to find $\mathbf{E}$. Each requires the determination of a moderately complicated integrand containing vector quantities, followed by an integration. When we were concerned with Coulomb's law we solved a number of examples, including the fields of the point charge, line charge, and sheet of charge. The law of Biot-Savart can be used to solve analogous problems in magnetic fields, and some of these problems appear as exercises at the end

[Truncated for analysis]

#### Page 201

Equation (9) may be used to find the magnetic field intensity caused by current filaments arranged as a sequence of straight-line segments.

#### EXAMPLE 7.1

As a numerical example illustrating the use of (9), we determine $\mathbf{H}$ at $P_{2}(0.4,0.3,0)$ in the field of an 8-ampere filamentary current. The current is directed inward from infinity to the origin on the positive $x$ axis, and then outward to infinity along the $y$ axis. This arrangement is shown in Figure 7.6.

**Solution.** We first consider the semi-infinite current on the $x$ axis, identifying the two angles, $\alpha_{1x}=-90^{\circ}$ and $\alpha_{2x}=\tan^{-1}(0.4/0.3)=53.1^{\circ}$. The radial distance $\rho$ is measured from the $x$ axis, and we have $\rho_{x}=0.3$. Thus, this contribution to $\mathbf{H}_{2}$ is
$$
\mathbf{H}_{2(x)}=\frac{8}{4\pi(0.3)}(\sin 53.1^{\circ}+1)\mathbf{a}_{\phi}=\frac{2}{0.3\pi}(1.8)\mathbf{a}_{\phi}=\frac{12}{\pi}\mathbf{a}_{\phi}
$$
The unit vector $\mathbf{a}_{\phi}$ must also be referred to the $x$ axis. We see that it becomes $-\mathbf{a}_{z}$. Therefore,
$$
\mathbf{H}_{2(x)}=-\frac{12}{\pi}\mathbf{a}_{z}~{}\mathrm{A/m}
$$
For the current on th

[Truncated for analysis]

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

## Core Ideas

- Finite-filament fields depend on the perpendicular distance and endpoint angles.
- The formula is $\mathbf{H}=I(\sin\alpha_2-\sin\alpha_1)\mathbf{a}_\phi/(4\pi\rho)$.
- Endpoint angles may be negative when endpoints lie below the field point.
- A segmented conductor is handled by calculating each segment field separately.
- Each segment's local $\mathbf{a}_\phi$ must be converted to a common vector basis.
- The total field is the vector sum of segment contributions.
- Example 7.1 produces $-6.37\mathbf{a}_z$ A/m at the specified point.

## Source Anchors

- Figure S1.P200.F1 defines $\rho$, $\alpha_1$, and $\alpha_2$ for a finite filament.
- Page 200 gives $\mathbf{H}=I(\sin\alpha_2-\sin\alpha_1)\mathbf{a}_\phi/(4\pi\rho)$.
- Page 201 sets $\alpha_{1x}=-90^\circ$, $\alpha_{2x}=53.1^\circ$, and $\rho_x=0.3$ for the first segment.
- Page 201 converts the first local azimuthal direction to $-\mathbf{a}_z$.
- Page 201 calculates the second contribution as $-(8/\pi)\mathbf{a}_z$ A/m.
- Figure S1.P201.F1 shows the two semi-infinite segments and their superposed fields.
- Page 202 exercises D7.1 and D7.2 test differential-element evaluation and rectangular-coordinate expressions for an infinite filament.

## Related Pages

- [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]
- [[differential-biot-savart-law|Differential Biot-Savart Law]]
- [[current-source-representations|Current Source Representations]]

## Concept Dependencies

- derives-from: [[differential-biot-savart-law|Differential Biot-Savart Law]]
- related: [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]
