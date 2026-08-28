---
title: "1.240 Linear Polarization as Opposite Circular Components"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 414, Example 11.7 setup and phasor addition", "Page 415, Equation (102) and interpretation", "Page 420, Problem 11.34"]
related: ["circularly-polarized-wave-phasors", "optical-rotation-from-circular-birefringence", "quarter-wave-plates-and-anisotropic-retardation"]
---

# 1.240 Linear Polarization as Opposite Circular Components

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 414, Example 11.7 setup and phasor addition, Page 415, Equation (102) and interpretation, Page 420, Problem 11.34

Example 11.7 demonstrates that a linearly polarized wave can be synthesized from equal-amplitude right and left circularly polarized waves traveling in the same direction. If the left circular component has relative phase $\delta$ with respect to the right circular component, their positive-$z$ phasors add and can be simplified using Euler identities. The result is
$$
\mathbf{E}_{sT}=2E_0[\cos(\delta/2)\mathbf{a}_x+\sin(\delta/2)\mathbf{a}_y]e^{-j(\beta z-\delta/2)}
$$
 The bracketed vector is real, so the total field is linearly polarized. Its orientation is $\delta/2$ from the $x$ axis. The relative phase between circular components therefore controls the direction of the resulting linear polarization, while the factored phase $e^{j\delta/2}$ changes the overall wave phase rather than its polarization state. This circular-basis decomposition becomes particularly useful when a medium acts differently on the two handedness components.

## Page-Grounded Details

#### Page 414

light can be passed through a polarizer of any orientation, thus yielding linearly polarized light in any direction (although one loses half the original power this way). Other uses involve treating linearly polarized light as a superposition of circularly polarized waves, to be described next.

Circularly polarized light can be generated using an anisotropic medium-a material whose permittivity is a function of electric field direction. Many crystals have this property. A crystal orientation can be found such that along one direction (say, the x axis), the permittivity is lowest, while along the orthogonal direction (y axis), the permittivity is highest. The strategy is to input a linearly polarized wave with its field vector at 45 degrees to the x and y axes of the crystal. It will thus have equal-amplitude x and y components in the crystal, and these will now propagate in the z direction at different speeds. A phase difference (or retardation) accumulates between the components as they propagate, which can reach π/2 if the crystal is long enough. The wave at the output thus becomes circularly polarized. Such a crystal, cut to the right length and used in this manner, is called a

[Truncated for analysis]

#### Page 415

From Euler's identity, we find that $e^{j\delta/2}+e^{-j\delta/2}=2\cos\delta/2$, and $e^{j\delta/2}-e^{-j\delta/2}=2j\sin\delta/2$. Using these relations, we obtain
$$
E_{sT}=2E_{0}[\cos(\delta/2)a_{x}+\sin(\delta/2)a_{y}]e^{-j(\beta z-\delta/2)}\quad{(102)}
$$
We recognize (102) as the electric field of a linearly polarized wave, whose field vector is oriented at angle $\delta/2$ from the $x$ axis.

Example 11.7 shows that any linearly polarized wave can be expressed as the sum of two circularly polarized waves of opposite handedness, where the linear polarization direction is determined by the relative phase difference between the two waves. Such a representation is convenient (and necessary) when considering, for example, the propagation of linearly polarized light through media which contain organic molecules. These often exhibit spiral structures having left- or right-handed pitch, and they will thus interact differently with left- or right-hand circular polarization. As a result, the left circular component can propagate at a different speed than the right circular component, and so the two waves will accumulate a phase difference as they propagate. As a result, th

[Truncated for analysis]

#### Page 420

11.32  Suppose that the length of the medium of Problem 11.31 is made to be twice that determined in the problem. Describe the polarization of the output wave in this case.

11.33 Given a wave for which $\mathbf{E}_{s}=15e^{-j\beta z}\mathbf{a}_{x}+18e^{-j\beta z}e^{j\phi}\mathbf{a}_{y}$ V/m in a medium characterized by complex intrinsic impedance $\eta(a)$, find $\mathbf{H}_{s}$. (b) Determine the average power density in $W/m^{2}$.

11.34 Given a general elliptically polarized wave as per Eq. (93):
$$
\mathbf{E}_{s}=[E_{x0}\mathbf{a}_{x}+E_{y0}e^{j\phi}\mathbf{a}_{y}]e^{-j\beta z}
$$
(a) Show, using methods similar to those of Example 11.7, that a linearly polarized wave results when superimposing the given field and a phase-shifted field of the form:
$$
\mathbf{E}_{s}=[E_{x0}\mathbf{a}_{x}+E_{y0}e^{-j\phi}\mathbf{a}_{y}]e^{-j\beta z}e^{j\delta}
$$
where $\delta$ is a constant. (b) Find $\delta$ in terms of $\phi$ such that the resultant wave is linearly polarized along $x$.

## Core Ideas

- The two circular components have equal amplitude, frequency, and propagation direction.
- The components have opposite handedness and relative phase $\delta$.
- Adding the phasors groups the $x$ and $y$ components separately.
- Factoring $e^{j\delta/2}$ exposes sums and differences handled by Euler identities.
- The resultant polarization vector is proportional to $\cos(\delta/2)\mathbf{a}_x+\sin(\delta/2)\mathbf{a}_y$.
- The resulting wave is linearly polarized at angle $\delta/2$ from the $x$ axis.
- Any linear polarization direction can be represented through a suitable relative circular-component phase.

## Source Anchors

- Example 11.7 begins with $\mathbf{E}_{sR}=E_0(\mathbf{a}_x-j\mathbf{a}_y)e^{-j\beta z}$ and a phase-shifted left circular component.
- The grouped total field is $E_0[(1+e^{j\delta})\mathbf{a}_x-j(1-e^{j\delta})\mathbf{a}_y]e^{-j\beta z}$.
- The derivation uses $e^{j\delta/2}+e^{-j\delta/2}=2\cos(\delta/2)$.
- It also uses $e^{j\delta/2}-e^{-j\delta/2}=2j\sin(\delta/2)$.
- Equation (102) identifies the linear polarization direction as $\delta/2$ from the $x$ axis.
- Problem 11.34 generalizes the superposition method to elliptically polarized fields with conjugate phase angles.

## Related Pages

- [[circularly-polarized-wave-phasors|Circularly Polarized Wave Phasors]]
- [[optical-rotation-from-circular-birefringence|Optical Rotation from Circular Birefringence]]
- [[quarter-wave-plates-and-anisotropic-retardation|Quarter-Wave Plates and Anisotropic Retardation]]

## Concept Dependencies

- explains: [[optical-rotation-from-circular-birefringence|Optical Rotation from Circular Birefringence]]
