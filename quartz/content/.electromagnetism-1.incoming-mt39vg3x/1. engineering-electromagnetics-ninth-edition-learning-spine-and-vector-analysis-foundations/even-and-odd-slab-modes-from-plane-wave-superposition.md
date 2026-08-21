---
title: "1.290 Even and Odd Slab Modes from Plane-Wave Superposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 507, Eq. (126)", "Page 508, Eqs. (127)-(130)"]
related: ["symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "evanescent-surface-waves-and-dielectric-guide-confinement", "piecewise-slab-mode-fields-and-frequency-dependent-confinement"]
---

# 1.290 Even and Odd Slab Modes from Plane-Wave Superposition

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 507, Eq. (126), Page 508, Eqs. (127)-(130)

Inside the symmetric slab, a TE mode can be built by superposing two plane waves with equal longitudinal component $\beta$ and opposite transverse components $\pm\kappa_1$. Adding the waves produces an even transverse field proportional to $\cos(\kappa_1x)$, while subtracting them produces an odd field proportional to $\sin(\kappa_1x)$. Both retain the common propagation factor $e^{-j\beta z}$. The two parity choices are expected because the physical guide is symmetric about its central plane. The transverse wavenumber is $\kappa_1=n_1k_0\cos\theta_1$, so at a fixed frequency a larger $\kappa_1$ corresponds to a smaller internal ray angle. It also produces more spatial oscillations across the slab, linking larger transverse wavenumber to higher-order modes. This plane-wave construction provides the oscillatory interior portions of the complete piecewise mode fields. Boundary matching later fixes their amplitudes relative to the evanescent fields outside the slab.

## Page-Grounded Details

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

## Core Ideas

- The upward and downward core waves have transverse components $+\kappa_1$ and $-\kappa_1$.
- Both core waves have the same longitudinal propagation constant $\beta$.
- The sum of the waves gives an even cosine field.
- The difference of the waves gives an odd sine field.
- Both parity classes have symmetric intensity distributions.
- Larger $\kappa_1$ means more transverse oscillations and a higher-order mode.
- At fixed frequency, increasing $\kappa_1$ corresponds to decreasing $\theta_1$.

## Source Anchors

- Equation (126) superposes two TE plane waves inside $-d/2<x<d/2$.
- Equations (127)-(128):
$$
\mathbf{k}_{1u}=\kappa_1\mathbf{a}_x+\beta\mathbf{a}_z,\qquad \mathbf{k}_{1d}=-\kappa_1\mathbf{a}_x+\beta\mathbf{a}_z.
$$
- Equation (129):
$$
E_{y1}=2E_0\cos(\kappa_1x)e^{-j\beta z}.
$$
- Equation (130), after choosing the difference of the component waves:
$$
E_{y1}=2jE_0\sin(\kappa_1x)e^{-j\beta z}.$$
- The source states $\kappa_1=n_1k_0\cos\theta_1$ and associates higher-order modes with larger $\kappa_1$.

## Related Pages

- [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
- [[evanescent-surface-waves-and-dielectric-guide-confinement|Evanescent Surface Waves and Dielectric-Guide Confinement]]
- [[piecewise-slab-mode-fields-and-frequency-dependent-confinement|Piecewise Slab Mode Fields and Frequency-Dependent Confinement]]

## Concept Dependencies

- part-of: [[piecewise-slab-mode-fields-and-frequency-dependent-confinement|Piecewise Slab Mode Fields and Frequency-Dependent Confinement]]
