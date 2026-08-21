---
title: "Standing-Wave Voltage Extrema on a Lossless Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "standing-wave-voltage-extrema-on-a-lossless-line"
locations: ["Page 346", "Page 347"]
related: ["forward-and-reflected-voltage-reconstruction", "smith-chart-locations-of-voltage-extrema-and-vswr", "smith-chart-motion-along-a-lossless-line"]
---

## ConceptNode: Standing-Wave Voltage Extrema on a Lossless Line

Planning node for [[standing-wave-voltage-extrema-on-a-lossless-line|1.191 Standing-Wave Voltage Extrema on a Lossless Line]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 346, Page 347

The voltage standing wave is produced by interference between forward and reflected waves. If the load reflection coefficient is written as $\Gamma=|\Gamma|e^{j\phi}$, the voltage maxima occur at positions determined by the reflection phase and propagation constant. In the worked line, $\beta=0.8\pi$ and $\phi=\pi$, giving maxima at $z=-0.625$ m and $z=-1.875$ m. Voltage minima are one-quarter wavelength from adjacent maxima and occur at $z=0$ and $z=-1.25$ m. The load at $z=0$ is therefore a voltage minimum, consistent with the rule that a purely resistive load smaller than $Z_0$ produces a load-plane minimum, while a purely resistive load greater than $Z_0$ produces a load-plane maximum. With a minimum voltage of 20 V and VSWR $s=2$, the maximum is 40 V. The calculated input voltage, $38.5\angle-8.8^\circ$ V, lies close to that maximum because the line is nearly three-quarters of a wavelength long.

### Key planning details

- Write the load reflection coefficient as $\Gamma=|\Gamma|e^{j\phi}$.
- Voltage maxima satisfy $$z_{\max}=-\frac{\phi+2m\pi}{2\beta},\qquad m=0,1,2,\ldots$$
- Adjacent voltage maxima and minima are separated by $\lambda/4$.
- For pure resistances, $Z_L<Z_0$ places a voltage minimum at the load.
- For pure resistances, $Z_L>Z_0$ places a voltage maximum at the load.
- The VSWR gives $|V|_{\max}=s|V|_{\min}$.
- A line length near an odd multiple of $\lambda/4$ exchanges load-plane minima and input-plane maxima.

### Source coverage

- Page 346 gives $z_{\max}=-0.625$ m and $-1.875$ m for $\beta=0.8\pi$ and $\phi=\pi$.
- Page 346 gives voltage minima at $z=0$ and $z=-1.25$ m.
- Page 346 identifies the 20 V load voltage as the line minimum and obtains a 40 V maximum from $s=2$.
- Page 346 calculates $V_{s,\mathrm{in}}=(0.0756\angle15.0^\circ)(510\angle-23.8^\circ)=38.5\angle-8.8^\circ$ V.
- Page 346 states the load-plane extrema rule for purely resistive $Z_L$ and $Z_0$.
