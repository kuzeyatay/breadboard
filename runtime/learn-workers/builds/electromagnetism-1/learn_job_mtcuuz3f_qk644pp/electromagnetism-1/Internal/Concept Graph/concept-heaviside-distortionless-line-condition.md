---
title: "Heaviside Distortionless-Line Condition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "heaviside-distortionless-line-condition"
locations: ["Page 330", "Page 331"]
related: ["low-loss-expansion-of-the-propagation-constant", "low-loss-approximation-for-characteristic-impedance", "attenuation-and-phase-in-a-lossy-line"]
---

## ConceptNode: Heaviside Distortionless-Line Condition

Planning node for [[heaviside-distortionless-line-condition|1.179 Heaviside Distortionless-Line Condition]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 330, Page 331

The low-loss phase correction depends on the difference between the normalized shunt and series loss terms. If $R/L=G/C$, known as Heaviside's condition, that difference vanishes. The phase constant then reduces to $\beta\doteq\omega\sqrt{LC}$, so $v_p=\omega/\beta$ is independent of frequency within the model. The group velocity $v_g=d\omega/d\beta$ is also constant, preventing the frequency-dependent delay mechanism described as distortion. Under the same condition, the approximate characteristic impedance becomes the real value $Z_0=\sqrt{L/C}$, as it does for a fully lossless line, even though $R$ and $G$ need not be zero. Distortionless behavior and low-loss behavior are therefore distinct: a line can retain attenuation while avoiding dispersion if its distributed loss ratios are balanced. The source cautions that practical line parameters can themselves depend on frequency, so low-loss and distortion-free conditions usually hold only over limited bands.

### Key planning details

- Heaviside's condition is $R/L=G/C$.
- Under this condition, $\beta\doteq\omega\sqrt{LC}$.
- Phase velocity becomes independent of frequency in the stated model.
- Group velocity is also frequency-independent.
- $Z_0$ simplifies to $\sqrt{L/C}$.
- Distortionless propagation can still include attenuation.
- Practical distortionless behavior is usually bandwidth-limited.

### Source coverage

- Page 330 names $R/L=G/C$ as Heaviside's condition.
- Equation (54b) loses its correction term when the two normalized loss ratios are equal.
- Page 331 states that Equation (56) reduces to $Z_0=\sqrt{L/C}$ under Heaviside's condition.
- The source notes additional complications from frequency dependence in $R$, $G$, $L$, and $C$.
