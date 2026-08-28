---
title: "1.295 Cylindrical Wave Equation and Bessel-Function Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 513, Eqs. (144)-(146)", "Page 514, Eqs. (147)-(149)", "Page 515, Figure 13.22 and core-cladding solution assignment"]
related: ["weakly-guiding-step-index-fiber-and-lp-modes", "weak-guidance-fiber-fields-and-mode-intensity", "fiber-eigenvalue-equation-and-normalized-frequency"]
---

# 1.295 Cylindrical Wave Equation and Bessel-Function Solutions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 513, Eqs. (144)-(146), Page 514, Eqs. (147)-(149), Page 515, Figure 13.22 and core-cladding solution assignment

The weakly guiding fiber field is separated into radial, azimuthal, and longitudinal factors. Each mode has the form $R(\rho)\Phi(\phi)e^{-j\beta z}$ and independently satisfies the cylindrical wave equation. Separation introduces the constant $\ell^2$, producing an angular harmonic equation and a radial Bessel equation. Periodicity after a full $2\pi$ rotation forces $\ell$ to be an integer, and the angular dependence may be chosen as $\cos(\ell\phi)$. The radial behavior depends on $\beta_t=\sqrt{k^2-\beta^2}$. In the core, $\beta_{t1}$ is real and the physical oscillatory solution is the ordinary Bessel function $J_\ell$. In the cladding, $\beta_{t2}$ is imaginary and the physical decaying solution is the modified Bessel function $K_\ell$. Other mathematical solutions are rejected because they have nonphysical radial behavior. The listed zeros of $J_0$ and $J_1$ later determine LP-mode cutoff values.

## Page-Grounded Details

#### Page 513

The main result of the weak-guidance condition is that a set of modes appears in which each mode is linearly polarized. This means that light having x-polarization, for example, will enter the fiber and establish itself in a mode or in a set of modes that preserve the x-polarization. Magnetic field is essentially orthogonal to E, and so it would in that case lie in the y direction. The z components of both fields, although present, are too weak to be of significance; the nearly equal core and cladding indices lead to ray paths that are essentially parallel to the guide axis-deviating only slightly. In fact, we may write for a given mode, $E_{x}\doteq\eta H_{y}$, when $\eta$ is approximated as the intrinsic impedance of the cladding. Therefore, in the weak-guidance approximation, the fiber mode fields are treated as plane waves (nonuniform, of course). The designation for these modes is $\mathrm{LP}_{\ell m}$, meaning linearly polarized, with integer order parameters $\ell$ and $m$. The latter express the numbers of variations over the two dimensions in the circular transverse plane. Specifically, $\ell$, the azimuthal mode number, is one-half the number of power density

[Truncated for analysis]

#### Page 514

write separate equations for each side; the variables are now separated:
$$
\frac{d^{2}\Phi}{d\phi^{2}}+\ell^{2}\Phi=0\quad{(147a)}
$$
$$
\frac{d^{2}R}{d\rho^{2}}+\frac{1}{\rho}\frac{dR}{d\rho}+\left[k^{2}-\beta^{2}-\frac{\ell^{2}}{\rho^{2}}\right]R=0\quad{(147b)}
$$
The solution of (147a) is of the form of the sine or cosine of $\phi$:
$$
\Phi(\phi)=\begin{cases}\cos(\ell\phi+\alpha)\\\sin(\ell\phi+\alpha)\end{cases}\quad{(148)}
$$
where $\alpha$ is a constant. The form of (148) dictates that $\ell$ must be an integer, since the same mode field must occur in the transverse plane as $\phi$ is changed by $2\pi$ radians. Since the fiber is round, the orientation of the x and y axes in the transverse plane is immaterial, so we may choose the cosine function and set $\alpha=0$. We will thus use $\Phi(\phi)=\cos{(\ell\phi)}$.

The solution of (147b) to obtain the radial function is more complicated. Eq. (147b) is a form of Bessel's equation, whose solutions are Bessel functions of various forms. The key parameter is the function $\beta_{t}=(k^{2}-\beta^{2})^{1/2}$, the square of which appears in (147b). Note that $\beta_{t}$ will differ in the two regions: Within

[Truncated for analysis]

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

## Core Ideas

- A fiber mode separates as $R(\rho)\Phi(\phi)e^{-j\beta z}$.
- Variable separation produces angular and radial equations with constant $\ell^2$.
- Azimuthal periodicity requires integer $\ell$.
- The angular dependence can be chosen as $\cos(\ell\phi)$.
- The radial equation is a form of Bessel's equation.
- Core fields use oscillatory $J_\ell$ functions.
- Cladding fields use decaying $K_\ell$ functions.
- Zeros of ordinary Bessel functions determine modal cutoffs.

## Source Anchors

- Equation (144):
$$
E_x(\rho,\phi,z)=\sum_iR_i(\rho)\Phi_i(\phi)e^{-j\beta_i z}.
$$
- Equation (145) gives the scalar cylindrical wave equation for $E_x$.
- Equations (147a)-(147b) separate the angular harmonic equation from the radial Bessel equation.
- Equation (148):
$$
\Phi(\phi)=\cos(\ell\phi+\alpha)\ \text{or}\ \sin(\ell\phi+\alpha),
$$
with integer $\ell$ required by rotational periodicity.
- Equation (149):
$$
R(\rho)=AJ_\ell(\beta_t\rho)
$$
for real $\beta_t$, or
$$
R(\rho)=BK_\ell(|\beta_t|\rho)$$ for imaginary $\beta_t$.
- S1.P515.F1, Figure 13.22, plots $J_0$, $J_1$, $K_0$, and $K_1$.
- The listed $J_0$ zeros are 2.405, 5.520, 8.654, 11.792, and 14.931; the listed $J_1$ zeros are 0, 3.832, 7.016, 10.173, and 13.324.

## Related Pages

- [[weakly-guiding-step-index-fiber-and-lp-modes|Weakly Guiding Step-Index Fiber and LP Modes]]
- [[weak-guidance-fiber-fields-and-mode-intensity|Weak-Guidance Fiber Fields and Mode Intensity]]
- [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]

## Concept Dependencies

- enables: [[weak-guidance-fiber-fields-and-mode-intensity|Weak-Guidance Fiber Fields and Mode Intensity]]
- enables: [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]
