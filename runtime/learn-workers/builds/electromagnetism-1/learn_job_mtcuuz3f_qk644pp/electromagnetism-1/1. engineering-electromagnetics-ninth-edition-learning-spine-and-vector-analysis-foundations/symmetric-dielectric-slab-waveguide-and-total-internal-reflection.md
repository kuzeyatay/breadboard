---
title: "1.289 Symmetric Dielectric Slab Waveguide and Total Internal Reflection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 505, Section 13.6", "Page 506, Figure 13.19 and Section 13.6.1", "Page 507, Figure 13.20 and Eqs. (119)-(125)"]
related: ["even-and-odd-slab-modes-from-plane-wave-superposition", "evanescent-surface-waves-and-dielectric-guide-confinement", "slab-transverse-resonance-and-single-mode-cutoff"]
---

# 1.289 Symmetric Dielectric Slab Waveguide and Total Internal Reflection

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 505, Section 13.6, Page 506, Figure 13.19 and Section 13.6.1, Page 507, Figure 13.20 and Eqs. (119)-(125)

A dielectric waveguide removes metal conductor surfaces and confines waves through dielectric interfaces, avoiding the conductor losses that become severe at high frequencies. The symmetric slab consists of a central layer of thickness d and index $n_1$, surrounded above and below by material of index $n_2$. Its width in y is assumed much greater than d, so fields depend on x and z but not y. Guiding is based on total internal reflection, requiring $n_1>n_2$ and an internal incidence angle $\theta_1$ at least as large as the critical angle $\theta_c$. The z components of all participating wavevectors must equal the propagation constant $\beta$ so that boundary conditions hold for every z and time. If the reflection magnitude is less than unity, repeated partial transmission produces a leaky wave rather than a guided mode. Unlike a conducting guide, a dielectric guide does not confine all power inside its nominal boundaries. Some guided power occupies evanescent fields in the surrounding dielectric regions.

## Page-Grounded Details

#### Page 505

Because the rectangular guide will not support a TEM mode, it will not operate until the frequency exceeds the cutoff frequency of the lowest-order guided mode of the structure. Thus, the guide must be constructed large enough to accomplish this for a given frequency; the required transverse dimensions will consequently be larger than those of a transmission line that is designed to support only the TEM mode. The increased size, coupled with the fact that there is more conductor surface area than in a transmission line of equal volume, means that losses will be substantially lower in the rectangular waveguide structure. Additionally, the guides will support more power at a given electric field strength than a transmission line, as the rectangular guide will have a higher cross-sectional area.

Still, hollow pipe guides must operate in a single mode in order to avoid the signal distortion problems arising from multimode transmission. This means that the guides must be of dimensions such that they operate above the cutoff frequency of the lowest-order mode, but below the cutoff frequency of the next higher-order mode, as demonstrated in Example 13.4. Increasing the operating frequenc

[Truncated for analysis]

#### Page 506

Figure 13.19 Symmetric dielectric slab waveguide structure, in which waves propagate along z. The guide is assumed to be infinite in the y direction, thus making the problem two-dimensional.

Dielectric guides are used primarily at optical frequencies (on the order of $10^{14}$ Hz). Again, guide transverse dimensions must be kept on the order of a wavelength to achieve operation in a single mode. A number of fabrication methods can be used to accomplish this. For example, a glass plate can be doped with materials that will raise the refractive index. The doping process allows materials to be introduced only within a thin layer adjacent to the surface that is a few micrometers thick.

#### 13.6.1 Plane Wave Superposition Model

To understand how the guide operates, consider Figure 13.20, which shows a wave propagating through the slab by multiple reflections, but where partial transmission into the upper and lower regions occurs at each bounce. Wavevectors are shown in the middle and upper regions, along with their components in the $x$ and $z$ directions. As we found in Chapter 12, the $z$ components ($\beta$) of all wavevectors are equal, as must be true if the field bou

[Truncated for analysis]

#### Page 507

Figure 13.20 Plane wave geometry of a leaky wave in a symmetric slab waveguide. For a guided mode, total reflection occurs in the interior, and the x components of $\mathbf{k}_{2u}$ and $\mathbf{k}_{2d}$ are imaginary.

As discussed in Section 12.6, we require that the effective impedances, $\eta_{2s}$ or $\eta_{2p}$, be purely imaginary, zero, or infinite if (119) or (120) is to have unity magnitude. Knowing that

and
$$
\eta_{2s}=\frac{\eta_{2}}{\cos\theta_{2}}\quad{(121)}
$$
$$
\eta_{2p}=\eta_{2}\cos\theta_{2}\quad{(122)}
$$
the requirement is that $\cos\theta_{2}$ be zero or imaginary, where, from Eq. (75), Section 12.6,
$$
\cos\theta_{2}=\left[1-\sin^{2}\theta_{2}\right]^{1/2}=\left[1-\left(\frac{n_{1}}{n_{2}}\right)^{2}\sin^{2}\theta_{1}\right]^{1/2}\quad{(123)}
$$
As a result, we require that
$$
\theta_{1}\geq\theta_{c}\quad{(124)}
$$
where the critical angle is defined through
$$
\sin\theta_{c}=\frac{n_{2}}{n_{1}}\quad{(125)}
$$
Now, from the geometry of Figure 13.20, we can construct the field distribution of a TE wave in the guide using plane wave superposition. In the slab region ($-d/2<x<d/2$), we have
$$
E_{y1s}=E_{0}e^{-j\mathbf{k}_{1u}\cdot\math

[Truncated for analysis]

## Core Ideas

- The symmetric slab has thickness d, core index $n_1$, and surrounding index $n_2$.
- The model is two-dimensional because the guide is effectively infinite in y.
- Guiding requires total internal reflection and therefore $n_1>n_2$.
- The internal incidence angle must satisfy $\theta_1\geq\theta_c$.
- All wavevectors share the same longitudinal component $\beta$.
- Partial transmission produces a leaky wave rather than a guided mode.
- Dielectric-guide power extends into the surrounding media.

## Source Anchors

- S1.P506.F1, Figure 13.19, shows the symmetric slab of thickness d, propagation along z, and an effectively infinite y dimension.
- S1.P507.F1, Figure 13.20, shows the plane-wave geometry, reflected core waves, transmitted exterior waves, and common z-directed wavevector component $\beta$.
- Equations (119)-(120):
$$
\Gamma_s=\frac{\eta_{2s}-\eta_{1s}}{\eta_{2s}+\eta_{1s}},\qquad \Gamma_p=\frac{\eta_{2p}-\eta_{1p}}{\eta_{2p}+\eta_{1p}}.
$$
- Equations (121)-(122):
$$
\eta_{2s}=\frac{\eta_2}{\cos\theta_2},\qquad \eta_{2p}=\eta_2\cos\theta_2.
$$
- Equation (123):
$$
\cos\theta_2=\left[1-\left(\frac{n_1}{n_2}\right)^2\sin^2\theta_1\right]^{1/2}.
$$
- Equations (124)-(125):
$$
\theta_1\geq\theta_c,\qquad \sin\theta_c=\frac{n_2}{n_1}.$$
- The source notes primary dielectric-guide use at optical frequencies near $10^{14}$ Hz and describes index-raising dopants applied in micrometer-scale layers.

## Related Pages

- [[even-and-odd-slab-modes-from-plane-wave-superposition|Even and Odd Slab Modes from Plane-Wave Superposition]]
- [[evanescent-surface-waves-and-dielectric-guide-confinement|Evanescent Surface Waves and Dielectric-Guide Confinement]]
- [[slab-transverse-resonance-and-single-mode-cutoff|Slab Transverse Resonance and Single-Mode Cutoff]]

## Concept Dependencies

- enables: [[even-and-odd-slab-modes-from-plane-wave-superposition|Even and Odd Slab Modes from Plane-Wave Superposition]]
- causes: [[evanescent-surface-waves-and-dielectric-guide-confinement|Evanescent Surface Waves and Dielectric-Guide Confinement]]
