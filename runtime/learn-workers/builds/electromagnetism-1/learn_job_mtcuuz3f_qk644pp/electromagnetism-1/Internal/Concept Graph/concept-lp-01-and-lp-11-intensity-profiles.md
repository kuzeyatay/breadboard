---
title: "LP_01 and LP_11 Intensity Profiles"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lp-01-and-lp-11-intensity-profiles"
locations: ["Page 519, Eqs. (160)-(164) and discussion of Figures 13.23-13.24"]
related: ["weak-guidance-fiber-fields-and-mode-intensity", "single-mode-step-index-fiber", "fiber-eigenvalue-equation-and-normalized-frequency"]
---

## ConceptNode: LP_01 and LP_11 Intensity Profiles

Planning node for [[lp-01-and-lp-11-intensity-profiles|1.299 LP_01 and LP_11 Intensity Profiles]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 519, Eqs. (160)-(164) and discussion of Figures 13.23-13.24

The exact LP_01 intensity is radially symmetric because $\ell=0$, so it contains no angular factor. Its core profile is proportional to $J_0^2(u_{01}\rho/a)$, and its cladding tail is proportional to $K_0^2(w_{01}\rho/a)$. The LP_11 mode instead uses first-order Bessel functions and includes $\cos^2\phi$, producing two angular intensity lobes for a selected orientation. At a common V, the higher-order LP_11 mode is less tightly confined to the core than LP_01. Increasing V causes existing modes to become more tightly confined, although it can also allow additional higher-order modes to pass cutoff. Exact profiles generally require a numerical solution of the eigenvalue equation for u and w. For LP_01 over $1.3<V<3.5$, the Rudolf-Neumann approximation estimates w directly. The fundamental intensity can also be approximated by a Gaussian whose mode field radius $\rho_0$ is the radius at which intensity falls to $1/e^2$ of its axial value. The Marcuse formula estimates $\rho_0/a$ from V.

### Key planning details

- LP_01 has a circularly symmetric $J_0^2$ core intensity and $K_0^2$ cladding tail.
- LP_11 uses $J_1^2$ and $K_1^2$ with a $\cos^2\phi$ angular factor.
- At equal V, LP_11 is less confined than LP_01.
- Increasing V tightens existing mode confinement but can introduce new modes.
- Exact intensity profiles require u and w from the transcendental eigenvalue equation.
- The Rudolf-Neumann formula approximates $w_{01}$ for $1.3<V<3.5$.
- LP_01 intensity is well approximated by a Gaussian.
- The mode field radius is defined at the $1/e^2$ intensity point.
- The Marcuse formula relates normalized mode field radius to V.

### Source coverage

- Equation (160) gives the piecewise LP_01 intensity using $J_0$ in the core and $K_0$ in the cladding.
- Equation (161) gives the piecewise LP_11 intensity using $J_1$, $K_1$, and $\cos^2\phi$.
- The source states that plots at a common V show lower core confinement for the higher-order mode.
- Source-central Figure 13.23 is described as plotting LP_01 and LP_11 intensities versus radius at $\phi=0$ for one V value; the image itself is not included in this chunk, but its comparison belongs with this concept.
- Source-central Figure 13.24 is described as showing that LP_01 becomes more tightly confined as V increases; the image itself is not included in this chunk, but its trend belongs with this concept.
- Equation (162): $$w_{01}\doteq1.1428V-0.9960,\qquad 1.3<V<3.5.$$
- Equation (163): $$I_{01}\approx I_0e^{-2\rho^2/\rho_0^2}.$$
- Equation (164): $$\frac{\rho_0}{a}\approx0.65+\frac{1.619}{V^{3/2}}+\frac{2.879}{V^6}.$$
