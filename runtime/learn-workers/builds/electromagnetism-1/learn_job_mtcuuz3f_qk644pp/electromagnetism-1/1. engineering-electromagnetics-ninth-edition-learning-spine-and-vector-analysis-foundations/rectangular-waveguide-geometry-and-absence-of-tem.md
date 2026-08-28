---
title: "1.280 Rectangular Waveguide Geometry and Absence of TEM"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 479, Figure 13.7", "Page 494, Section 13.5", "Page 495, rectangular-guide TEM discussion"]
related: ["tem-transmission-line-waves-and-waveguide-modes", "rectangular-waveguide-transverse-field-reconstruction", "rectangular-waveguide-cutoff-condition"]
---

# 1.280 Rectangular Waveguide Geometry and Absence of TEM

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 479, Figure 13.7, Page 494, Section 13.5, Page 495, rectangular-guide TEM discussion

A rectangular waveguide is a hollow conducting structure used primarily at microwave frequencies. Its propagation direction is $z$, its width is $a$ along $x$, and its height is $b$ along $y$. It can be viewed geometrically as two orthogonal parallel-plate guides joined into one continuous conducting enclosure. Unlike the parallel-plate guide, the rectangular guide generally has field variation in both transverse coordinates, so the full three-dimensional wave equation must be used. It supports TE and TM modes but not TEM. The reason is the closed conducting boundary: the tangential electric field must vanish everywhere on all four walls. A completely transverse electric field cannot satisfy these conditions without varying sideways across the transverse plane. Once transverse variation is present, $\nabla\times\mathbf{E}=-j\omega\mu\mathbf{H}$ generates a longitudinal magnetic component, preventing the magnetic field from remaining entirely transverse. No alternative orientation produces both completely transverse electric and magnetic fields in the closed single-conductor guide.

## Page-Grounded Details

#### Page 479

Figure 13.7 Rectangular waveguide.

Figure 13.8 Cylindrical waveguide.

Figure 13.9 Symmetric dielectric slab waveguide, with slab region (refractive index $n_{1}$) surrounded by two dielectrics of index $n_{2}<n_{1}$.

#### Page 494

We solve for $H_{s}$ by dividing both sides of (69) by $-j\omega\mu$. Performing this operation on (70), we obtain the two magnetic field components:
$$
H_{xs}=-\frac{\beta_{m}}{\omega\mu}E_{0}\sin(\kappa_{m}x)e^{-j\beta_{m}z}
$$
(71)
$$
H_{zs}=j\frac{\kappa_{m}}{\omega\mu}E_{0}\cos(\kappa_{m}x)e^{-j\beta_{m}z}
$$
(72)

Together, these two components form closed-loop patterns for $H_{s}$ in the x, z plane, as can be verified using the streamline plotting methods developed in Section 2.6.

It is interesting to consider the magnitude of $H_{s}$, which is found through
$$
|H_{s}|=\sqrt{H_{s}\cdot H_{s}^{*}}=\sqrt{H_{xs}H_{xs}^{*}+H_{zs}H_{zs}^{*}}
$$
(73)

Carrying this out using (71) and (72) results in
$$
|H_{s}|=\frac{E_{0}}{\omega\mu}(\kappa_{m}^{2}+\beta_{m}^{2})^{1/2}(\sin^{2}(\kappa_{m}x)+\cos^{2}(\kappa_{m}x))^{1/2}
$$
(74)

Using the fact that $\kappa_{m}^{2}+\beta_{m}^{2}=k^{2}$ and using the identity $\sin^{2}(\kappa_{m}x)+\cos^{2}(\kappa_{m}x)=1$, (74) becomes
$$
|H_{s}|=\frac{k}{\omega\mu}E_{0}=\frac{\omega\sqrt{\mu\epsilon}}{\omega\mu}=\frac{E_{0}}{\eta}
$$
(75)

where $\eta=\sqrt{\mu/\epsilon}$. This result is consistent with our understanding of

[Truncated for analysis]

#### Page 495

parallel-plate guides of orthogonal orientation that are assembled to form one unit. We have a pair of horizontal conducting walls (along the x direction) and a pair of vertical walls (along y), all of which form one continuous boundary. The wave equation in its full three-dimensional form [Eq. (59)] must now be solved, for in general we may have field variations in all three coordinate directions.

In the parallel-plate guide, we found that the TEM mode can exist, along with TE and TM modes. The rectangular guide will support the TE and TM modes, but it will not support a TEM mode. This is because, in contrast to the parallel-plate guide, we now have a conducting boundary that completely surrounds the transverse plane. The nonexistence of TEM can be understood by remembering that any electric field must have a zero tangential component at the boundary. This means that it is impossible to set up an electric field that will not exhibit the sideways variation that is necessary to satisfy this boundary condition. Because E varies in the transverse plane, the computation of H through $\nabla\times E = -j\omega\mu H$ must lead to a z component of H, and so we cannot have a TEM mode. W

[Truncated for analysis]

## Core Ideas

- The guide dimensions are width $a$ along $x$ and height $b$ along $y$.
- Propagation is along the $z$ axis.
- The boundary is a continuous closed conductor.
- Fields can vary in $x$, $y$, and $z$.
- The guide supports TE and TM mode families.
- The guide cannot support a TEM mode.
- The absence of TEM follows from tangential electric-field boundary conditions and Maxwell's curl equation.

## Source Anchors

- Figure 13.7 shows the rectangular waveguide geometry.
- Page 494 introduces the guide as a microwave structure with dimensions $a$ and $b$.
- Page 495 describes it as two orthogonally oriented parallel-plate guides forming one continuous boundary.
- The source states that the full three-dimensional wave equation is required.
- The source explains that unavoidable transverse electric-field variation produces a longitudinal magnetic-field component.

## Related Pages

- [[tem-transmission-line-waves-and-waveguide-modes|TEM Transmission-Line Waves and Waveguide Modes]]
- [[rectangular-waveguide-transverse-field-reconstruction|Rectangular Waveguide Transverse Field Reconstruction]]
- [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]

## Concept Dependencies

- enables: [[rectangular-waveguide-transverse-field-reconstruction|Rectangular Waveguide Transverse Field Reconstruction]]
- contrasts-with: [[tem-transmission-line-waves-and-waveguide-modes|TEM Transmission-Line Waves and Waveguide Modes]]
