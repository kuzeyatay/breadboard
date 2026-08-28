---
title: "Cylindrical Wave Equation and Bessel-Function Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "cylindrical-wave-equation-and-bessel-function-solutions"
locations: ["Page 513, Eqs. (144)-(146)", "Page 514, Eqs. (147)-(149)", "Page 515, Figure 13.22 and core-cladding solution assignment"]
related: ["weakly-guiding-step-index-fiber-and-lp-modes", "weak-guidance-fiber-fields-and-mode-intensity", "fiber-eigenvalue-equation-and-normalized-frequency"]
---

## ConceptNode: Cylindrical Wave Equation and Bessel-Function Solutions

Planning node for [[cylindrical-wave-equation-and-bessel-function-solutions|1.295 Cylindrical Wave Equation and Bessel-Function Solutions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 513, Eqs. (144)-(146), Page 514, Eqs. (147)-(149), Page 515, Figure 13.22 and core-cladding solution assignment

The weakly guiding fiber field is separated into radial, azimuthal, and longitudinal factors. Each mode has the form $R(\rho)\Phi(\phi)e^{-j\beta z}$ and independently satisfies the cylindrical wave equation. Separation introduces the constant $\ell^2$, producing an angular harmonic equation and a radial Bessel equation. Periodicity after a full $2\pi$ rotation forces $\ell$ to be an integer, and the angular dependence may be chosen as $\cos(\ell\phi)$. The radial behavior depends on $\beta_t=\sqrt{k^2-\beta^2}$. In the core, $\beta_{t1}$ is real and the physical oscillatory solution is the ordinary Bessel function $J_\ell$. In the cladding, $\beta_{t2}$ is imaginary and the physical decaying solution is the modified Bessel function $K_\ell$. Other mathematical solutions are rejected because they have nonphysical radial behavior. The listed zeros of $J_0$ and $J_1$ later determine LP-mode cutoff values.

### Key planning details

- A fiber mode separates as $R(\rho)\Phi(\phi)e^{-j\beta z}$.
- Variable separation produces angular and radial equations with constant $\ell^2$.
- Azimuthal periodicity requires integer $\ell$.
- The angular dependence can be chosen as $\cos(\ell\phi)$.
- The radial equation is a form of Bessel's equation.
- Core fields use oscillatory $J_\ell$ functions.
- Cladding fields use decaying $K_\ell$ functions.
- Zeros of ordinary Bessel functions determine modal cutoffs.

### Source coverage

- Equation (144): $$E_x(\rho,\phi,z)=\sum_iR_i(\rho)\Phi_i(\phi)e^{-j\beta_i z}.$$
- Equation (145) gives the scalar cylindrical wave equation for $E_x$.
- Equations (147a)-(147b) separate the angular harmonic equation from the radial Bessel equation.
- Equation (148): $$\Phi(\phi)=\cos(\ell\phi+\alpha)\ \text{or}\ \sin(\ell\phi+\alpha),$$ with integer $\ell$ required by rotational periodicity.
- Equation (149): $$R(\rho)=AJ_\ell(\beta_t\rho)$$ for real $\beta_t$, or $$R(\rho)=BK_\ell(|\beta_t|\rho)$$ for imaginary $\beta_t$.
- S1.P515.F1, Figure 13.22, plots $J_0$, $J_1$, $K_0$, and $K_1$.
- The listed $J_0$ zeros are 2.405, 5.520, 8.654, 11.792, and 14.931; the listed $J_1$ zeros are 0, 3.832, 7.016, 10.173, and 13.324.
