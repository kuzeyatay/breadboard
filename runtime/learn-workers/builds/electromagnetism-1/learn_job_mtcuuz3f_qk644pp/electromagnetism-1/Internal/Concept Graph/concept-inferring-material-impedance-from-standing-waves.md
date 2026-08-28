---
title: "Inferring Material Impedance from Standing Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "inferring-material-impedance-from-standing-waves"
locations: ["Page 431, Example 12.3 statement", "Page 432, Example 12.3 solution"]
related: ["standing-wave-ratio-and-extremum-locations", "reflection-and-transmission-coefficients", "boundary-conditions-require-a-reflected-wave"]
---

## ConceptNode: Inferring Material Impedance from Standing Waves

Planning node for [[inferring-material-impedance-from-standing-waves|1.250 Inferring Material Impedance from Standing Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 431, Example 12.3 statement, Page 432, Example 12.3 solution

Standing-wave measurements can determine the intrinsic impedance of an unknown material. The spacing between adjacent maxima or adjacent minima equals one half-wavelength, so it determines $\lambda$ and, in a known incident medium, the frequency or phase constant. The location of the first extremum relative to the interface reveals the phase of the reflection coefficient. A minimum at the interface indicates a real negative $\Gamma$, while a maximum indicates a real positive $\Gamma$ for the lossless cases discussed. The measured standing-wave ratio gives the reflection magnitude through $$|\Gamma|=\frac{s-1}{s+1}.$$ Example 12.3 measures 1.5 m between maxima, so $\lambda=3.0$ m and the air-wave frequency is 100 MHz. The first maximum lies $0.75$ m, or $\lambda/4$, from the interface, implying a boundary minimum and $\Gamma<0$. With $s=5$, $\Gamma=-2/3$, and solving the impedance relation gives $\eta_u=75.4\ \Omega$.

### Key planning details

- Adjacent maxima are separated by $\lambda/2$.
- Extremum position relative to the interface determines the reflection phase.
- A boundary minimum implies negative real $\Gamma$ in the stated lossless case.
- The SWR measurement gives $|\Gamma|=(s-1)/(s+1)$.
- The signed reflection coefficient is inserted into $\Gamma=(\eta_u-\eta_0)/(\eta_u+\eta_0)$.
- Solving the coefficient equation yields the unknown intrinsic impedance.

### Source coverage

- Example 12.3 reports a 1.5 m spacing between maxima.
- The inferred wavelength is 3.0 m and the inferred frequency is 100 MHz.
- The first maximum is 0.75 m from the interface, corresponding to $\lambda/4$.
- The measured standing-wave ratio is 5.
- The example obtains $|\Gamma|=2/3$ and assigns $\Gamma=-2/3$.
- The solved unknown impedance is $\eta_u=\eta_0/5=377/5=75.4\ \Omega$.
