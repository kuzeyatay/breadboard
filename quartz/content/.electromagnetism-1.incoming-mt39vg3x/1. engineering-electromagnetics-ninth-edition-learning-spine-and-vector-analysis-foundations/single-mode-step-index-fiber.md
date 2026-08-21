---
title: "1.298 Single-Mode Step-Index Fiber"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 518, Section 13.7.3, Eqs. (158)-(159), and Example 13.6"]
related: ["fiber-eigenvalue-equation-and-normalized-frequency", "lp-01-and-lp-11-intensity-profiles", "slab-transverse-resonance-and-single-mode-cutoff"]
---

# 1.298 Single-Mode Step-Index Fiber

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 518, Section 13.7.3, Eqs. (158)-(159), and Example 13.6

The fundamental LP_01 mode has no cutoff because its cutoff condition uses the zero of $J_1$ at $V=0$. The next mode is LP_11, whose cutoff is the first positive zero of $J_0$, namely 2.405. A step-index fiber therefore operates in a single spatial mode when $0<V<2.405$, usually written $V<2.405$. Substituting $V=ak_0\sqrt{n_1^2-n_2^2}$ and $k_0=2\pi/\lambda$ converts this into a lower bound on free-space wavelength. The resulting cutoff wavelength is associated with the onset of LP_11 and is commonly supplied as a commercial fiber specification. Longer operating wavelengths reduce V and favor single-mode behavior, while increasing core radius or index contrast raises V and permits higher-order modes. In the worked example, a fiber with quoted cutoff wavelength $1.20\,\mu$m operated at $1.55\,\mu$m has $V=1.86$, safely below 2.405.

## Page-Grounded Details

#### Page 518

cutoff condition, which we now apply to (155), whose right-hand side becomes zero when $w=0$. This leads to cutoff values of $u$ and $V(u_{c}$ and $V_{c})$, and, by (156), $u_{c}=V_{c}$. Eq. (155) at cutoff now becomes:
$$
J_{\ell-1}(V_{c})=0
$$
(157)

Finding the cutoff condition for a given mode is now a matter of finding the appropriate zero of the relevant ordinary Bessel function, as determined by (157). This gives the value of $V$ at cutoff for that mode.

For example, the lowest-order mode is the simplest in structure; therefore it has no variations in $\phi$ and one variation (one maximum) in $\rho$. The designation for this mode is therefore $LP_{01}$, and with $\ell=0$, (157) gives the cutoff condition as $J_{-1}(V_{c})=0$. Because $J_{-1}=J_{1}$ (true only for the $J_{1}$ Bessel function), we take the first zero of $J_{1}$, which is $V_{c}(01)=0$. The $LP_{01}$ mode therefore has no cutoff and will propagate at the exclusion of all other modes provided $V$ for the fiber is greater than zero but less than $V_{c}$ for the next-higher-order mode. By inspecting Figure 13.22$a$, we see that the next Bessel function zero is 2.405 (for th

[Truncated for analysis]

## Core Ideas

- LP_01 has cutoff $V_c(01)=0$ and therefore propagates without a nonzero cutoff.
- LP_11 is the next higher-order mode.
- The LP_11 cutoff is $V_c(11)=2.405$.
- Single-mode operation requires $V<2.405$.
- The equivalent wavelength condition is $\lambda>\lambda_c$.
- The specified fiber cutoff wavelength is the LP_11 cutoff wavelength.
- A larger wavelength lowers V for a fixed fiber.
- For $\lambda_c=1.20\,\mu$m and $\lambda=1.55\,\mu$m, $V=1.86$.

## Source Anchors

- Equation (158):
$$
V<V_c(11)=2.405
$$
- Equation (159):
$$
\lambda>\lambda_c=\frac{2\pi a}{2.405}\sqrt{n_1^2-n_2^2}
$$
- The source identifies $\lambda_c$ as the cutoff wavelength of LP_11 and notes that it is quoted for commercial single-mode fiber.
- Example 13.6 uses
$$
V=2.405\frac{\lambda_c}{\lambda}
$$
- For $\lambda_c=1.20\,\mu\mathrm{m}$ and $\lambda=1.55\,\mu\mathrm{m}$, the source calculates $V=1.86$.
- The source explicitly notes the similarity between the fiber single-mode condition and the slab-waveguide condition.

## Related Pages

- [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]
- [[lp-01-and-lp-11-intensity-profiles|LP_01 and LP_11 Intensity Profiles]]
- [[slab-transverse-resonance-and-single-mode-cutoff|Slab Transverse Resonance and Single-Mode Cutoff]]

## Concept Dependencies

- derives-from: [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]
- applies-to: [[lp-01-and-lp-11-intensity-profiles|LP_01 and LP_11 Intensity Profiles]]
