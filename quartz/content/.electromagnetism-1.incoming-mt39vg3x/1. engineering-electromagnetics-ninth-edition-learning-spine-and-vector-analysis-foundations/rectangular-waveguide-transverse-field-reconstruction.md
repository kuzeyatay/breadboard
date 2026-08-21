---
title: "1.281 Rectangular Waveguide Transverse Field Reconstruction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 495, Section 13.5.1 and Equations (76) through (78)", "Page 496, Equations (79) through (81)"]
related: ["rectangular-waveguide-geometry-and-absence-of-tem", "rectangular-waveguide-tm-eigenmodes", "rectangular-waveguide-te-eigenmodes", "rectangular-waveguide-cutoff-condition"]
---

# 1.281 Rectangular Waveguide Transverse Field Reconstruction

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 495, Section 13.5.1 and Equations (76) through (78), Page 496, Equations (79) through (81)

The standard rectangular-waveguide method solves first for a longitudinal field component and then reconstructs all transverse components using Maxwell's equations. For TE modes, $E_z=0$, so the wave equation is solved for $H_z$. For TM modes, $H_z=0$, so it is solved for $E_z$. Forward propagation is assumed through factors $e^{-j\beta z}$, making $\partial/\partial z=-j\beta$. Combining the transverse components of the two curl equations expresses $E_x$, $E_y$, $H_x$, and $H_y$ in terms of derivatives of $E_z$ and $H_z$. The common transverse constant is
$$
\kappa=\sqrt{k^2-\beta^2}
$$
 Because rectangular modes vary along both $x$ and $y$, two indices are required and
$$
\kappa_{mp}=\sqrt{k^2-\beta_{mp}^2}
$$
 The indices $m$ and $p$ describe transverse field variations in the $x$ and $y$ directions. Geometrically, $\kappa_{mp}$ is the transverse-plane component of the full wavevector, while $\beta_{mp}$ is its axial component.

## Page-Grounded Details

#### Page 495

parallel-plate guides of orthogonal orientation that are assembled to form one unit. We have a pair of horizontal conducting walls (along the x direction) and a pair of vertical walls (along y), all of which form one continuous boundary. The wave equation in its full three-dimensional form [Eq. (59)] must now be solved, for in general we may have field variations in all three coordinate directions.

In the parallel-plate guide, we found that the TEM mode can exist, along with TE and TM modes. The rectangular guide will support the TE and TM modes, but it will not support a TEM mode. This is because, in contrast to the parallel-plate guide, we now have a conducting boundary that completely surrounds the transverse plane. The nonexistence of TEM can be understood by remembering that any electric field must have a zero tangential component at the boundary. This means that it is impossible to set up an electric field that will not exhibit the sideways variation that is necessary to satisfy this boundary condition. Because E varies in the transverse plane, the computation of H through $\nabla\times E = -j\omega\mu H$ must lead to a z component of H, and so we cannot have a TEM mode. W

[Truncated for analysis]

#### Page 496

of E and H. For example, (77a) and (78b) can be combined, eliminating $E_{ys}$, to give
$$
H_{xs}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial H_{zs}}{\partial x}-\omega c\frac{\partial\,E_{zs}}{\partial y}]\quad{(79a)}
$$
Then, using (76b) and (77a), eliminate $E_{xs}$ between them to obtain
$$
H_{ys}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial H_{zs}}{\partial y}+\omega c\frac{\partial E_{zs}}{\partial x}]\quad{(79b)}
$$
Using the same equation pairs, the transverse electric field components are then found:
$$
E_{xs}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial E_{zs}}{\partial x}+\omega\mu\frac{\partial H_{zs}}{\partial y}]\quad{(79c)}
$$
$$
E_{ys}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial E_{zs}}{\partial y}-\omega\mu\frac{\partial H_{zs}}{\partial x}]\quad{(79d)}
$$
$\kappa$ is defined in the same manner as in the parallel-plate guide [Eq. (35)]:
$$
\kappa=\sqrt{k^{2}-\beta^{2}}\quad{(80)}
$$
where $k=\omega\sqrt{\mu\epsilon}$. In the parallel-plate geometry, we found that discrete values of $\kappa$ and $\beta$ resulted from the analysis, which we then subscripted with the integer mode number, $m$ ($\kappa_{m}$ and $\beta_{m}$). The interpretation of $m$

[Truncated for analysis]

## Core Ideas

- Solve for $H_z$ in a TE mode because $E_z=0$.
- Solve for $E_z$ in a TM mode because $H_z=0$.
- Forward propagation gives the common factor $e^{-j\beta z}$.
- The derivative rule is $\partial/\partial z=-j\beta$.
- Maxwell's curl equations recover all four transverse field components.
- The transverse constant satisfies $\kappa^2=k^2-\beta^2$.
- Rectangular modes require two indices, $m$ and $p$.
- $\kappa_{mp}$ and $\beta_{mp}$ are transverse and axial wavevector components.

## Source Anchors

- Equations (76a) and (76b) define forward-$z$ electric and magnetic phasors.
- Equations (77) and (78) give the transverse components of Maxwell's curl equations.
- Equations (79a) through (79d) express transverse fields through derivatives of $E_z$ and $H_z$.
- Equation (80) defines $\kappa=\sqrt{k^2-\beta^2}$.
- Equation (81) introduces the two-index constants $\kappa_{mp}$ and $\beta_{mp}$.
- The source interprets $m$ and $p$ as field variations along $x$ and $y$.

## Related Pages

- [[rectangular-waveguide-geometry-and-absence-of-tem|Rectangular Waveguide Geometry and Absence of TEM]]
- [[rectangular-waveguide-tm-eigenmodes|Rectangular Waveguide TM Eigenmodes]]
- [[rectangular-waveguide-te-eigenmodes|Rectangular Waveguide TE Eigenmodes]]
- [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]

## Concept Dependencies

- enables: [[rectangular-waveguide-tm-eigenmodes|Rectangular Waveguide TM Eigenmodes]]
- enables: [[rectangular-waveguide-te-eigenmodes|Rectangular Waveguide TE Eigenmodes]]
- enables: [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]
