---
title: "Polarization-Dependent Fresnel Coefficients"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "polarization-dependent-fresnel-coefficients"
locations: ["Page 446", "Page 447", "Page 448", "Section 12.5: Plane Wave Reflection at Oblique Incidence Angles", "Example 12.7"]
related: ["oblique-incidence-geometry-polarization", "phase-matching-reflection-law-snells-law", "total-internal-reflection-critical-angle", "brewster-angle-total-transmission"]
---

## ConceptNode: Polarization-Dependent Fresnel Coefficients

Planning node for [[polarization-dependent-fresnel-coefficients|1.262 Polarization-Dependent Fresnel Coefficients]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 446, Page 447, Page 448, Section 12.5: Plane Wave Reflection at Oblique Incidence Angles, Example 12.7

At oblique incidence, the field components tangent to the interface depend on polarization and angle, so it is useful to define polarization-specific effective impedances. For p-polarization, the effective impedance is $\eta_p=\eta\cos\theta$. For s-polarization, it is $\eta_s=\eta\sec\theta$. With these definitions, the boundary equations take the same algebraic form as the normal-incidence impedance equations. The p-polarized reflection coefficient is $\Gamma_p=(\eta_{2p}-\eta_{1p})/(\eta_{2p}+\eta_{1p})$, while the s-polarized coefficient has the analogous form using $\eta_{1s}$ and $\eta_{2s}$. The transmission coefficients differ slightly because the p-polarized electric-field amplitude is not itself entirely tangent to the interface. In the air-to-glass example at $30^\circ$, Snell's law gives $\theta_2=20.2^\circ$. The reflected power fractions are 0.021 for p polarization and 0.049 for s polarization, demonstrating that polarization changes reflectivity. A negative reflection coefficient means that the reflected electric-field component parallel to the interface is reversed at the boundary. For a perfect conductor, $\eta_2=0$, so both coefficients equal $-1$ and total reflection occurs.

### Key planning details

- For p polarization, $\eta_{1p}=\eta_1\cos\theta_1$ and $\eta_{2p}=\eta_2\cos\theta_2$.
- For s polarization, $\eta_{1s}=\eta_1\sec\theta_1$ and $\eta_{2s}=\eta_2\sec\theta_2$.
- The p reflection coefficient is $\Gamma_p=(\eta_{2p}-\eta_{1p})/(\eta_{2p}+\eta_{1p})$.
- The s reflection coefficient is $\Gamma_s=(\eta_{2s}-\eta_{1s})/(\eta_{2s}+\eta_{1s})$.
- Power reflection is $|\Gamma|^2$ for either polarization.
- A negative coefficient indicates reversal of the tangential reflected electric-field component.
- A perfect conductor gives $\Gamma_p=\Gamma_s=-1$.

### Source coverage

- Equations (67) and (68) define $\eta_{1p}=\eta_1\cos\theta_1$ and $\eta_{2p}=\eta_2\cos\theta_2$.
- Equations (69) and (70) give $\Gamma_p$ and $\tau_p$.
- Equations (71) through (74) give $\Gamma_s$, $\tau_s$, and the s-polarized effective impedances.
- The air-to-glass example uses $n_2=1.45$ and obtains $\theta_2=20.2^\circ$.
- For p polarization, the example obtains $\Gamma_p=-0.144$, reflected fraction 0.021, and transmitted fraction 0.979.
- For s polarization, the example obtains $\Gamma_s=-0.222$, reflected fraction 0.049, and transmitted fraction 0.951.
- Page 448 states that a perfect conductor produces $\Gamma_p=\Gamma_s=-1$ at every angle.
