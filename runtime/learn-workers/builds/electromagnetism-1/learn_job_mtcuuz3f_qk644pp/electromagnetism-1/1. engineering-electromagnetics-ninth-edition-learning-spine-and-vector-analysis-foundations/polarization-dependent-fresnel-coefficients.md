---
title: "1.262 Polarization-Dependent Fresnel Coefficients"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 446", "Page 447", "Page 448", "Section 12.5: Plane Wave Reflection at Oblique Incidence Angles", "Example 12.7"]
related: ["oblique-incidence-geometry-polarization", "phase-matching-reflection-law-snells-law", "total-internal-reflection-critical-angle", "brewster-angle-total-transmission"]
---

# 1.262 Polarization-Dependent Fresnel Coefficients

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 446, Page 447, Page 448, Section 12.5: Plane Wave Reflection at Oblique Incidence Angles, Example 12.7

At oblique incidence, the field components tangent to the interface depend on polarization and angle, so it is useful to define polarization-specific effective impedances. For p-polarization, the effective impedance is $\eta_p=\eta\cos\theta$. For s-polarization, it is $\eta_s=\eta\sec\theta$. With these definitions, the boundary equations take the same algebraic form as the normal-incidence impedance equations. The p-polarized reflection coefficient is $\Gamma_p=(\eta_{2p}-\eta_{1p})/(\eta_{2p}+\eta_{1p})$, while the s-polarized coefficient has the analogous form using $\eta_{1s}$ and $\eta_{2s}$. The transmission coefficients differ slightly because the p-polarized electric-field amplitude is not itself entirely tangent to the interface. In the air-to-glass example at $30^\circ$, Snell's law gives $\theta_2=20.2^\circ$. The reflected power fractions are 0.021 for p polarization and 0.049 for s polarization, demonstrating that polarization changes reflectivity. A negative reflection coefficient means that the reflected electric-field component parallel to the interface is reversed at the boundary. For a perfect conductor, $\eta_2=0$, so both coefficients equal $-1$ and total reflection occurs.

## Page-Grounded Details

#### Page 446

The boundary condition for a continuous tangential electric field now reads:
$$
E_{zs1}^{+}+E_{zs1}^{-}=E_{zs2}\quad(at\,x=0)
$$
We now substitute Eqs. (58) through (60) into (61) and evaluate the result at $x=0$ to obtain
$$
E_{10}^{+}\cos\theta_{1}\,e^{-jk_{1}z\sin\theta_{1}}+E_{10}^{-}\cos\theta_{1}^{\prime}e^{-jk_{1}z\sin\theta_{1}^{\prime}}=E_{20}\cos\theta_{2}e^{-jk_{2}z\sin\theta_{2}}\quad(61)
$$
Note that $E_{10}^{+}$, $E_{10}^{-}$, and $E_{20}$ are all constants (independent of $z$). Further, we require that (61) hold for all values of $z$ (everywhere on the interface). For this to occur, it must follow that all the phase terms appearing in (61) are equal. Specifically,
$$
k_{1}z\,\sin\theta_{1}=k_{1}z\,\sin\theta_{1}^{\prime}=k_{2}z\,\sin\theta_{2}
$$
From this, we see immediately that $\theta_{1}^{\prime}=\theta_{1}$, or the angle of reflection is equal to the angle of incidence. We also find that
$$
k_{1}\sin\theta_{1}=k_{2}\sin\theta_{2}\quad(62)
$$
Equation (62) is known as Snell's law of refraction. Because, in general, $k=n\omega/c$, we can rewrite (62) in terms of the refractive indices:
$$
n_{1}\sin\theta_{1}=n_{2}\sin\theta_{2}\quad(63) $

[Truncated for analysis]

#### Page 447

are defined through
$$
 \eta_{1p}=\eta_{1}\cos\theta_{1}\qquad(67)
$$
and
$$
 \eta_{2p}=\eta_{2}\cos\theta_{2}\qquad(68)
$$
Using this representation, Eqs. (65) and (66) are now in a form that enables them to be solved together for the ratios $E_{10}^{-}/E_{10}^{+}$ and $E_{20}/E_{10}^{+}$ . Performing analogous procedures to those used in solving (7) and (8), we find the reflection and transmission coefficients:
$$
 \Gamma_{p}=\frac{E_{10}^{-}}{E_{10}^{+}}=\frac{\eta_{2p}-\eta_{1p}}{\eta_{2p}+\eta_{1p}}\qquad(69)
$$
$$
 \tau_{p}=\frac{E_{20}}{E_{10}^{+}}=\frac{2\,\eta_{2p}}{\eta_{2p}+\eta_{1p}}(\frac{\cos\theta_{1}}{\cos\theta_{2}})\qquad(70)
$$
A similar procedure can be carried out for s-polarization, referring to Figure 12.7b. The details are left as an exercise; the results are
$$
 \Gamma_{s}=\frac{E_{y10}^{-}}{E_{y10}^{+}}=\frac{\eta_{2s}-\eta_{1s}}{\eta_{2s}+\eta_{1s}}\qquad(71)
$$
$$
 \tau_{s}=\frac{E_{y20}}{E_{y10}^{+}}=\frac{2\,\eta_{2s}}{\eta_{2s}+\eta_{1s}}\qquad(72)
$$
where the effective impedances for s-polarization are
$$
 \eta_{1s}=\eta_{1}\sec\theta_{1}\qquad(73)
$$
and
$$
 \eta_{2s}=\eta_{2}\sec\theta_{2}\qquad(74)
$$
Equations (67) through (74) are wha

[Truncated for analysis]

#### Page 448

Solution. First, we apply Snell's law to find the transmission angle. Using $n_{1}=1$ for air, we use (63) to find
$$
 \theta_{2}=\sin^{-1}\left(\frac{\sin 30}{1.45}\right)=20.2^{\circ}
$$
Now, for p-polarization:
$$
 \begin{align*}\eta_{1p}&=\eta_{1}\cos30=(377)\,(.866)=326\,\Omega\\\eta_{2p}&=\eta_{2}\cos20.2=\frac{377}{1.45}(.938)=244\,\Omega\end{align*}
$$
Then, using (69), we find
$$
 \Gamma_{p}=\frac{244-326}{244+326}=-0.144
$$
The fraction of the incident power that is reflected is
$$
 \frac{P_{r}}{P_{\rm inc}}=|\Gamma_{p}|^{2}=.021
$$
The transmitted fraction is then
$$
 \frac{P_{t}}{P_{\rm inc}}=1-|\Gamma_{p}|^{2}=.979
$$
For s-polarization, we have
$$
 \begin{align*}\eta_{1s}&=\eta_{1}\sec30=377/.866=435\,\Omega\\\eta_{2s}&=\eta_{2}\sec20.2=\frac{377}{1.45(.938)}=277\,\Omega\end{align*}
$$
Then, using (71):
$$
 \Gamma_{s}=\frac{277-435}{277+435}=-.222
$$
The reflected power fraction is thus
$$
 |\Gamma_{s}|^{2}=.049
$$
The fraction of the incident power that is transmitted is
$$
 1-|\Gamma_{s}|^{2}=.951 $$
In Example 12.7, reflection coefficient values for the two polarizations were found to be negative. The meaning of a negative reflection coefficient is that

[Truncated for analysis]

## Core Ideas

- For p polarization, $\eta_{1p}=\eta_1\cos\theta_1$ and $\eta_{2p}=\eta_2\cos\theta_2$.
- For s polarization, $\eta_{1s}=\eta_1\sec\theta_1$ and $\eta_{2s}=\eta_2\sec\theta_2$.
- The p reflection coefficient is $\Gamma_p=(\eta_{2p}-\eta_{1p})/(\eta_{2p}+\eta_{1p})$.
- The s reflection coefficient is $\Gamma_s=(\eta_{2s}-\eta_{1s})/(\eta_{2s}+\eta_{1s})$.
- Power reflection is $|\Gamma|^2$ for either polarization.
- A negative coefficient indicates reversal of the tangential reflected electric-field component.
- A perfect conductor gives $\Gamma_p=\Gamma_s=-1$.

## Source Anchors

- Equations (67) and (68) define $\eta_{1p}=\eta_1\cos\theta_1$ and $\eta_{2p}=\eta_2\cos\theta_2$.
- Equations (69) and (70) give $\Gamma_p$ and $\tau_p$.
- Equations (71) through (74) give $\Gamma_s$, $\tau_s$, and the s-polarized effective impedances.
- The air-to-glass example uses $n_2=1.45$ and obtains $\theta_2=20.2^\circ$.
- For p polarization, the example obtains $\Gamma_p=-0.144$, reflected fraction 0.021, and transmitted fraction 0.979.
- For s polarization, the example obtains $\Gamma_s=-0.222$, reflected fraction 0.049, and transmitted fraction 0.951.
- Page 448 states that a perfect conductor produces $\Gamma_p=\Gamma_s=-1$ at every angle.

## Related Pages

- [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
- [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- [[total-internal-reflection-critical-angle|Total Internal Reflection and Critical Angle]]
- [[brewster-angle-total-transmission|Brewster-Angle Total Transmission]]

## Concept Dependencies

- depends-on: [[phase-matching-reflection-law-snells-law|Phase Matching, Reflection Law, and Snell's Law]]
- depends-on: [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
