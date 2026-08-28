---
title: "1.261 Phase Matching, Reflection Law, and Snell's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 445", "Page 446", "Section 12.5: Plane Wave Reflection at Oblique Incidence Angles"]
related: ["wavevector-representation-general-plane-waves", "oblique-incidence-geometry-polarization", "polarization-dependent-fresnel-coefficients", "total-internal-reflection-critical-angle", "brewster-angle-total-transmission"]
---

# 1.261 Phase Matching, Reflection Law, and Snell's Law

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 445, Page 446, Section 12.5: Plane Wave Reflection at Oblique Incidence Angles

The laws governing reflected and refracted directions follow from tangential-field continuity everywhere on the interface. The incident, reflected, and transmitted fields carry phase factors based on their respective wavevectors. At the boundary $x=0$, the tangential electric-field condition must hold for every coordinate $z$ along the surface, while the field amplitudes themselves are constants. Therefore the spatial phase factors along the interface must be identical. This requires conservation of the tangential wavevector component: $k_1\sin\theta_1=k_1\sin\theta_1'=k_2\sin\theta_2$. Equality of the first two terms gives the law of reflection, $\theta_1'=\theta_1$. Equality across the two media gives Snell's law, $k_1\sin\theta_1=k_2\sin\theta_2$. For nonmagnetic dielectrics, $k=n\omega/c$, so this becomes $n_1\sin\theta_1=n_2\sin\theta_2$. The wavevector form is more general because it remains applicable when the media differ in permeability as well as permittivity. This derivation shows that refraction is not introduced as a geometric rule alone; it is forced by phase continuity along the entire interface.

## Page-Grounded Details

#### Page 445

Because E is used to define polarization, the configuration is called perpendicular polarization, or is said to be s-polarized.^3 E is also parallel to the interface, and so the case is also called transverse electric, or TE polarization. We will find that the reflec-tion and transmission coefficients will differ for the two polarization types, but that reflection and transmission angles will not depend on polarization. We only need to consider s- and p-polarizations because any other field direction can be constructed as some combination of s and p waves.

Our desired knowledge of reflection and transmission coefficients, as well as how the angles relate, can be found through the field boundary conditions at the interface. Specifically, we require that the transverse components of E and H be continuous across the interface. These were the conditions we used to find $\Gamma$ and $\tau$ for normal incidence ($\theta_{1}=0$), which is in fact a special case of our current problem.We will consider the case of p-polarization (Figure 12.7a) first. To begin, we write down the incident, reflected, and transmitted fields in phasor form, using the notation developed in Section 12.4:

[Truncated for analysis]

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

## Core Ideas

- Tangential electric-field continuity must hold at every point on the interface.
- The phase variation parallel to the interface must match for all participating waves.
- The reflected angle equals the incident angle: $\theta_1'=\theta_1$.
- Tangential wavevector conservation gives $k_1\sin\theta_1=k_2\sin\theta_2$.
- For nonmagnetic dielectrics, Snell's law is $n_1\sin\theta_1=n_2\sin\theta_2$.
- The $k$-based form supports media with differing relative permeabilities.

## Source Anchors

- Equations (51) through (53) define incident, reflected, and transmitted field phasors.
- Equations (54) through (56) resolve the three wavevectors into normal and tangential components.
- Equation (61) applies tangential electric-field continuity at $x=0$.
- Page 446 states that the three phase terms must be equal because the boundary condition must hold for all $z$.
- Equation (62) gives
$$
k_1\sin\theta_1=k_2\sin\theta_2.
$$
- Equation (63) gives
$$
n_1\sin\theta_1=n_2\sin\theta_2.$$
- Page 446 gives the more general magnitude $k=(\omega/c)\sqrt{\mu_r\epsilon_r}$.

## Related Pages

- [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
- [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
- [[polarization-dependent-fresnel-coefficients|Polarization-Dependent Fresnel Coefficients]]
- [[total-internal-reflection-critical-angle|Total Internal Reflection and Critical Angle]]
- [[brewster-angle-total-transmission|Brewster-Angle Total Transmission]]

## Concept Dependencies

- depends-on: [[wavevector-representation-general-plane-waves|Wavevector Representation of General Plane Waves]]
- depends-on: [[oblique-incidence-geometry-polarization|Oblique-Incidence Geometry and Polarization]]
