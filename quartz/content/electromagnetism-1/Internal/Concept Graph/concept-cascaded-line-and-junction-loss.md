---
title: "Cascaded Line and Junction Loss"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "cascaded-line-and-junction-loss"
locations: ["Page 336", "Page 337"]
related: ["decibel-characterization-of-transmission-loss", "power-reflection-and-load-absorption", "reflection-at-a-load-discontinuity"]
---

## ConceptNode: Cascaded Line and Junction Loss

Planning node for [[cascaded-line-and-junction-loss|1.185 Cascaded Line and Junction Loss]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 336, Page 337

A link containing lossy line segments and an impedance-discontinuous junction can be analyzed by converting every contribution to decibels and adding them. A junction with reflection coefficient $\Gamma$ transmits the power fraction $1-|\Gamma|^2$, so its mismatch loss is $$L_j=10\log_{10}\left(\frac{1}{1-|\Gamma|^2}\right).$$ Example 10.6 combines a $10$ m line rated at $0.20$ dB/m, a junction with $\Gamma=0.30$, and a $15$ m line rated at $0.10$ dB/m. The line losses are $2.0$ dB and $1.5$ dB, while the junction contributes $0.41$ dB, giving $3.91$ dB total. Applying the total loss to a $100$ mW input gives $P_{\text{out}}=100\times10^{-0.391}=41$ mW. This workflow demonstrates why logarithmic loss units are convenient for systems containing both distributed attenuation and localized mismatch.

### Key planning details

- Junction transmission fraction is $1-|\Gamma|^2$.
- Junction loss is $10\log_{10}[1/(1-|\Gamma|^2)]$.
- Distributed line loss is rating times length.
- All component losses add in decibels.
- Convert total dB loss back to power with $P_{\text{out}}=P_{\text{in}}10^{-L_{\mathrm{dB}}/10}$.

### Source coverage

- Example 10.6 uses line losses of $0.20$ dB/m over $10$ m and $0.10$ dB/m over $15$ m.
- The junction coefficient $\Gamma=0.30$ produces $0.41$ dB loss.
- The total calculated loss is $3.91$ dB.
- A $100$ mW input produces a $41$ mW output.
