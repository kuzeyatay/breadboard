---
title: "Brewster-Angle Total Transmission"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "brewster-angle-total-transmission"
locations: ["Page 451", "Page 452", "Page 453", "Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves", "Example 12.9", "Exercise D12.5"]
related: ["oblique-incidence-geometry-polarization", "phase-matching-reflection-law-snells-law", "polarization-dependent-fresnel-coefficients", "total-internal-reflection-critical-angle"]
---

## ConceptNode: Brewster-Angle Total Transmission

Planning node for [[brewster-angle-total-transmission|1.264 Brewster-Angle Total Transmission]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 451, Page 452, Page 453, Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves, Example 12.9, Exercise D12.5

A single dielectric interface can produce total transmission at a special angle, but only for p-polarized incidence. Setting the s-polarized reflection coefficient to zero would require equality of the two s-polarized effective impedances, and the source concludes that no incidence angle satisfies this condition for the stated dielectric case. For p polarization, setting $\Gamma_p=0$ yields a solvable matching condition. Using $\eta=\eta_0/n$ and Snell's law gives $\sin\theta_B=n_2/\sqrt{n_1^2+n_2^2}$. This Brewster angle is also called the polarization angle. When unpolarized or mixed-polarization light arrives at this angle, its p component is completely transmitted while the reflected light contains only the s component. Near the exact angle, reflected light remains predominantly s-polarized, which explains the polarization of glare from horizontal surfaces and the operation described for glare-reducing sunglasses. For air-to-glass transmission with $n_2=1.45$, the source obtains $\theta_B=55.4^\circ$ and a transmitted angle of $34.6^\circ$. These angles sum to $90^\circ$. Figure 12.10 shows the Brewster zero crossings for $\Gamma_p$ and the absence of such crossings for $\Gamma_s$.

### Key planning details

- Total transmission at one dielectric interface requires $\Gamma=0$.
- No corresponding total-transmission angle exists for s polarization in the stated case.
- The p-polarized Brewster condition is $\sin\theta_B=n_2/\sqrt{n_1^2+n_2^2}$.
- At $\theta_B$, the p component is fully transmitted.
- The reflected light at the Brewster angle is entirely s-polarized.
- The Brewster incident and refracted angles sum to $90^\circ$.
- Polarizing sunglasses suppress predominantly horizontal reflected glare.

### Source coverage

- Equation (79) gives $$\sin\theta_B=\frac{n_2}{\sqrt{n_1^2+n_2^2}}.$$
- Page 451 states that the s-polarized zero-reflection condition has no angle solution.
- Page 451 explains why mixed-polarization light reflected at the Brewster angle is entirely s-polarized.
- The air-to-glass example obtains $\theta_B=55.4^\circ$ and $\theta_2=34.6^\circ$.
- Page 452 notes that the incident and refracted angles at the Brewster condition sum to $90^\circ$.
- Figure S1.P453.F1, corresponding to Figure 12.10, plots $\Gamma_p$ and $\Gamma_s$ against incidence angle for several index ratios.
- Exercise D12.5 gives the s-polarized reflection coefficient $-0.355$ for the Brewster-angle example.
