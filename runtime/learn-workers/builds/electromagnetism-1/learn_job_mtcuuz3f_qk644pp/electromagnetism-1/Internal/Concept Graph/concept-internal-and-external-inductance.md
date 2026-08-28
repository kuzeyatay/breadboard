---
title: "Internal and External Inductance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "internal-and-external-inductance"
locations: ["Page 281", "Page 282", "Section 8.10.2"]
related: ["flux-linkage-and-self-inductance", "energy-and-vector-potential-definitions-of-inductance"]
---

## ConceptNode: Internal and External Inductance

Planning node for [[internal-and-external-inductance|1.131 Internal and External Inductance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 281, Page 282, Section 8.10.2

Real conductors contain magnetic flux both outside and inside their material. External flux links the full enclosed current according to the geometry of the circuit, while internal flux links a fraction of the current that depends on position within the conductor. These internal linkages create an internal inductance that must be added to external inductance to obtain the total. For a long straight circular wire of radius $a$ with uniform current distribution, the internal inductance per unit length is $L_{int}=\mu/(8\pi)$ H/m. A conductor cannot be treated as an exact zero-radius filament when calculating self-inductance. Ampère's law makes the field near an ideal filament vary inversely with distance, and integrating the associated flux or energy down to zero radius produces an infinite result. Giving the wire a finite radius removes this singularity. Frequency also affects the current distribution. At high frequencies, current becomes concentrated near the surface, reducing internal flux and making internal inductance less significant. At lower frequencies, current penetrates more uniformly and internal inductance can form an appreciable part of the total.

### Key planning details

- Total self-inductance includes both internal and external contributions.
- Internal flux links different fractions of the total current at different radii.
- A uniform circular wire has $L_{int}=\mu/(8\pi)$ H/m.
- An ideal zero-radius filament has infinite self-inductance.
- The divergence follows from the inverse-distance magnetic field near the filament.
- A finite conductor radius removes the singularity.
- High-frequency surface-current concentration reduces internal flux.
- Internal inductance is more important when current penetrates the conductor cross section.

### Source coverage

- Page 281 explains why a true zero-radius filament yields infinite energy, flux, and inductance.
- Equation (62) gives $L_{a,int}=\mu/(8\pi)$ H/m for a long circular wire with uniform current distribution.
- The source states that internal flux links a variable fraction of total current depending on location.
- Page 282 notes that high-frequency current tends to concentrate near the conductor surface.
- The reduction of internal flux at high frequency often permits use of external inductance alone.
