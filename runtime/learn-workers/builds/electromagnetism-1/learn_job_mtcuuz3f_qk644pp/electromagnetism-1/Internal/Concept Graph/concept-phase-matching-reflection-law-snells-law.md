---
title: "Phase Matching, Reflection Law, and Snell's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "phase-matching-reflection-law-snells-law"
locations: ["Page 445", "Page 446", "Section 12.5: Plane Wave Reflection at Oblique Incidence Angles"]
related: ["wavevector-representation-general-plane-waves", "oblique-incidence-geometry-polarization", "polarization-dependent-fresnel-coefficients", "total-internal-reflection-critical-angle", "brewster-angle-total-transmission"]
---

## ConceptNode: Phase Matching, Reflection Law, and Snell's Law

Planning node for [[phase-matching-reflection-law-snells-law|1.261 Phase Matching, Reflection Law, and Snell's Law]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 445, Page 446, Section 12.5: Plane Wave Reflection at Oblique Incidence Angles

The laws governing reflected and refracted directions follow from tangential-field continuity everywhere on the interface. The incident, reflected, and transmitted fields carry phase factors based on their respective wavevectors. At the boundary $x=0$, the tangential electric-field condition must hold for every coordinate $z$ along the surface, while the field amplitudes themselves are constants. Therefore the spatial phase factors along the interface must be identical. This requires conservation of the tangential wavevector component: $k_1\sin\theta_1=k_1\sin\theta_1'=k_2\sin\theta_2$. Equality of the first two terms gives the law of reflection, $\theta_1'=\theta_1$. Equality across the two media gives Snell's law, $k_1\sin\theta_1=k_2\sin\theta_2$. For nonmagnetic dielectrics, $k=n\omega/c$, so this becomes $n_1\sin\theta_1=n_2\sin\theta_2$. The wavevector form is more general because it remains applicable when the media differ in permeability as well as permittivity. This derivation shows that refraction is not introduced as a geometric rule alone; it is forced by phase continuity along the entire interface.

### Key planning details

- Tangential electric-field continuity must hold at every point on the interface.
- The phase variation parallel to the interface must match for all participating waves.
- The reflected angle equals the incident angle: $\theta_1'=\theta_1$.
- Tangential wavevector conservation gives $k_1\sin\theta_1=k_2\sin\theta_2$.
- For nonmagnetic dielectrics, Snell's law is $n_1\sin\theta_1=n_2\sin\theta_2$.
- The $k$-based form supports media with differing relative permeabilities.

### Source coverage

- Equations (51) through (53) define incident, reflected, and transmitted field phasors.
- Equations (54) through (56) resolve the three wavevectors into normal and tangential components.
- Equation (61) applies tangential electric-field continuity at $x=0$.
- Page 446 states that the three phase terms must be equal because the boundary condition must hold for all $z$.
- Equation (62) gives $$k_1\sin\theta_1=k_2\sin\theta_2.$$
- Equation (63) gives $$n_1\sin\theta_1=n_2\sin\theta_2.$$
- Page 446 gives the more general magnitude $k=(\omega/c)\sqrt{\mu_r\epsilon_r}$.
