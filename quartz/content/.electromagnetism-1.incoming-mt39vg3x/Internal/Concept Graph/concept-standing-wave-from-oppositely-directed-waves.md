---
title: "Standing Wave from Oppositely Directed Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "standing-wave-from-oppositely-directed-waves"
locations: ["Page 326", "Page 327"]
related: ["complex-instantaneous-voltage-and-phasor-voltage", "reflection-at-a-load-discontinuity", "standing-wave-decomposition-and-voltage-extrema", "voltage-standing-wave-ratio-and-load-recovery"]
---

## ConceptNode: Standing Wave from Oppositely Directed Waves

Planning node for [[standing-wave-from-oppositely-directed-waves|1.172 Standing Wave from Oppositely Directed Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 326, Page 327

Two equal-amplitude, equal-frequency waves traveling in opposite directions combine into a standing wave. In phasor form, the sum is $V_{sT}(z)=V_0e^{-j\beta z}+V_0e^{j\beta z}=2V_0\cos(\beta z)$. Restoring the common time factor and taking the real part gives $\mathcal{V}(z,t)=2V_0\cos(\beta z)\cos(\omega t)$. The result separates into a spatial factor and a temporal factor. Every position oscillates at angular frequency $\omega$, but the oscillation amplitude is fixed by $2V_0|\cos(\beta z)|$. Locations where the spatial cosine vanishes are stationary nulls rather than moving crests. The example gives null positions $z_n=m\pi/(2\beta)$ for odd integer $m$. This construction provides the basic interference model later used to understand reflections, voltage maxima and minima, and voltage standing wave ratio.

### Key planning details

- Opposite traveling-wave phasors add as $e^{-j\beta z}+e^{j\beta z}=2\cos(\beta z)$.
- The real standing wave is $2V_0\cos(\beta z)\cos(\omega t)$.
- The spatial amplitude pattern remains fixed while the voltage oscillates in time.
- Nulls occur where $\cos(\beta z)=0$.
- Equal frequency is required for the phasor addition.
- Standing waves are an interference result, not a separate propagation mode introduced independently.

### Source coverage

- Example 10.1 combines $V_0e^{-j\beta z}$ and $V_0e^{j\beta z}$.
- The resulting instantaneous voltage is $2V_0\cos(\beta z)\cos(\omega t)$.
- The source identifies nulls at $z_n=m\pi/(2\beta)$ for odd $m$.
