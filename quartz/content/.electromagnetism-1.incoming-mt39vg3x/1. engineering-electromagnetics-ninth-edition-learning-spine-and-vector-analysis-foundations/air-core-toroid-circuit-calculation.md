---
title: "1.125 Air-Core Toroid Circuit Calculation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 271", "Page 272", "Section 8.8"]
related: ["magnetic-circuit-analogy-and-reluctance", "nonlinear-gapped-magnetic-circuit-analysis", "flux-linkage-and-self-inductance", "linear-magnetic-constitutive-relations"]
---

# 1.125 Air-Core Toroid Circuit Calculation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 271, Page 272, Section 8.8

The air-core toroid example demonstrates the complete magnetic-circuit procedure in a linear medium. The toroid has 500 turns, current 4 A, cross-sectional area $6\,\mathrm{cm}^2$, and mean radius 15 cm. Its coil supplies $NI=2000$ ampere-turns. Approximating the field as uniform along the mean path, the path length is $2\pi(0.15)$ m and the air-core reluctance is $\mathcal{R}=d/(\mu_0S)=1.25\times10^9$ A-turn/Wb. The flux is then $\Phi=V_m/\mathcal{R}=1.6\times10^{-6}$ Wb. Dividing by area gives $B=2.67\times10^{-3}$ T, and dividing by $\mu_0$ gives $H=2120$ A/m. Ampère's law provides an independent check: $H_\phi2\pi r=NI$, which gives the same value at the mean radius. The source reports that the uniform-field magnetic-circuit approximation differs by less than one quarter percent from a calculation using the exact flux distribution over the cross section.

## Page-Grounded Details

#### Page 271

for the closed line integral is not zero. Because the total current linked by the path is usually obtained by allowing a current $I$ to flow through an $N$-turn coil, we may express this result as
$$
\oint\mathbf{H}\cdot d\mathbf{L}=N\mathbf{I}\qquad(44)
$$
In an electric circuit, the voltage source is a part of the closed path; in the magnetic circuit, the current-carrying coil will surround or link the magnetic circuit. In tracing a magnetic circuit, we will not be able to identify a pair of terminals at which the magnetomotive force is applied. The analogy is closer here to a pair of coupled circuits in which induced voltages exist (and in which we will see in Chapter 9 that the closed line integral of $\mathbf{E}$ is also not zero).

We will try out some of these ideas on a simple magnetic circuit. In order to avoid the complications of ferromagnetic materials at this time, we will assume that we have an air-core toroid with 500 turns, a cross-sectional area of $6\,{\rm cm}^{2}$, a mean radius of 15 cm, and a coil current of 4 A. As we already know, the magnetic field is confined to the interior of the toroid, and if we consider the closed path of our magnetic circuit

[Truncated for analysis]

#### Page 272

and obtain
$$
H_{\phi}=\frac{NI}{2\pi r}=\frac{500\times 4}{6.28\times 0.15}=2120\,\mathrm{A/m}
$$
at the mean radius.

Our magnetic circuit in this example does not give us any opportunity to find the mmf across different elements in the circuit, for there is only one type of material. The analogous electric circuit is, of course, a single source and a single resistor. We could make it look just as long as the preceding analysis, however, if we found the current density, the electric field intensity, the total current, the resistance, and the source voltage.

More interesting and more practical problems arise when ferromagnetic materials are present in the circuit. We begin by considering the relationship between B and H in such a material. We may assume that we are establishing a curve of B versus H for a sample of ferromagnetic material which is completely demagnetized; both B and H are zero. As we begin to apply an mmf, the flux density also rises, but not linearly, as the experimental data of Figure 8.11 show near the origin. After H reaches a value of about 100 A*t/m, the flux density rises more slowly and begins to saturate when H is several hundred A*t/m. Having reached p

[Truncated for analysis]

## Core Ideas

- The source mmf is calculated first as $NI$.
- The mean magnetic path length of a toroid is approximated by $2\pi r$.
- Air reluctance is computed with $\mu=\mu_0$.
- Flux follows from $\Phi=V_m/\mathcal{R}$.
- Flux density follows from $B=\Phi/S$ when it is approximately uniform.
- Field intensity follows from $H=B/\mu_0$.
- Ampère's law provides a direct validation of the circuit result.
- The mean-path approximation is highly accurate for the stated geometry.

## Source Anchors

- The example uses $N=500$, $I=4$ A, $S=6\times10^{-4}$ m$^2$, and mean radius $r=0.15$ m.
- The calculated source mmf is 2000 A-turn.
- The calculated reluctance is $1.25\times10^9$ A-turn/Wb.
- The calculated flux is $1.6\times10^{-6}$ Wb.
- The calculated fields are $B=2.67\times10^{-3}$ T and $H=2120$ A/m.
- The direct check $H_\phi=NI/(2\pi r)$ also gives 2120 A/m.

## Related Pages

- [[magnetic-circuit-analogy-and-reluctance|Magnetic Circuit Analogy and Reluctance]]
- [[nonlinear-gapped-magnetic-circuit-analysis|Nonlinear Gapped Magnetic Circuit Analysis]]
- [[flux-linkage-and-self-inductance|Flux Linkage and Self-Inductance]]
- [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]

## Concept Dependencies

- example-of: [[magnetic-circuit-analogy-and-reluctance|Magnetic Circuit Analogy and Reluctance]]
- applies-to: [[linear-magnetic-constitutive-relations|Linear Magnetic Constitutive Relations]]
