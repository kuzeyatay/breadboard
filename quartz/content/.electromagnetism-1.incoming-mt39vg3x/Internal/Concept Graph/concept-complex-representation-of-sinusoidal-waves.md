---
title: "Complex Representation of Sinusoidal Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "complex-representation-of-sinusoidal-waves"
locations: ["Page 325", "Page 326"]
related: ["constant-phase-criterion-for-wave-direction", "complex-instantaneous-voltage-and-phasor-voltage", "standing-wave-from-oppositely-directed-waves"]
---

## ConceptNode: Complex Representation of Sinusoidal Waves

Planning node for [[complex-representation-of-sinusoidal-waves|1.170 Complex Representation of Sinusoidal Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 325, Page 326

Euler's identity converts sinusoidal functions into complex exponentials, making accumulated phase and the combination of same-frequency waves easier to analyze. The identity $e^{\pm jx}=\cos x\pm j\sin x$ implies that cosine is the real part and sine is the appropriately signed imaginary part of a complex exponential. It also gives exponential decompositions such as $\cos x=\tfrac12(e^{jx}+e^{-jx})$. The symbol $j=\sqrt{-1}$ is used, and the complex conjugate is formed by reversing the sign of every occurrence of $j$. A real voltage wave $|V_0|\cos(\omega t\pm\beta z+\phi)$ can therefore be represented using a complex amplitude $V_0=|V_0|e^{j\phi}$. This complex amplitude stores magnitude and initial phase in one quantity. The real physical wave is recovered only after the complex expression has been multiplied by any required time factor and its real part has been taken.

### Key planning details

- Euler's identity is $e^{\pm jx}=\cos x\pm j\sin x$.
- Cosine can be written as $\cos x=\tfrac12(e^{jx}+e^{-jx})$.
- The notation c.c. denotes the complex conjugate of the preceding term.
- The complex amplitude is $V_0=|V_0|e^{j\phi}$.
- Magnitude and phase are encoded together in a complex amplitude.
- The physical sinusoid is obtained by taking the real part.

### Source coverage

- Equation (32) states the Euler identity.
- Equations (33a) and (33b) express cosine and sine using complex exponentials.
- Equation (34) applies the complex representation to $|V_0|\cos(\omega t\pm\beta z+\phi)$.
- The source defines the conjugate by changing the sign of $j$ wherever it appears.
