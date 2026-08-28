---
title: "1.363 Microwave Absorption by Polar Water"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 589, paragraph following Equation (E.23)"]
related: ["permanent-dipole-orientation", "dipole-relaxation-susceptibility", "additive-susceptibility-of-multi-mechanism-materials"]
---

# 1.363 Microwave Absorption by Polar Water

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 589, paragraph following Equation (E.23)

Water provides an applied example of dielectric loss caused by dipole relaxation. A microwave electric field repeatedly reverses direction, forcing polar water molecules to reorient against thermal randomization and molecular resistance. Because the orientational polarization lags the applied field, the relaxation susceptibility has an imaginary component and electromagnetic energy is absorbed by the material. This mechanism is identified as the primary means by which microwave cooking deposits energy in water-containing food. The source notes that operating frequencies near $2.5\ \mathrm{GHz}$ are typically used because they provide a useful or optimum penetration depth. This operating choice does not coincide with the frequency of maximum water absorption. The peak absorption caused by dipole relaxation occurs at a substantially higher frequency. The example therefore illustrates an engineering tradeoff: maximizing local absorption is not always desirable when energy must penetrate through a finite depth of material.

## Page-Grounded Details

#### Page 589

The complex susceptibility associated with dipole relaxation is essentially that of an "overdamped" oscillator, and is given by
$$
\chi_{\rm rel}=\frac{Np^{2}/\epsilon_{0}}{3\,k_{B}\,T(1+j\omega\tau)}\quad{(E.23)}
$$
where $p$ is the permanent dipole moment magnitude of each molecule, $k_{B}$ is Boltzmann's constant, and $T$ is the temperature in degees Kelvin. $\tau$ is the thermal randomization time, defined as the time for the polarization, P, to relax to 1/e of its original value when the field is turned off. $\chi_{\rm rel}$ is complex, and so it will possess absorptive and dispersive components (imaginary and real parts) as we found in the resonant case. The form of Eq. (E.23) is identical to that of the response of a series RC circuit driven by a sinusoidal voltage (where $\tau$ becomes RC).

Microwave absorption in water occurs through the relaxation mechanism in polar water molecules, and is the primary means by which microwave cooking is done, as discussed in Chapter 11. Frequencies near 2.5 GHz are typically used, since these provide the optimum penetration depth. The peak water absorption arising from dipole relaxation occurs at much higher frequencies, ho

[Truncated for analysis]

## Core Ideas

- Polar water molecules absorb microwave energy through dipole relaxation.
- The lagging orientational response produces an absorptive susceptibility component.
- Dipole relaxation is the primary heating mechanism identified for microwave cooking.
- Typical operating frequencies are near $2.5\ \mathrm{GHz}$.
- The stated frequency is chosen for penetration depth rather than peak absorption.
- Water's peak relaxation absorption occurs at a much higher frequency.

## Source Anchors

- Page 589 identifies dipole relaxation in polar water molecules as the basis of microwave absorption.
- The source calls this the primary means by which microwave cooking is performed.
- Frequencies near $2.5\ \mathrm{GHz}$ are stated as typical.
- The reason given for the operating frequency is optimum penetration depth.
- The source states that peak water absorption occurs at much higher frequencies.

## Related Pages

- [[permanent-dipole-orientation|Permanent-Dipole Orientation]]
- [[dipole-relaxation-susceptibility|Dipole Relaxation Susceptibility]]
- [[additive-susceptibility-of-multi-mechanism-materials|Additive Susceptibility of Multi-Mechanism Materials]]

## Concept Dependencies

- example-of: [[dipole-relaxation-susceptibility|Dipole Relaxation Susceptibility]]
- applies-to: [[permanent-dipole-orientation|Permanent-Dipole Orientation]]
