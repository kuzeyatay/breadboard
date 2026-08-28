---
title: "Smith Chart Impedance and Reflection-Coefficient Mapping"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "smith-chart-impedance-and-reflection-coefficient-mapping"
locations: ["Page 348", "Page 349"]
related: ["constant-resistance-and-constant-reactance-circles", "reading-reflection-coefficient-from-the-smith-chart", "smith-chart-motion-along-a-lossless-line"]
---

## ConceptNode: Smith Chart Impedance and Reflection-Coefficient Mapping

Planning node for [[smith-chart-impedance-and-reflection-coefficient-mapping|1.194 Smith Chart Impedance and Reflection-Coefficient Mapping]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 348, Page 349

The Smith chart reduces repeated complex-number calculations by representing normalized impedance through the reflection coefficient plane. Its polar coordinates are $|\Gamma|$ and the reflection phase $\phi$, while its rectangular coordinates are $\Gamma_r$ and $\Gamma_i$. Passive loads lie on or within the unit circle because $|\Gamma|\leq1$. The construction begins with $$\Gamma=\frac{Z_L-Z_0}{Z_L+Z_0}.$$ Normalizing the load as $z_L=Z_L/Z_0=r+jx$ removes the particular characteristic impedance and produces $$\Gamma=\frac{z_L-1}{z_L+1},\qquad z_L=\frac{1+\Gamma}{1-\Gamma}.$$ This bilinear transformation maps impedance values into the bounded reflection-coefficient disk. Figure 10.9 establishes the coordinate systems and the $|\Gamma|=1$ boundary. Although reflection-coefficient contours are not drawn directly because they would clutter the chart, magnitude is found by radial distance and phase by the counterclockwise angle from the positive $\Gamma_r$ axis.

### Key planning details

- Normalize impedance using $z_L=Z_L/Z_0=r+jx$.
- Use $$\Gamma=\frac{z_L-1}{z_L+1}$$ to map normalized impedance to reflection coefficient.
- Use $$z_L=\frac{1+\Gamma}{1-\Gamma}$$ for the inverse transformation.
- The radial coordinate is $|\Gamma|$.
- The angular coordinate is $\phi$ in $\Gamma=|\Gamma|e^{j\phi}$.
- The rectangular chart coordinates are $\Gamma_r$ and $\Gamma_i$.
- Passive-load information lies inside or on $|\Gamma|=1$.

### Source coverage

- Page 348 introduces the Smith chart as a graphical method for complex transmission-line calculations.
- Source figure S1.P349.F1, Figure 10.9, identifies polar and rectangular reflection-coefficient coordinates and the unit-circle boundary.
- Page 349 gives $\Gamma=(Z_L-Z_0)/(Z_L+Z_0)$ as Eq. (106).
- Page 349 defines $z_L=r+jx=Z_L/Z_0$.
- Page 349 gives the normalized forward and inverse mappings, including Eq. (107).
- Page 349 explains that explicit reflection-coefficient contours are omitted to preserve readability.
