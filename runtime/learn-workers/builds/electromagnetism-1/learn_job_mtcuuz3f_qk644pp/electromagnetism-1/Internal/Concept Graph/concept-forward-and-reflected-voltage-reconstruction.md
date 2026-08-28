---
title: "Forward and Reflected Voltage Reconstruction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "forward-and-reflected-voltage-reconstruction"
locations: ["Page 346", "Page 347"]
related: ["standing-wave-voltage-extrema-on-a-lossless-line", "complex-loads-mismatch-and-average-power", "multiple-reflections-and-transient-steady-state"]
---

## ConceptNode: Forward and Reflected Voltage Reconstruction

Planning node for [[forward-and-reflected-voltage-reconstruction|1.192 Forward and Reflected Voltage Reconstruction]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 346, Page 347

The total phasor voltage at any position on a lossless line is the sum of a forward wave and a reflected wave. The source expresses this as $$V_{sT}(z)=\left(e^{-j\beta z}+\Gamma e^{j\beta z}\right)V_0^+.$$ If the input voltage is known at $z=-l$, then substituting that position isolates the forward-wave amplitude $V_0^+$. In the worked example, the line has electrical length $\beta l=1.6\pi$, the reflection coefficient is $-1/3$, and the input voltage is $38.5\angle-8.8^\circ$ V. Solving gives $V_0^+=30.0\angle72.0^\circ$ V. At the load, $z=0$, so the propagation factors become unity and the load voltage is $(1+\Gamma)V_0^+=20\angle72^\circ$ V. This confirms the amplitude found independently from delivered power. It also shows why phase cannot be inferred from electrical length alone when a reflected wave is present: the total voltages at the input and load differ by about $-279^\circ$, rather than the $-288^\circ$ phase shift associated with a single traveling wave.

### Key planning details

- The total voltage is the phasor sum of incident and reflected waves.
- At the input, $$V_{s,\mathrm{in}}=\left(e^{j\beta l}+\Gamma e^{-j\beta l}\right)V_0^+.$$
- The incident-wave phasor follows from $$V_0^+=\frac{V_{s,\mathrm{in}}}{e^{j\beta l}+\Gamma e^{-j\beta l}}.$$
- At the load, $V_{s,L}=(1+\Gamma)V_0^+$.
- Reflections change both the magnitude and phase of the total voltage.
- The total-voltage phase difference is not generally equal to $-\beta l$.

### Source coverage

- Page 346 presents the total-voltage expression as Eq. (104).
- Page 346 applies the expression at $z=-l$ as Eq. (105).
- Page 346 obtains $V_0^+=30.0\angle72.0^\circ$ V.
- Page 347 obtains $V_{s,L}=20\angle72^\circ=20\angle-288^\circ$ V.
- Page 347 states that the input and load total voltages differ by about $-279^\circ$, not $-288^\circ$.
