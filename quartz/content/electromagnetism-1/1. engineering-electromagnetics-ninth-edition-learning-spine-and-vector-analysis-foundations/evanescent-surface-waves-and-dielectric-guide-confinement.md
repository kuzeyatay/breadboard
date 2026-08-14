---
title: "1.291 Evanescent Surface Waves and Dielectric-Guide Confinement"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 508, Section 13.6.2 and Eqs. (131)-(134)", "Page 509, Eq. (135) and surface-wave interpretation"]
related: ["symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "piecewise-slab-mode-fields-and-frequency-dependent-confinement", "weakly-guiding-step-index-fiber-and-lp-modes"]
---

# 1.291 Evanescent Surface Waves and Dielectric-Guide Confinement

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 508, Section 13.6.2 and Eqs. (131)-(134), Page 509, Eq. (135) and surface-wave interpretation

Under total internal reflection, the transmitted wave angle in the surrounding material gives an imaginary transverse wavevector component. Writing $\kappa_2=-j\gamma_2$ converts the exterior field into an exponential decay away from each interface while preserving propagation along z through $e^{-j\beta z}$. Above the slab, the field varies as $e^{-\gamma_2(x-d/2)}$; below it, the field varies as $e^{\gamma_2(x+d/2)}$. These are surface waves: they carry part of the mode power along the guide but do not propagate away from the slab in the transverse direction. Their presence means the electromagnetic cross section is not limited to the physical slab and is mathematically infinite. In practice, the exponential decay usually makes the fields negligible within a few slab thicknesses. The decay coefficient grows with internal angle and therefore changes both with frequency and mode order, providing a quantitative measure of how tightly the mode is confined.

## Page-Grounded Details

#### Page 508

where
$$
\mathbf{k}_{1u}=\kappa_{1}\mathbf{a}_{x}+\beta\mathbf{a}_{z}\quad{(127)}
$$
and
$$
\mathbf{k}_{1d}=-\kappa_{1}\mathbf{a}_{x}+\beta\mathbf{a}_{z}\quad{(128)}
$$
The second term in (126) may either add to or subtract from the first term, since either case would result in a symmetric intensity distribution in the x direction. We expect this because the guide is symmetric. Now, using $\mathbf{r} = x\mathbf{a}_{x} + z\mathbf{a}_{z}$, (126) becomes
$$
E_{y1s}=E_{0}[e^{j\kappa_{1}x} + e^{-j\kappa_{1}x}]e^{-j\beta z}=2E_{0}\cos(\kappa_{1}x)e^{-j\beta z}\quad{(129)}
$$
for the choice of the plus sign in (126), and
$$
E_{y1s}=E_{0}[e^{j\kappa_{1}x} + e^{-j\kappa_{1}x}]e^{-j\beta z}=2j\,E_{0}\sin(\kappa_{1}x)e^{-j\beta z}\quad{(130)}
$$
if the minus sign is chosen. Because $\kappa_{1} = n_{1}k_{0}\cos\theta_{1}$, we see that larger values of $\kappa_{1}$ imply smaller values of $\theta_{1}$ at a given frequency. In addition, larger $\kappa_{1}$ values result in a greater number of spatial oscillations of the electric field over the transverse dimension, as (129) and (130) show. We found similar behavior in the parallel-plate guide. In the slab waveguide, as with the

[Truncated for analysis]

#### Page 509

Figure 13.21 Electric field amplitude distributions over the transverse plane for the first three TE modes in a symmetric slab waveguide.

where the $x$ variable in (131) has been replaced by $x-(d/2)$ to position the field magnitude, $E_{02}$, at the boundary. Using similar reasoning, the field in the region below the lower interface, where $x$ is negative, and where $\mathbf{k}_{2d}$ is involved, will be
$$
E_{y2x}=E_{02}e^{\gamma_{2}(x+d/2)}e^{-j\beta z}\qquad\left(x<-\frac{d}{2}\right)\quad{(135)}
$$
The fields expressed in (134) and (135) are those of surface waves. Note that they propagate in the $z$ direction only, according to $e^{-j\beta z}$, but simply reduce in amplitude with increasing $|x|$, according to the $e^{-\gamma_{2}(x-d/2)}$ term in (134) and the $e^{\gamma_{2}(x+d/2)}$ term in (135). These waves represent a certain fraction of the total power in the mode, and so we see an important fundamental difference between dielectric waveguides and metal waveguides: in the dielectric guide, the fields (and guided power) exist over a cross section that extends beyond the confining boundaries, and in principle they exist over an infinite cross section

[Truncated for analysis]

## Core Ideas

- Total internal reflection makes the exterior transverse wavevector imaginary.
- Define $\kappa_2=-j\gamma_2$ with real positive decay coefficient $\gamma_2$.
- Exterior fields propagate along z but decay exponentially with distance from the slab.
- Surface waves carry a nonzero fraction of the guided power.
- The dielectric mode extends beyond the nominal guide boundaries.
- Larger $\gamma_2$ produces faster decay and tighter confinement.

## Source Anchors

- Equation (131) begins with the upper-region field $E_{y2}=E_{02}e^{-j\kappa_2x}e^{-j\beta z}$.
- Equation (132):
$$
\kappa_2=-j\gamma_2
$$
- Equation (133) derives $\gamma_2$ from $n_1$, $n_2$, $k_0$, and $\theta_1$.
- Equation (134):
$$
E_{y2}=E_{02}e^{-\gamma_2(x-d/2)}e^{-j\beta z},\qquad x>d/2
$$
- Equation (135):
$$
E_{y2}=E_{02}e^{\gamma_2(x+d/2)}e^{-j\beta z},\qquad x<-d/2
$$
- Page 509 identifies these exterior fields as surface waves and states that guided power extends beyond the dielectric boundaries.

## Related Pages

- [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
- [[piecewise-slab-mode-fields-and-frequency-dependent-confinement|Piecewise Slab Mode Fields and Frequency-Dependent Confinement]]
- [[weakly-guiding-step-index-fiber-and-lp-modes|Weakly Guiding Step-Index Fiber and LP Modes]]

## Concept Dependencies

- part-of: [[piecewise-slab-mode-fields-and-frequency-dependent-confinement|Piecewise Slab Mode Fields and Frequency-Dependent Confinement]]
