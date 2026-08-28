---
title: "1.241 Optical Rotation from Circular Birefringence"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 415, discussion following Example 11.7"]
related: ["linear-polarization-as-opposite-circular-components", "quarter-wave-plates-and-anisotropic-retardation", "circularly-polarized-wave-phasors"]
---

# 1.241 Optical Rotation from Circular Birefringence

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 415, discussion following Example 11.7

A linearly polarized wave can be treated as the sum of left and right circularly polarized components. This representation is necessary when a material interacts differently with the two handedness states. The text identifies media containing organic molecules with spiral structures as an important example. Because left and right circular components can propagate at different speeds in such a medium, they accumulate a relative phase difference with distance. When the components recombine, Example 11.7 shows that the linear polarization direction is controlled by half their relative phase. The output therefore remains associated with a linear polarization direction that is rotated relative to the input. Measuring this rotation provides information about the material and can support material studies. The mechanism differs from quarter-wave conversion: the quarter-wave plate delays orthogonal linear components, whereas circular birefringence delays opposite circular components and thereby rotates a reconstructed linear state.

## Page-Grounded Details

#### Page 415

From Euler's identity, we find that $e^{j\delta/2}+e^{-j\delta/2}=2\cos\delta/2$, and $e^{j\delta/2}-e^{-j\delta/2}=2j\sin\delta/2$. Using these relations, we obtain
$$
E_{sT}=2E_{0}[\cos(\delta/2)a_{x}+\sin(\delta/2)a_{y}]e^{-j(\beta z-\delta/2)}\quad{(102)}
$$
We recognize (102) as the electric field of a linearly polarized wave, whose field vector is oriented at angle $\delta/2$ from the $x$ axis.

Example 11.7 shows that any linearly polarized wave can be expressed as the sum of two circularly polarized waves of opposite handedness, where the linear polarization direction is determined by the relative phase difference between the two waves. Such a representation is convenient (and necessary) when considering, for example, the propagation of linearly polarized light through media which contain organic molecules. These often exhibit spiral structures having left- or right-handed pitch, and they will thus interact differently with left- or right-hand circular polarization. As a result, the left circular component can propagate at a different speed than the right circular component, and so the two waves will accumulate a phase difference as they propagate. As a result, th

[Truncated for analysis]

## Core Ideas

- Linear polarization can be decomposed into opposite circular components.
- Spiral molecular structures can interact differently with left and right circular polarization.
- The two circular components can acquire different propagation speeds.
- Differential propagation creates a relative phase shift.
- Recombination changes the orientation of the linear polarization vector.
- The observed rotation can be used as a material measurement.

## Source Anchors

- Page 415 states that organic molecules often exhibit spiral structures with left- or right-handed pitch.
- The left circular component can propagate at a different speed from the right circular component.
- The components accumulate a phase difference while propagating.
- The output linear-field direction differs from its input direction.
- The extent of rotation can aid material studies.

## Related Pages

- [[linear-polarization-as-opposite-circular-components|Linear Polarization as Opposite Circular Components]]
- [[quarter-wave-plates-and-anisotropic-retardation|Quarter-Wave Plates and Anisotropic Retardation]]
- [[circularly-polarized-wave-phasors|Circularly Polarized Wave Phasors]]

## Concept Dependencies

- contrasts-with: [[quarter-wave-plates-and-anisotropic-retardation|Quarter-Wave Plates and Anisotropic Retardation]]
