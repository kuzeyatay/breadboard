---
title: "Fiber Eigenvalue Equation and Normalized Frequency"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "fiber-eigenvalue-equation-and-normalized-frequency"
locations: ["Page 517, Section 13.7.2 and Eqs. (154)-(156)", "Page 518, Eq. (157) and Bessel-zero cutoff examples"]
related: ["cylindrical-wave-equation-and-bessel-function-solutions", "weak-guidance-fiber-fields-and-mode-intensity", "single-mode-step-index-fiber"]
---

## ConceptNode: Fiber Eigenvalue Equation and Normalized Frequency

Planning node for [[fiber-eigenvalue-equation-and-normalized-frequency|1.297 Fiber Eigenvalue Equation and Normalized Frequency]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 517, Section 13.7.2 and Eqs. (154)-(156), Page 518, Eq. (157) and Bessel-zero cutoff examples

Allowed weakly guided fiber modes are selected by electromagnetic boundary conditions at the core-cladding interface. Continuity of the remaining longitudinal field information, represented through the z component of the curl of the electric field, produces a transcendental eigenvalue equation involving ratios of ordinary and modified Bessel functions. The core and cladding parameters combine into the normalized frequency, or V number, $V=\sqrt{u^2+w^2}=ak_0\sqrt{n_1^2-n_2^2}$. Thus V increases with core radius, operating frequency, or core-cladding index difference. At cutoff, the cladding field ceases to decay radially, which corresponds to $w=0$. The eigenvalue equation then reduces to $J_{\ell-1}(V_c)=0$. Each modal cutoff is therefore determined by an appropriate zero of an ordinary Bessel function. The radial index m orders those zeros from smallest to largest. This framework converts the continuous construction and frequency parameters into a discrete LP-mode spectrum.

### Key planning details

- Boundary conditions at $\rho=a$ determine the allowed LP modes.
- The LP eigenvalue equation is transcendental and requires numerical or graphical solution.
- The V number combines core size, frequency, and refractive-index contrast.
- Increasing a, frequency, or index difference increases V.
- Fiber cutoff occurs when the cladding decay parameter becomes $w=0$.
- At cutoff, $u_c=V_c$.
- Cutoff values satisfy $J_{\ell-1}(V_c)=0$.
- The radial mode number m enumerates successive Bessel-function zeros.

### Source coverage

- Equation (154) imposes continuity of $(\nabla\times\mathbf{E})_z$ at $\rho=a$ when permeability is equal in both regions.
- Equation (155): $$\frac{J_{\ell-1}(u)}{J_\ell(u)}=-\frac{w}{u}\frac{K_{\ell-1}(w)}{K_\ell(w)}.$$
- Equation (156): $$V=\sqrt{u^2+w^2}=ak_0\sqrt{n_1^2-n_2^2}.$$
- The source identifies $w=0$ as the general dielectric-fiber cutoff condition.
- Equation (157): $$J_{\ell-1}(V_c)=0.$$
- The source states that the LP_01 cutoff is $V_c=0$, LP_11 has $V_c=2.405$, and LP_12 has $V_c=5.520$.
