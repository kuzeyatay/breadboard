---
title: "Characteristic Impedance and Wave Current Direction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "characteristic-impedance-and-wave-current-direction"
locations: ["Page 322", "Page 323", "Section 10.3: Lossless Propagation"]
related: ["telegraphists-equations", "lossless-traveling-wave-solutions", "physical-wavefront-propagation-on-a-transmission-line", "sinusoidal-phase-propagation-and-wavelength"]
---

## ConceptNode: Characteristic Impedance and Wave Current Direction

Planning node for [[characteristic-impedance-and-wave-current-direction|1.167 Characteristic Impedance and Wave Current Direction]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 322, Page 323, Section 10.3: Lossless Propagation

Under lossless conditions, the telegraphist's equations reduce to $\partial V/\partial z=-L\,\partial I/\partial t$ and $\partial I/\partial z=-C\,\partial V/\partial t$. Substituting the forward and backward voltage waves and integrating in time gives $$I(z,t)=\frac{1}{Lv}\left[f_1\left(t-\frac{z}{v}\right)-f_2\left(t+\frac{z}{v}\right)\right].$$ The factor that converts a single-wave current to voltage is the characteristic impedance: $$Z_0=Lv=\sqrt{\frac{L}{C}}.$$ Therefore, $V^+=Z_0I^+$ for a forward wave, while $V^-=-Z_0I^-$ for a backward wave. The negative sign does not imply negative voltage. It records the current-reference convention: forward and backward waves with the same positive voltage polarity carry currents in opposite physical directions.

### Key planning details

- Lossless voltage and current remain coupled by the first-order line equations.
- Forward-wave voltage and current satisfy $V^+=Z_0I^+$.
- Backward-wave voltage and current satisfy $V^-=-Z_0I^-$.
- Characteristic impedance is $Z_0=\sqrt{L/C}$.
- The backward-wave minus sign follows from the chosen positive-current direction.

### Source coverage

- Equations (20) and (21) on Page 322 are the lossless telegraphist's equations.
- Equations (22) and (23) derive current from the voltage traveling-wave functions.
- Equation (24) on Page 323 defines $Z_0=Lv=\sqrt{L/C}$.
- Equations (25a) and (25b) relate voltage and current for each propagation direction.
- Figure 10.4 on Page 323 shows current directions for forward and backward waves with positive voltage polarity.
