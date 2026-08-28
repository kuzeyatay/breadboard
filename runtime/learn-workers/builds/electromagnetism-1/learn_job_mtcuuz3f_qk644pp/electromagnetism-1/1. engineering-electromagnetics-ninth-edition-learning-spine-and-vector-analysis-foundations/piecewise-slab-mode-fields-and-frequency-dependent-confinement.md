---
title: "1.292 Piecewise Slab Mode Fields and Frequency-Dependent Confinement"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 509, Figure 13.21 and Eq. (136)", "Page 510, Eqs. (137)-(138) and confinement discussion"]
related: ["even-and-odd-slab-modes-from-plane-wave-superposition", "evanescent-surface-waves-and-dielectric-guide-confinement", "slab-transverse-resonance-and-single-mode-cutoff"]
---

# 1.292 Piecewise Slab Mode Fields and Frequency-Dependent Confinement

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 509, Figure 13.21 and Eq. (136), Page 510, Eqs. (137)-(138) and confinement discussion

A complete slab mode combines an oscillatory core field with exponentially decaying exterior fields and enforces tangential electric-field continuity at $x=\pm d/2$. Even TE modes use a cosine inside the slab and equal-sign exponential tails above and below. Odd TE modes use a sine inside and opposite signs for the two exterior tails. Unlike a metallic guide, the field need not vanish at the dielectric interfaces; it joins continuously to the evanescent fields. TM modes have nearly the same spatial form, but their plane-wave polarization is rotated by 90 degrees, so $H_y$ follows the same type of profile as $E_y$ in a TE mode. The guide supports a finite discrete set of modes at a given frequency, with more modes becoming available as frequency increases. At cutoff, a dielectric mode has $\theta_1=\theta_c$, not zero angle as in a metallic guide. Raising frequency increases $\theta_1$ and $\gamma_2$, tightening an existing mode's confinement. At one frequency, higher-order modes have smaller angles, smaller decay coefficients, and more power outside the slab than lower-order modes.

## Page-Grounded Details

#### Page 509

Figure 13.21 Electric field amplitude distributions over the transverse plane for the first three TE modes in a symmetric slab waveguide.

where the $x$ variable in (131) has been replaced by $x-(d/2)$ to position the field magnitude, $E_{02}$, at the boundary. Using similar reasoning, the field in the region below the lower interface, where $x$ is negative, and where $\mathbf{k}_{2d}$ is involved, will be
$$
E_{y2x}=E_{02}e^{\gamma_{2}(x+d/2)}e^{-j\beta z}\qquad\left(x<-\frac{d}{2}\right)\quad{(135)}
$$
The fields expressed in (134) and (135) are those of surface waves. Note that they propagate in the $z$ direction only, according to $e^{-j\beta z}$, but simply reduce in amplitude with increasing $|x|$, according to the $e^{-\gamma_{2}(x-d/2)}$ term in (134) and the $e^{\gamma_{2}(x+d/2)}$ term in (135). These waves represent a certain fraction of the total power in the mode, and so we see an important fundamental difference between dielectric waveguides and metal waveguides: in the dielectric guide, the fields (and guided power) exist over a cross section that extends beyond the confining boundaries, and in principle they exist over an infinite cross section

[Truncated for analysis]

#### Page 510

of even and odd symmetry:
$$
E_{se}(even TE)=\begin{cases}E_{0e}\cos(\kappa_{1}x)e^{-j\beta z}&(-\frac{d}{2}<x<\frac{d}{2})\\ E_{0e}\cos(\kappa_{1}\frac{d}{2})e^{-\gamma_{2}(x-d/2)}e^{-j\beta z}&(x>\frac{d}{2})\\ E_{0e}\cos(\kappa_{1}\frac{d}{2})e^{\gamma_{2}(x+d/2)}e^{-j\beta z}&(x<-\frac{d}{2})\end{cases}(137)
$$
$$
E_{so}(odd TE)=\begin{cases}E_{0o}\sin(\kappa_{1}x)e^{-j\beta z}&(-\frac{d}{2}<x<\frac{d}{2})\\ E_{0o}\sin(\kappa_{1}\frac{d}{2})e^{-\gamma_{2}(x-d/2)}e^{-j\beta z}&(x>\frac{d}{2})\\-E_{0o}\sin(\kappa_{1}\frac{d}{2})e^{\gamma_{2}(x+d/2)}e^{-j\beta z}&(x<-\frac{d}{2})\end{cases}(138)
$$
Solution of the wave equation yields (as it must) results identical to these. The reader is referred to References 2 and 3 for the details. The magnetic field for the TE modes will consist of x and z components, as was true for the parallel-plate guide. Finally, the TM mode fields will be nearly the same in form as those of TE modes, but with a simple rotation in polarization of the plane wave components by 90 deg. Thus, in TM modes, $H_{y}$ will result, and it will have the same form as $E_{y}$ for TE, as presented in (137) and (138).

Apart from the differences in the field str

[Truncated for analysis]

## Core Ideas

- Tangential $E_y$ is continuous at both dielectric interfaces.
- Even TE modes have cosine core fields and symmetric exponential tails.
- Odd TE modes have sine core fields and antisymmetric signed tails.
- Dielectric-interface fields generally do not vanish at the boundaries.
- TM spatial profiles resemble TE profiles after a 90-degree polarization rotation.
- The number of allowed discrete modes increases with frequency.
- At dielectric-guide cutoff, $\theta_1=\theta_c$.
- Existing modes become more tightly confined as their frequency rises.
- At fixed frequency, higher-order modes place a greater power fraction outside the slab.

## Source Anchors

- S1.P509.F1, Figure 13.21, shows the first three TE transverse field profiles with oscillatory slab fields and exterior exponential tails.
- Equation (136):
$$
E_{y1}|_{x=\pm d/2}=E_{y2}|_{x=\pm d/2}
$$
- Equation (137) gives the three-region even TE field with a cosine core and matched exponential tails.
- Equation (138) gives the three-region odd TE field with a sine core and opposite signs below and above the slab.
- The source states that TE magnetic fields have x and z components and that TM modes produce an $H_y$ profile analogous to TE $E_y$.
- Page 510 states that $\gamma_2$ rises with $\theta_1$, causing stronger confinement as frequency increases.
- Page 510 states that higher-order modes at a common frequency have lower $\gamma_2$ and more power in the surrounding regions.

## Related Pages

- [[even-and-odd-slab-modes-from-plane-wave-superposition|Even and Odd Slab Modes from Plane-Wave Superposition]]
- [[evanescent-surface-waves-and-dielectric-guide-confinement|Evanescent Surface Waves and Dielectric-Guide Confinement]]
- [[slab-transverse-resonance-and-single-mode-cutoff|Slab Transverse Resonance and Single-Mode Cutoff]]

## Concept Dependencies

- depends-on: [[slab-transverse-resonance-and-single-mode-cutoff|Slab Transverse Resonance and Single-Mode Cutoff]]
