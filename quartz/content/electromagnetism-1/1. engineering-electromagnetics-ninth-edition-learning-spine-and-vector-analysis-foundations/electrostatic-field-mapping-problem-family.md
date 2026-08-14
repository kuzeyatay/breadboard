---
title: "1.99 Electrostatic Field-Mapping Problem Family"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 189", "Page 190", "Page 192"]
related: ["curvilinear-square-field-map-construction", "capacitance-estimation-from-a-flux-plot", "practical-field-map-refinement-procedure", "cylindrical-one-dimensional-potential-solutions"]
---

# 1.99 Electrostatic Field-Mapping Problem Family

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 189, Page 190, Page 192

A group of end-of-chapter tasks applies curvilinear-square mapping to conductor geometries that do not have simple one-dimensional analytic solutions. The required procedure is to draw the conductor boundaries accurately, use symmetry where available, construct orthogonal equipotential and flux-line families, and estimate capacitance from the ratio $N_Q/N_V$. Exact formulas or known solutions are then used as checks where available. Geometries include coaxial cylinders, parallel circular cylinders, eccentric cylinders, a circular conductor inside a rectangular conductor, and displaced square conductors. The tasks test whether a map preserves boundary normality, orthogonality, and reasonable curvilinear-square proportions in crowded and weak-field regions. They also reinforce scale invariance: changing all transverse dimensions by the same factor does not necessarily change capacitance per unit length for a fixed two-dimensional shape and homogeneous material. Source figures provide boundary geometry for the displaced square transmission line and the radial-plane capacitor problem.

## Page-Grounded Details

#### Page 189

6.15

A 2-cm-diameter conductor is suspended in air with its axis 5 cm from a conducting plane. Let the potential of the cylinder be 100 V and that of the plane be 0 V. (a) Find the surface charge density on the cylinder at a point nearest the plane. (b) Find the surface charge density on the plane at a point nearest the cylinder. (c) Find the capacitance per unit length.

6.16

Consider an arrangement of two isolated conducting surfaces of any shape that form a capacitor. Use the definitions of capacitance (Eq. (2) in this chapter) and resistance (Eq. (14) in Chapter 5) to show that when the region between the conductors is filled with either conductive material (conductivity $\sigma$) or a perfect dielectric (permittivity $\epsilon$), the resulting resistance and capacitance of the structures are related through the simple formula $RC=\epsilon/\sigma$. What basic properties must be true about both the dielectric and the conducting medium for this condition to hold for certain?

6.17

Construct a curvilinear-square map for a coaxial capacitor of 3 cm inner radius and 8 cm outer radius. These dimensions are suitable for the drawing. (a) Use your sketch to calculate the capaci

[Truncated for analysis]

#### Page 190

Figure 6.13 See Problem 6.21.

6.22 $\hookrightarrow$ A parallel-plate capacitor is air filled and has plate area A and plate separation d. Sufficient dielectric material of relative permittivity $\epsilon_{r}$ is available to fill half the capacitor volume. How should the material be used to maximize the capacitance, and by what factor will the capacitance increase over the air-filled case?

6.23 $\hookrightarrow$ A two-wire transmission line consists of two parallel perfectly conducting cylinders, each having a radius of 0.2 mm, separated by a center-to-center distance of 2 mm. The medium surrounding the wires has $\epsilon_{r}=3$ and $\sigma=1.5$ mS/m. A 100-V battery is connected between the wires. (a) Calculate the magnitude of the charge per meter length on each wire. (b) Using the result of Problem 6.16, find the battery current.

6.24 $\hookrightarrow$ A potential field in free space is given in spherical coordinates as
$$
V(r)=\begin{cases}[\rho_{0}/(6\epsilon_{0})][3a^{2}-r^{2}]&(r\leq a)\\(a^{3}\rho_{0})/(3\epsilon_{0}r)&(r\geq a)\end{cases}
$$
where $\rho_{0}$ and a are constants. (a) Use Poisson's equation to find the volume charge density everywhere. (

[Truncated for analysis]

#### Page 192

solving Laplace's and Poisson's equations, find (a) $V(z)$ for $0 < z < d$; (b) the electric field intensity for $0 < z < d$. No surface charge exists at $z = b$, so both $V$ and $\mathbf{D}$ are continuous there.

6.35 In spherical coordinates, a potential is known to be a function of $\theta$ only. (a) Find the function $V(\theta)$ if $V = 10\ V$ at $\theta = 90^{\circ}$ and $\mathbf{E} = -500\ \mathbf{a}_{\theta}\ V/m$ at $\theta = 30^{\circ}$, $r = 0.4\ m$; (b) find the electric field intensity in rectangular coordinates at $\theta = 90^{\circ}$, $r = 1\ m$.

6.36 The derivation of Laplace's and Poisson's equations assumed constant permittivity, but there are cases of spatially varying permittivity in which the equations will still apply. Consider the vector identity, $\nabla\cdot(\psi\mathbf{G})=\mathbf{G}\cdot\nabla\psi+\psi\nabla\cdot\mathbf{G}$, where $\psi$ and $\mathbf{G}$ are scalar and vector functions, respectively. Determine a general rule on the allowed directions in which $\epsilon$ may vary with respect to the local electric field.

6.37 Coaxial conducting cylinders are located at $\rho = 0.5\ cm$ and $\rho = 1.2\ cm$. The

[Truncated for analysis]

## Core Ideas

- Accurate conductor boundaries are established before field lines are drawn.
- Symmetry can reduce the required drawing area.
- Flux lines meet conductor surfaces normally.
- Capacitance is estimated by counting flux tubes and voltage intervals.
- Analytic formulas are used to check graphical estimates.
- Eccentric and polygonal geometries require iterative map refinement.
- Uniform geometric scaling can be tested through capacitance-per-length comparisons.

## Source Anchors

- Problem 6.17 requests mapped and exact capacitance values for a coaxial capacitor.
- Problem 6.18 requests a map for two equal parallel circular cylinders.
- Problem 6.19 supplies
$$
C=\frac{2\pi\epsilon}{\cosh^{-1}[(a^2+b^2-D^2)/(2ab)]}
$$
 for eccentric circular conductors.
- Problem 6.20 maps a circular conductor inside a rectangular conductor.
- S1.P190.F1, Figure 6.13 defines displaced square inner and outer conductors for Problem 6.21.
- Problem 6.21 asks how changing $a$ affects the mapped capacitance per meter.
- S1.P192.F1, Figure 6.14 defines radial conducting planes for Problem 6.39.

## Related Pages

- [[curvilinear-square-field-map-construction|Curvilinear-Square Field Map Construction]]
- [[capacitance-estimation-from-a-flux-plot|Capacitance Estimation from a Flux Plot]]
- [[practical-field-map-refinement-procedure|Practical Field-Map Refinement Procedure]]
- [[cylindrical-one-dimensional-potential-solutions|Cylindrical One-Dimensional Potential Solutions]]

## Concept Dependencies

- applies-to: [[practical-field-map-refinement-procedure|Practical Field-Map Refinement Procedure]]
- applies-to: [[capacitance-estimation-from-a-flux-plot|Capacitance Estimation from a Flux Plot]]
- depends-on: [[curvilinear-square-field-map-construction|Curvilinear-Square Field Map Construction]]
