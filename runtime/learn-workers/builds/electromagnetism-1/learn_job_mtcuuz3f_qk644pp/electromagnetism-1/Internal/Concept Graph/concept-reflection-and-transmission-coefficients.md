---
title: "Reflection and Transmission Coefficients"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "reflection-and-transmission-coefficients"
locations: ["Page 424, Equations (9) and (10)"]
related: ["boundary-conditions-require-a-reflected-wave", "power-reflectivity-and-conservation", "standing-wave-ratio-and-extremum-locations", "inferring-material-impedance-from-standing-waves", "total-reflection-from-a-perfect-conductor", "multiple-interface-reflection"]
---

## ConceptNode: Reflection and Transmission Coefficients

Planning node for [[reflection-and-transmission-coefficients|1.246 Reflection and Transmission Coefficients]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 424, Equations (9) and (10)

Solving the two tangential boundary equations gives amplitude ratios determined entirely by the intrinsic impedances on the two sides of the interface. The electric-field reflection coefficient is $$\Gamma=\frac{E_{x10}^{-}}{E_{x10}^{+}}=\frac{\eta_2-\eta_1}{\eta_2+\eta_1}=|\Gamma|e^{j\phi_r}.$$ Its magnitude gives the reflected electric-field amplitude relative to the incident amplitude, while its phase $\phi_r$ gives the phase change on reflection. The electric-field transmission coefficient is $$\tau=\frac{E_{x20}^{+}}{E_{x10}^{+}}=\frac{2\eta_2}{\eta_1+\eta_2}=1+\Gamma=|\tau|e^{j\phi_t}.$$ If either impedance is complex, both coefficients can be complex. These field-amplitude coefficients have the same mathematical interpretation as the coefficients previously derived for transmission lines. They are the starting point for determining reflected and transmitted fields, power fractions, standing-wave amplitudes, and the consequences of impedance matching.

### Key planning details

- $\Gamma$ is the reflected-to-incident electric-field amplitude ratio.
- $\Gamma=(\eta_2-\eta_1)/(\eta_2+\eta_1)$.
- A complex $\Gamma$ includes a reflection phase shift.
- $\tau$ is the transmitted-to-incident electric-field amplitude ratio.
- $\tau=2\eta_2/(\eta_1+\eta_2)$.
- The boundary equations imply $\tau=1+\Gamma$.
- Equal impedances give $\Gamma=0$ and eliminate reflection.

### Source coverage

- Equation (9) defines $\Gamma=(\eta_2-\eta_1)/(\eta_2+\eta_1)=|\Gamma|e^{j\phi_r}$.
- The text notes that complex intrinsic impedances produce a complex reflection coefficient.
- Equation (10) defines $\tau=2\eta_2/(\eta_1+\eta_2)=1+\Gamma$.
- The forms are identified as consistent with transmission-line reflection and transmission coefficients.
