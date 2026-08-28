---
title: "1.296 Weak-Guidance Fiber Fields and Mode Intensity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 515, Eqs. (150a)-(150b)", "Page 516, Eqs. (151)-(153) and mode-index interpretation"]
related: ["cylindrical-wave-equation-and-bessel-function-solutions", "fiber-eigenvalue-equation-and-normalized-frequency", "lp-01-and-lp-11-intensity-profiles"]
---

# 1.296 Weak-Guidance Fiber Fields and Mode Intensity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 515, Eqs. (150a)-(150b), Page 516, Eqs. (151)-(153) and mode-index interpretation

The transverse fiber parameters are normalized by the core radius to define $u=a\sqrt{n_1^2k_0^2-\beta^2}$ in the core and $w=a\sqrt{\beta^2-n_2^2k_0^2}$ in the cladding. Both regions share the same propagation constant $\beta$ so their boundary fields can agree for every z and time. A guided LP mode has an oscillatory $J_\ell(u\rho/a)$ profile inside the core and a decaying $K_\ell(w\rho/a)$ profile outside. The cladding coefficient is selected so that the transverse electric field is continuous at $\rho=a$ under weak guidance. Approximating $H_y\doteq E_x/\eta$ then makes the average intensity proportional to $|E_x|^2/(2\eta)$. The angular factor $\cos^2(\ell\phi)$ shows that $2\ell$ counts intensity variations around the fiber. The radial mode number m selects progressively larger allowed u ranges, causing additional Bessel oscillations and radial maxima as m increases.

## Page-Grounded Details

#### Page 515

![Page 515 figure 1](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-515-figure-1.png)

Figure 13.22 (a) Ordinary Bessel functions of the first kind, of orders 0 and 1, and of argument $\beta_{t}\rho$, where $\beta_{t}$ is real. (b) Modified Bessel functions of the second kind, of orders 0 and 1, and of argument $|\beta_{t}|\rho$, where $\beta_{t}$ is imaginary.

The Bessel $K$ functions provide this behavior and will apply if $\beta_{t2}$ is imaginary. Re-quiring this, we may therefore write $|\beta_{t2}|=(\beta^{2}-n_{2}^{2}k_{0}^{2})^{1/2}$. The diminishing field amplitude with increasing radius within the cladding allows us to neglect the effect of the outer cladding boundary (at $\rho=b$), as fields there are presumed to be too weak for this boundary to have any effect on the mode field.

Because $\beta_{t1}$ and $\beta_{t2}$ are in units of $m^{-1}$, it is convenient to normalize these quan-tities (while making them dimensionless) by multiplying both by the core radius, $a$. Our new normalized parameters become
$$
u\equiv a\beta_{t1}=a\sqrt{n_{1}^{2}k_{0}^{2}-\beta^{2}}\quad{(150a)}
$$
$$
w\equiv a|\beta_{t2}|=a\s

[Truncated for analysis]

#### Page 516

$u$ and $w$ are in direct analogy with the quantities $\kappa_{1d}$ and $\kappa_{2d}$ in the slab waveguide. As in those parameters, $\beta$ is the $z$ component of both $n_{1}k_{0}$ and $n_{2}k_{0}$ and is the phase constant of the guided mode. $\beta$ must be the same in both regions so that the field boundary conditions will be satisfied at $\rho=a$ for all $z$ and $t$.

We may now construct the total solution for $E_{xs}$ for a single guided mode, using (144) along with (148), (149), (150a), and (150b):
$$
 E_{xs}=\begin{cases}E_{0}J_{\ell}(u\rho/a)\cos(\ell\phi)e^{-j\beta z}&\rho\leq a\\ E_{0}[J_{\ell}(u)/K_{\ell}(w)]K_{\ell}(w\rho/a)\cos(\ell\phi)e^{-j\beta z}&\rho\geq a\end{cases}\quad{(151)}
$$
Note that we have let the coefficient $A$ in (149) equal $E_{0}$, and $B=E_{0}[J_{\ell}(u)/K_{\ell}(w)]$. These choices ensure that the expressions for $E_{xs}$ in the two regions become equal at $\rho=a$, a condition approximately true as long as $n_{1}\doteq n_{2}$ (the weak-guidance approximation).

Again, the weak-guidance condition also allows the approximation $H\doteq E/\eta$, with $\eta$ taken as the intrinsic impedance of the claddi

[Truncated for analysis]

## Core Ideas

- The dimensionless core parameter is $u=a\sqrt{n_1^2k_0^2-\beta^2}$.
- The dimensionless cladding parameter is $w=a\sqrt{\beta^2-n_2^2k_0^2}$.
- The same $\beta$ applies in the core and cladding.
- Core fields use $J_\ell(u\rho/a)$ and cladding fields use $K_\ell(w\rho/a)$.
- The field coefficients enforce approximate continuity at the core-cladding boundary.
- Weak guidance gives intensity $I=|E_x|^2/(2\eta)$.
- The index $\ell$ determines angular intensity variation and Bessel-function order.
- The index m determines the number of radial intensity variations.

## Source Anchors

- Equations (150a)-(150b):
$$
u=a\sqrt{n_1^2k_0^2-\beta^2},\qquad w=a\sqrt{\beta^2-n_2^2k_0^2}.
$$
- Equation (151) gives the piecewise electric field with $J_\ell$ in the core and $K_\ell$ in the cladding.
- The coefficient $J_\ell(u)/K_\ell(w)$ makes the two electric-field expressions equal at $\rho=a$.
- Equation (152):
$$
|\langle\mathbf{S}\rangle|=\frac{1}{2\eta}|E_x|^2.$$
- Equations (153a)-(153b) give the core and cladding intensities proportional to $J_\ell^2\cos^2(\ell\phi)$ and $K_\ell^2\cos^2(\ell\phi)$.
- The source explains that increasing m permits larger u and more radial Bessel oscillations.

## Related Pages

- [[cylindrical-wave-equation-and-bessel-function-solutions|Cylindrical Wave Equation and Bessel-Function Solutions]]
- [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]
- [[lp-01-and-lp-11-intensity-profiles|LP_01 and LP_11 Intensity Profiles]]

## Concept Dependencies

- derives-from: [[cylindrical-wave-equation-and-bessel-function-solutions|Cylindrical Wave Equation and Bessel-Function Solutions]]
- applies-to: [[lp-01-and-lp-11-intensity-profiles|LP_01 and LP_11 Intensity Profiles]]
