---
title: "1.246 Reflection and Transmission Coefficients"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 424, Equations (9) and (10)"]
related: ["boundary-conditions-require-a-reflected-wave", "power-reflectivity-and-conservation", "standing-wave-ratio-and-extremum-locations", "inferring-material-impedance-from-standing-waves", "total-reflection-from-a-perfect-conductor", "multiple-interface-reflection"]
---

# 1.246 Reflection and Transmission Coefficients

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 424, Equations (9) and (10)

Solving the two tangential boundary equations gives amplitude ratios determined entirely by the intrinsic impedances on the two sides of the interface. The electric-field reflection coefficient is
$$
\Gamma=\frac{E_{x10}^{-}}{E_{x10}^{+}}=\frac{\eta_2-\eta_1}{\eta_2+\eta_1}=|\Gamma|e^{j\phi_r}
$$
 Its magnitude gives the reflected electric-field amplitude relative to the incident amplitude, while its phase $\phi_r$ gives the phase change on reflection. The electric-field transmission coefficient is
$$
\tau=\frac{E_{x20}^{+}}{E_{x10}^{+}}=\frac{2\eta_2}{\eta_1+\eta_2}=1+\Gamma=|\tau|e^{j\phi_t}
$$
 If either impedance is complex, both coefficients can be complex. These field-amplitude coefficients have the same mathematical interpretation as the coefficients previously derived for transmission lines. They are the starting point for determining reflected and transmitted fields, power fractions, standing-wave amplitudes, and the consequences of impedance matching.

## Page-Grounded Details

#### Page 424

Solving (8) for $E_{x20}^{+}$ and substituting into (7), we find
$$
E_{x10}^{+}+E_{x10}^{-}=\frac{\eta_{2}}{\eta_{1}}E_{x10}^{+}-\frac{\eta_{2}}{\eta_{1}}E_{x10}^{-}
$$
or
$$
E_{x10}^{-}= E_{x10}^{+}\frac{\eta_{2}-\eta_{1}}{\eta_{2}+\eta_{1}}
$$
The ratio of the amplitudes of the reflected and incident electric fields defines the reflection coefficient, designated by $\Gamma$,
$$
\Gamma=\frac{E_{x10}^{-}}{E_{x10}^{+}}=\frac{\eta_{2}-\eta_{1}}{\eta_{2}+\eta_{1}}=|\Gamma|e^{j\phi_{r}}\quad{(9)}
$$
It is evident that as $\eta_{1}$ or $\eta_{2}$ may be complex, $\Gamma$ will also be complex, and so we include a reflective phase shift, $\phi_{r}$. The interpretation of Eq. (9) is identical to that used with transmission lines [Eq. (73), Chapter 10].

The relative amplitude of the transmitted electric field intensity is found by combining (9) and (7) to yield the transmission coefficient, $\tau$,
$$
\tau=\frac{E_{x20}^{+}}{E_{x10}^{+}}=\frac{2\eta_{2}}{\eta_{1}+\eta_{2}}=1+\Gamma=|\tau|e^{j\phi_{t}}\quad{(10)}
$$
whose form and interpretation are consistent with the usage in transmission lines [Eq. (75), Chapter 10].

#### 12.1.3 Total Reflection: Standing Wave Rati

[Truncated for analysis]

## Core Ideas

- $\Gamma$ is the reflected-to-incident electric-field amplitude ratio.
- $\Gamma=(\eta_2-\eta_1)/(\eta_2+\eta_1)$.
- A complex $\Gamma$ includes a reflection phase shift.
- $\tau$ is the transmitted-to-incident electric-field amplitude ratio.
- $\tau=2\eta_2/(\eta_1+\eta_2)$.
- The boundary equations imply $\tau=1+\Gamma$.
- Equal impedances give $\Gamma=0$ and eliminate reflection.

## Source Anchors

- Equation (9) defines $\Gamma=(\eta_2-\eta_1)/(\eta_2+\eta_1)=|\Gamma|e^{j\phi_r}$.
- The text notes that complex intrinsic impedances produce a complex reflection coefficient.
- Equation (10) defines $\tau=2\eta_2/(\eta_1+\eta_2)=1+\Gamma$.
- The forms are identified as consistent with transmission-line reflection and transmission coefficients.

## Related Pages

- [[boundary-conditions-require-a-reflected-wave|Boundary Conditions Require a Reflected Wave]]
- [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]
- [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
- [[inferring-material-impedance-from-standing-waves|Inferring Material Impedance from Standing Waves]]
- [[total-reflection-from-a-perfect-conductor|Total Reflection from a Perfect Conductor]]
- [[multiple-interface-reflection|Multiple-Interface Reflection]]

## Concept Dependencies

- applies-to: [[total-reflection-from-a-perfect-conductor|Total Reflection from a Perfect Conductor]]
- enables: [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]
- causes: [[standing-wave-ratio-and-extremum-locations|Standing-Wave Ratio and Extremum Locations]]
- measured-by: [[inferring-material-impedance-from-standing-waves|Inferring Material Impedance from Standing Waves]]
- applies-to: [[multiple-interface-reflection|Multiple-Interface Reflection]]
