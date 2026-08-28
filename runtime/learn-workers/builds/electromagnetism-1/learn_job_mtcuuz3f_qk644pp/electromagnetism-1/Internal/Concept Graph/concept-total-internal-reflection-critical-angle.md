---
title: "Total Internal Reflection and Critical Angle"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "total-internal-reflection-critical-angle"
locations: ["Page 449", "Page 450", "Page 451", "Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves", "Example 12.8"]
related: ["phase-matching-reflection-law-snells-law", "polarization-dependent-fresnel-coefficients", "oblique-incidence-geometry-polarization", "brewster-angle-total-transmission"]
---

## ConceptNode: Total Internal Reflection and Critical Angle

Planning node for [[total-internal-reflection-critical-angle|1.263 Total Internal Reflection and Critical Angle]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 449, Page 450, Page 451, Section 12.6: Total Reflection and Total Transmission of Obliquely Incident Waves, Example 12.8

Total internal reflection occurs when a wave travels from a higher-index medium toward a lower-index medium at a sufficiently large incidence angle. Snell's law gives $\cos\theta_2=[1-(n_1/n_2)^2\sin^2\theta_1]^{1/2}$. When $\sin\theta_1>n_2/n_1$, this quantity becomes imaginary, as do the polarization-dependent effective impedances in the second medium. Substitution into the reflection formulas produces a complex reflection coefficient with unit magnitude, so all incident power is reflected even though the coefficient may carry a nontrivial phase. The threshold is the critical angle, defined by $\sin\theta_c=n_2/n_1$, and total reflection occurs for $\theta_1\geq\theta_c$. This condition requires $n_1>n_2$. Example 12.8 applies the rule to a prism that turns a beam through $90^\circ$ using a $45^\circ$ internal incidence angle. With air outside, the prism requires $n_1\geq\sqrt{2}=1.41$, so fused silica with index 1.45 is suitable. The same mechanism confines light in slab and optical-fiber waveguides by placing a higher-index core between lower-index cladding regions.

### Key planning details

- Total reflection requires $|\Gamma|^2=1$.
- The condition is $\sin\theta_1\geq n_2/n_1$.
- The critical angle satisfies $\sin\theta_c=n_2/n_1$.
- Total internal reflection occurs for $\theta_1\geq\theta_c$.
- The incident medium must have the higher refractive index: $n_1>n_2$.
- Above the critical angle, the transmitted-angle cosine and effective impedance become imaginary.
- Prisms and dielectric waveguides use total internal reflection.

### Source coverage

- Equation (75) gives $$\cos\theta_2=\left[1-\left(\frac{n_1}{n_2}\right)^2\sin^2\theta_1\right]^{1/2}.$$
- Equation (76) gives the total-reflection condition $\sin\theta_1\geq n_2/n_1$.
- Equation (77) defines $\sin\theta_c=n_2/n_1$.
- Equation (78) states $\theta_1\geq\theta_c$ for total reflection.
- Figure S1.P450.F1, corresponding to Figure 12.8, shows the 90-degree beam-steering prism.
- Example 12.8 obtains a minimum prism index of $\sqrt{2}=1.41$ and identifies fused silica at 1.45 as suitable.
- Figure S1.P451.F1, corresponding to Figure 12.9, shows confinement in a symmetric dielectric slab waveguide.
