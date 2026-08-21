---
title: "Linear Polarization as Opposite Circular Components"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "linear-polarization-as-opposite-circular-components"
locations: ["Page 414, Example 11.7 setup and phasor addition", "Page 415, Equation (102) and interpretation", "Page 420, Problem 11.34"]
related: ["circularly-polarized-wave-phasors", "optical-rotation-from-circular-birefringence", "quarter-wave-plates-and-anisotropic-retardation"]
---

## ConceptNode: Linear Polarization as Opposite Circular Components

Planning node for [[linear-polarization-as-opposite-circular-components|1.240 Linear Polarization as Opposite Circular Components]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 414, Example 11.7 setup and phasor addition, Page 415, Equation (102) and interpretation, Page 420, Problem 11.34

Example 11.7 demonstrates that a linearly polarized wave can be synthesized from equal-amplitude right and left circularly polarized waves traveling in the same direction. If the left circular component has relative phase $\delta$ with respect to the right circular component, their positive-$z$ phasors add and can be simplified using Euler identities. The result is $$\mathbf{E}_{sT}=2E_0[\cos(\delta/2)\mathbf{a}_x+\sin(\delta/2)\mathbf{a}_y]e^{-j(\beta z-\delta/2)}.$$ The bracketed vector is real, so the total field is linearly polarized. Its orientation is $\delta/2$ from the $x$ axis. The relative phase between circular components therefore controls the direction of the resulting linear polarization, while the factored phase $e^{j\delta/2}$ changes the overall wave phase rather than its polarization state. This circular-basis decomposition becomes particularly useful when a medium acts differently on the two handedness components.

### Key planning details

- The two circular components have equal amplitude, frequency, and propagation direction.
- The components have opposite handedness and relative phase $\delta$.
- Adding the phasors groups the $x$ and $y$ components separately.
- Factoring $e^{j\delta/2}$ exposes sums and differences handled by Euler identities.
- The resultant polarization vector is proportional to $\cos(\delta/2)\mathbf{a}_x+\sin(\delta/2)\mathbf{a}_y$.
- The resulting wave is linearly polarized at angle $\delta/2$ from the $x$ axis.
- Any linear polarization direction can be represented through a suitable relative circular-component phase.

### Source coverage

- Example 11.7 begins with $\mathbf{E}_{sR}=E_0(\mathbf{a}_x-j\mathbf{a}_y)e^{-j\beta z}$ and a phase-shifted left circular component.
- The grouped total field is $E_0[(1+e^{j\delta})\mathbf{a}_x-j(1-e^{j\delta})\mathbf{a}_y]e^{-j\beta z}$.
- The derivation uses $e^{j\delta/2}+e^{-j\delta/2}=2\cos(\delta/2)$.
- It also uses $e^{j\delta/2}-e^{-j\delta/2}=2j\sin(\delta/2)$.
- Equation (102) identifies the linear polarization direction as $\delta/2$ from the $x$ axis.
- Problem 11.34 generalizes the superposition method to elliptically polarized fields with conjugate phase angles.
