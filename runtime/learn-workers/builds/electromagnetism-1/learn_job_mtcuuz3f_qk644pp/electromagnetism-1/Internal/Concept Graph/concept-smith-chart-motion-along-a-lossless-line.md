---
title: "Smith Chart Motion Along a Lossless Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "smith-chart-motion-along-a-lossless-line"
locations: ["Page 352", "Page 353", "Page 354", "Page 355"]
related: ["reading-reflection-coefficient-from-the-smith-chart", "smith-chart-locations-of-voltage-extrema-and-vswr", "slotted-line-determination-of-an-unknown-load", "smith-chart-impedance-and-reflection-coefficient-mapping"]
---

## ConceptNode: Smith Chart Motion Along a Lossless Line

Planning node for [[smith-chart-motion-along-a-lossless-line|1.197 Smith Chart Motion Along a Lossless Line]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 352, Page 353, Page 354, Page 355

Dividing the total line voltage by $Z_0$ times the total current gives the normalized input impedance. At a distance $l$ toward the generator from the load, the result is $$z_{\mathrm{in}}=\frac{1+\Gamma e^{-j2\beta l}}{1-\Gamma e^{-j2\beta l}}=\frac{1+|\Gamma|e^{j(\phi-2\beta l)}}{1-|\Gamma|e^{j(\phi-2\beta l)}}.$$ Moving along a lossless line therefore rotates the reflection coefficient without changing its magnitude. Travel toward the generator decreases the reflection angle, so it is represented by clockwise movement on a constant-$|\Gamma|$ circle. A full revolution occurs for $l=\lambda/2$, which expresses the half-wavelength periodicity of input impedance. Example 10.10 starts from $z_L=0.5+j1$ at a wavelengths-toward-generator reading of 0.135. Adding $l/\lambda=0.300$ gives 0.435, where the chart reads $z_{\mathrm{in}}=0.28-j0.40$. Thus $Z_{\mathrm{in}}=14-j20\ \Omega$, close to the analytical value $13.7-j20.2\ \Omega$.

### Key planning details

- Use $$z_{\mathrm{in}}=\frac{1+\Gamma e^{-j2\beta l}}{1-\Gamma e^{-j2\beta l}}.$$
- Moving toward the generator replaces $\Gamma$ by $\Gamma e^{-j2\beta l}$.
- Lossless-line movement preserves $|\Gamma|$.
- Toward-generator travel is clockwise on the Smith chart.
- One complete Smith chart revolution corresponds to $\lambda/2$.
- Wavelength-scale readings wrap modulo 0.5.
- Denormalize with $Z_{\mathrm{in}}=Z_0z_{\mathrm{in}}$.

### Source coverage

- Pages 352 and 353 derive normalized input impedance from the traveling-wave voltage and current.
- Page 353 gives the transformation as Eq. (114).
- Page 353 states that only the angle of $\Gamma$ changes along a lossless line.
- Page 353 identifies clockwise travel as movement toward the generator.
- Source figure S1.P354.F1, Figure 10.13, supplies clockwise and counterclockwise wavelength scales.
- Pages 353 and 355, with source figure S1.P355.F1, Figure 10.14, transform $z_L=0.5+j1$ through $0.3\lambda$ to approximately $z_{\mathrm{in}}=0.28-j0.40$.
