---
title: "Symmetric Dielectric Slab Waveguide and Total Internal Reflection"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "symmetric-dielectric-slab-waveguide-and-total-internal-reflection"
locations: ["Page 505, Section 13.6", "Page 506, Figure 13.19 and Section 13.6.1", "Page 507, Figure 13.20 and Eqs. (119)-(125)"]
related: ["even-and-odd-slab-modes-from-plane-wave-superposition", "evanescent-surface-waves-and-dielectric-guide-confinement", "slab-transverse-resonance-and-single-mode-cutoff"]
---

## ConceptNode: Symmetric Dielectric Slab Waveguide and Total Internal Reflection

Planning node for [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|1.289 Symmetric Dielectric Slab Waveguide and Total Internal Reflection]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 505, Section 13.6, Page 506, Figure 13.19 and Section 13.6.1, Page 507, Figure 13.20 and Eqs. (119)-(125)

A dielectric waveguide removes metal conductor surfaces and confines waves through dielectric interfaces, avoiding the conductor losses that become severe at high frequencies. The symmetric slab consists of a central layer of thickness d and index $n_1$, surrounded above and below by material of index $n_2$. Its width in y is assumed much greater than d, so fields depend on x and z but not y. Guiding is based on total internal reflection, requiring $n_1>n_2$ and an internal incidence angle $\theta_1$ at least as large as the critical angle $\theta_c$. The z components of all participating wavevectors must equal the propagation constant $\beta$ so that boundary conditions hold for every z and time. If the reflection magnitude is less than unity, repeated partial transmission produces a leaky wave rather than a guided mode. Unlike a conducting guide, a dielectric guide does not confine all power inside its nominal boundaries. Some guided power occupies evanescent fields in the surrounding dielectric regions.

### Key planning details

- The symmetric slab has thickness d, core index $n_1$, and surrounding index $n_2$.
- The model is two-dimensional because the guide is effectively infinite in y.
- Guiding requires total internal reflection and therefore $n_1>n_2$.
- The internal incidence angle must satisfy $\theta_1\geq\theta_c$.
- All wavevectors share the same longitudinal component $\beta$.
- Partial transmission produces a leaky wave rather than a guided mode.
- Dielectric-guide power extends into the surrounding media.

### Source coverage

- S1.P506.F1, Figure 13.19, shows the symmetric slab of thickness d, propagation along z, and an effectively infinite y dimension.
- S1.P507.F1, Figure 13.20, shows the plane-wave geometry, reflected core waves, transmitted exterior waves, and common z-directed wavevector component $\beta$.
- Equations (119)-(120): $$\Gamma_s=\frac{\eta_{2s}-\eta_{1s}}{\eta_{2s}+\eta_{1s}},\qquad \Gamma_p=\frac{\eta_{2p}-\eta_{1p}}{\eta_{2p}+\eta_{1p}}.$$
- Equations (121)-(122): $$\eta_{2s}=\frac{\eta_2}{\cos\theta_2},\qquad \eta_{2p}=\eta_2\cos\theta_2.$$
- Equation (123): $$\cos\theta_2=\left[1-\left(\frac{n_1}{n_2}\right)^2\sin^2\theta_1\right]^{1/2}.$$
- Equations (124)-(125): $$\theta_1\geq\theta_c,\qquad \sin\theta_c=\frac{n_2}{n_1}.$$
- The source notes primary dielectric-guide use at optical frequencies near $10^{14}$ Hz and describes index-raising dopants applied in micrometer-scale layers.
