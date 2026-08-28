---
title: "1.297 Fiber Eigenvalue Equation and Normalized Frequency"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 517, Section 13.7.2 and Eqs. (154)-(156)", "Page 518, Eq. (157) and Bessel-zero cutoff examples"]
related: ["cylindrical-wave-equation-and-bessel-function-solutions", "weak-guidance-fiber-fields-and-mode-intensity", "single-mode-step-index-fiber"]
---

# 1.297 Fiber Eigenvalue Equation and Normalized Frequency

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 517, Section 13.7.2 and Eqs. (154)-(156), Page 518, Eq. (157) and Bessel-zero cutoff examples

Allowed weakly guided fiber modes are selected by electromagnetic boundary conditions at the core-cladding interface. Continuity of the remaining longitudinal field information, represented through the z component of the curl of the electric field, produces a transcendental eigenvalue equation involving ratios of ordinary and modified Bessel functions. The core and cladding parameters combine into the normalized frequency, or V number, $V=\sqrt{u^2+w^2}=ak_0\sqrt{n_1^2-n_2^2}$. Thus V increases with core radius, operating frequency, or core-cladding index difference. At cutoff, the cladding field ceases to decay radially, which corresponds to $w=0$. The eigenvalue equation then reduces to $J_{\ell-1}(V_c)=0$. Each modal cutoff is therefore determined by an appropriate zero of an ordinary Bessel function. The radial index m orders those zeros from smallest to largest. This framework converts the continuous construction and frequency parameters into a discrete LP-mode spectrum.

## Page-Grounded Details

#### Page 517

frequency and fiber construction. In the slab waveguide, two equations, (139) and (140), were found using transverse resonance arguments, and these were associated with TE and TM waves in the slab. In our fiber, we do not apply transverse resonance directly, but rather implicitly, by requiring that all fields satisfy the boundary conditions at the core/cladding interface, $\rho=a$.^7 We have already applied conditions on the transverse fields to obtain Eq. (151). The remaining condition is continuity of the $z$ components of $\mathbf{E}$ and $\mathbf{H}$. In the weak-guidance approximation, we have neglected all $z$ components, but we will consider them now for this last exercise. Using Faraday's law in point form, continuity of $H_{zs}$ at $\rho=a$ is the same as the continuity of the $z$ component of $\nabla\times\mathbf{E}_{s}$, provided that $\mu=\mu_{0}$ (or is the same value) in both regions. Specifically
$$
(\nabla\times\mathbf{E}_{s1})_{z}|_{\rho=a}=(\nabla\times\mathbf{E}_{s2})_{z}|_{\rho=a}\quad{(154)}
$$
The procedure begins by expressing the electric field in (151) in terms of $\rho$ and $\phi$ components and then applying (154). This is a leng

[Truncated for analysis]

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

- Boundary conditions at $\rho=a$ determine the allowed LP modes.
- The LP eigenvalue equation is transcendental and requires numerical or graphical solution.
- The V number combines core size, frequency, and refractive-index contrast.
- Increasing a, frequency, or index difference increases V.
- Fiber cutoff occurs when the cladding decay parameter becomes $w=0$.
- At cutoff, $u_c=V_c$.
- Cutoff values satisfy $J_{\ell-1}(V_c)=0$.
- The radial mode number m enumerates successive Bessel-function zeros.

## Source Anchors

- Equation (154) imposes continuity of $(\nabla\times\mathbf{E})_z$ at $\rho=a$ when permeability is equal in both regions.
- Equation (155):
$$
\frac{J_{\ell-1}(u)}{J_\ell(u)}=-\frac{w}{u}\frac{K_{\ell-1}(w)}{K_\ell(w)}
$$
- Equation (156):
$$
V=\sqrt{u^2+w^2}=ak_0\sqrt{n_1^2-n_2^2}
$$
- The source identifies $w=0$ as the general dielectric-fiber cutoff condition.
- Equation (157):
$$
J_{\ell-1}(V_c)=0
$$
- The source states that the LP_01 cutoff is $V_c=0$, LP_11 has $V_c=2.405$, and LP_12 has $V_c=5.520$.

## Related Pages

- [[cylindrical-wave-equation-and-bessel-function-solutions|Cylindrical Wave Equation and Bessel-Function Solutions]]
- [[weak-guidance-fiber-fields-and-mode-intensity|Weak-Guidance Fiber Fields and Mode Intensity]]
- [[single-mode-step-index-fiber|Single-Mode Step-Index Fiber]]

## Concept Dependencies

- depends-on: [[weak-guidance-fiber-fields-and-mode-intensity|Weak-Guidance Fiber Fields and Mode Intensity]]
- enables: [[single-mode-step-index-fiber|Single-Mode Step-Index Fiber]]
