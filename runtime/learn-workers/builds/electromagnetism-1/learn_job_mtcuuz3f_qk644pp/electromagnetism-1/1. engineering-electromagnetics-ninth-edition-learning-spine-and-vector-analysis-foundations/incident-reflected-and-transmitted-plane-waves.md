---
title: "1.244 Incident, Reflected, and Transmitted Plane Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 421, Chapter 12 introduction and Section 12.1", "Page 422, Figure 12.1 and incident-wave definitions", "Page 423, transmitted and reflected field definitions"]
related: ["boundary-conditions-require-a-reflected-wave", "reflection-and-transmission-coefficients", "power-reflectivity-and-conservation", "multiple-interface-reflection"]
---

# 1.244 Incident, Reflected, and Transmitted Plane Waves

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 421, Chapter 12 introduction and Section 12.1, Page 422, Figure 12.1 and incident-wave definitions, Page 423, transmitted and reflected field definitions

Normal incidence occurs when a plane wave propagates perpendicular to a planar boundary. The text places the boundary at $z=0$, with region 1 occupying $z<0$ and region 2 occupying $z>0$. An $x$-polarized incident wave travels in the positive $z$ direction in region 1, with magnetic field along $y$. A transmitted wave travels away from the boundary in the positive $z$ direction in region 2 and uses that medium's propagation constant $k_2$ and intrinsic impedance $\eta_2$. Figure 12.1 establishes the geometry and shows that all electric and magnetic fields are parallel to the interface. An additional reflected wave travels in the negative $z$ direction in region 1. Its electric phasor varies as $e^{+jk_1z}$, and its magnetic field carries a minus sign relative to $\mathbf{E}/\eta_1$ so that the Poynting vector points in the negative $z$ direction.

## Page-Grounded Details

#### Page 421

### Plane Wave Reflection and Dispersion

In Chapter 11, we learned how to mathematically represent uniform plane waves as functions of frequency, medium properties, and electric field orientation. We also learned how to calculate the wave velocity, attenuation, and power. In this chapter we consider wave reflection and transmission at planar boundaries be-tween different media. Our study will allow any orientation between the wave and boundary and will also include the important cases of multiple boundaries. We will also study the practical case of waves that carry power over a finite band of frequencies, as would occur, for example, in a modulated carrier. We will consider such waves in dispersive media, in which some parameter that affects propagation (permittivity for example) varies with frequency. The effect of a dispersive me-dium on a signal is of great importance because the signal envelope will change its shape as it propagates. As a result, detection and faithful representation of the original signal at the receiving end become problematic. Consequently, dispersion and attenuation must both be evaluated when establishing maximum allowable transmission distances.

#### 12

[Truncated for analysis]

#### Page 422

Figure 12.1 A plane wave incident on a boundary establishes reflected and transmitted waves having the indicated propagation directions. All fields are parallel to the boundary, with electric fields along x and magnetic fields along y.

#### 12.1.1 Reflected and Transmitted Waves at a Boundary

We begin by considering the electric field intensity in a wave that propagates toward a boundary between two media. Referring to Figure 12.1, we define region 1 $( \epsilon_{1}, \mu_{1} )$ as the half-space for which $z < 0$ ; region 2 $(\epsilon_{2}, \mu_{2} )$ is the half-space for which $z > 0$. Initially we establish the incident wave in region 1, traveling in the $+z$ direction, and linearly polarized along x.
$$
\mathcal{E}_{x1}^{+}(z,t)=E_{x10}^{+}e^{-\alpha_{1}z}\cos(\omega t-\beta_{1}z)
$$
In phasor form, this is
$$
E_{xyl}^{+}(z)=E_{x10}^{+}e^{-jk_{1}z}
$$
where we take $E_{x10}^{+}$ as real. The subscript 1 identifies the region, and the superscript + indicates a positively traveling wave. Associated with $E_{xsl}^{+}$ ($z$) is a magnetic field in the $y$ direction,
$$
H_{ys1}^{+}(z)=\frac{1}{\eta_{1}}E_{x10}^{+}e^{-jk_{1}z}
$$
where $k_{1}$ and $\eta_{1}$

[Truncated for analysis]

#### Page 423

This wave, which moves away from the boundary surface into region 2, is called the transmitted wave. Note the use of the different propagation constant $k_{2}$ and intrinsic impedance $\eta_{2}$.

The boundary conditions at $z=0$ must be satisfied with these assumed fields. With E polarized along x, the field is tangent to the interface, and therefore the E fields in regions 1 and 2 must be equal at $z=0$. Setting $z=0$ in (1) and (3) would require that $E_{x10}^{+}=E_{x20}^{+}$. H, being y-directed, is also a tangential field, and must be continuous across the boundary (no current sheets are present in real media). When we let $z=0$ in (2) and (4), we find that we must have $E_{x10}^{+}/\eta_{1}=E_{x20}^{+}/\eta_{2}$. Since $E_{x10}^{+}=E_{x20}^{+}$, then $\eta_{1}=\eta_{2}$. But this is a very special condition that does not fit the facts in general, and we are therefore unable to satisfy the boundary conditions with only an incident and a transmitted wave. We require a wave traveling away from the boundary in region 1, as shown in Figure 12.1; this is the reflected wave,
$$
E_{xs1}^{-}(z)=E_{x10}^{-}e^{jk_{1}z}\quad{(5)}
$$
$$ H_{xs1}^{-}(z)=-\frac{E_{x10}^

[Truncated for analysis]

## Core Ideas

- Region 1 is $z<0$ and region 2 is $z>0$.
- The incident wave travels in the positive $z$ direction.
- The transmitted wave travels into region 2 in the positive $z$ direction.
- The reflected wave travels in the negative $z$ direction.
- The fields are tangential to the boundary, with $\mathbf{E}$ along $x$ and $\mathbf{H}$ along $y$.
- Each region has its own propagation constant and intrinsic impedance.
- The reflected magnetic field changes sign so that reflected power flows in the negative $z$ direction.

## Source Anchors

- Figure 12.1 shows the propagation directions of the incident, reflected, and transmitted waves.
- The incident phasor is $E_{xs1}^{+}(z)=E_{x10}^{+}e^{-jk_1z}$.
- Its magnetic field is $H_{ys1}^{+}(z)=E_{x10}^{+}e^{-jk_1z}/\eta_1$.
- The transmitted fields use $k_2$ and $\eta_2$ in region 2.
- Equation (5) gives $E_{xs1}^{-}(z)=E_{x10}^{-}e^{jk_1z}$.
- Equation (6) gives $H_{ys1}^{-}(z)=-(E_{x10}^{-}/\eta_1)e^{jk_1z}$.

## Related Pages

- [[boundary-conditions-require-a-reflected-wave|Boundary Conditions Require a Reflected Wave]]
- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]
- [[multiple-interface-reflection|Multiple-Interface Reflection]]

## Concept Dependencies

- depends-on: [[boundary-conditions-require-a-reflected-wave|Boundary Conditions Require a Reflected Wave]]
- part-of: [[multiple-interface-reflection|Multiple-Interface Reflection]]
