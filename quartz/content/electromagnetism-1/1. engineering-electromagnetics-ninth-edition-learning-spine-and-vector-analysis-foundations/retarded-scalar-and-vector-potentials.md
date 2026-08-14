---
title: "1.155 Retarded Scalar and Vector Potentials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 309", "Page 310", "Section 9.5: The Retarded Potentials", "Section: Developmental Problem D9.7"]
related: ["lorenz-gauge-and-potential-wave-equations", "static-scalar-and-vector-potentials", "potential-and-duality-problems", "distributed-versus-lumped-circuit-models"]
---

# 1.155 Retarded Scalar and Vector Potentials

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 309, Page 310, Section 9.5: The Retarded Potentials, Section: Developmental Problem D9.7

Electromagnetic influence propagates through a homogeneous medium at finite speed
$$
v=\frac{1}{\sqrt{\mu\epsilon}}
$$
 so a potential observed at time $t$ depends on source values at an earlier time. For a source element at distance $R$, the retarded time is
$$
t'=t-\frac{R}{v}
$$
 Brackets around a source quantity indicate that every occurrence of time in that source is replaced by $t'$. The retarded scalar and vector potentials are
$$
V=\int_{\mathrm{vol}}\frac{[\rho_v]}{4\pi\epsilon R}\,dv
$$
$$
\mathbf{A}=\int_{\mathrm{vol}}\frac{\mu[\mathbf{J}]}{4\pi R}\,dv
$$
 For example, if $\rho_v=e^{-r}\cos\omega t$, then $[\rho_v]=e^{-r}\cos[\omega(t-R/v)]$. These formulas are especially useful in radiation problems when charge and current distributions are known or can be approximated.

## Page-Grounded Details

#### Page 309

pleased with our definitions of $V$ and $A$,
$$
B=\nabla\times A \quad{(50)}
$$
$$
\nabla\cdot A=-\mu e\frac{\partial V}{\partial t} \quad{(54)}
$$
$$
E=-\nabla V-\frac{\partial A}{\partial t} \quad{(51)}
$$
The integral equivalents of (45) and (46) for the time-varying potentials follow from the definitions (50), (51), and (54), but we shall merely present the final results and indicate their general nature. In Chapter 11, we will find that any electromagnetic disturbance will travel at a velocity
$$
v=\frac{1}{\sqrt{\mu e}}
$$
through any homogeneous medium described by $\mu$ and $\epsilon$. In the case of free space, this velocity turns out to be the velocity of light, approximately $3\times 10^{8}$ m/s. It is logical, then, to suspect that the potential at any point is due not to the value of the charge density at some distant point at the same instant, but to its value at some previous time, because the effect propagates at a finite velocity. Thus (45) becomes
$$
V=\int_{\rm vol}\frac{[\rho_{v}]}{4\pi\epsilon R}dv \quad{(57)}
$$
where $[\rho_{v}]$ indicates that every $t$ appearing in the expression for $\rho_{v}$ has been replaced by a retarded time,

[Truncated for analysis]

#### Page 310

We may summarize the use of the potentials by stating that a knowledge of the distribution of $\rho_{v}$ and **J** throughout space theoretically enables us to determine **V** and **A** from (57) and (58). The electric and magnetic fields are then obtained by applying (50) and (51). If the charge and current distributions are unknown, or reasonable approximations cannot be made for them, these potentials usually offer no easier path toward the solution than does the direct application of Maxwell's equations.

D9.7. A point charge of $4\,\cos\,10^{8}\pi t\,\mu\text{C}$ is located at $P_{+}(0,\,0,\,1.5)$, whereas $-4\,\cos\,10^{8}\pi t\,\mu\text{C}$ is at $P_{-}(0,\,0,\,-1.5)$, both in free space. Find **V** at $P(r=450,\,\theta,\,\phi=0)$ at $t=15$ ns for $\theta=$: (a) $0^{\circ}$; (b) $90^{\circ}$; (c) $45^{\circ}$.

Ans. (a) 159.8 V; (b) 0; (c) 143 V

#### REFERENCES

1. Bewley, L. V. *Flux Linkages and Electromagnetic Induction*. New York: Macmillan, 1952. This little book discusses many of the paradoxical examples involving induced (?) voltages.

2. Faraday, M. *Experimental Researches in Electricity*. London: B. Quaritch, 1839, 1855. Very interesting read

[Truncated for analysis]

## Core Ideas

- Propagation speed in a homogeneous medium is $v=1/\sqrt{\mu\epsilon}$.
- Free-space propagation speed is approximately $3\times10^8$ m/s.
- Retarded time is $t'=t-R/v$.
- Each source element is evaluated at a delay determined by its distance from the observation point.
- Fields are recovered from the retarded potentials using curl, gradient, and time differentiation.

## Source Anchors

- Page 309 states the homogeneous-medium speed $v=1/\sqrt{\mu\epsilon}$.
- Equations (57) and (58) give the retarded scalar and vector potential integrals.
- Page 309 applies retardation to $\rho_v=e^{-r}\cos\omega t$.
- Page 310 states that known $\rho_v$ and $\mathbf{J}$ theoretically determine $V$ and $\mathbf{A}$, after which $\mathbf{E}$ and $\mathbf{B}$ follow.
- Developmental Problem D9.7 on Page 310 applies the retarded scalar potential to two oppositely signed sinusoidal point charges.

## Related Pages

- [[lorenz-gauge-and-potential-wave-equations|Lorenz Gauge and Potential Wave Equations]]
- [[static-scalar-and-vector-potentials|Static Scalar and Vector Potentials]]
- [[potential-and-duality-problems|Potential and Duality Problems]]
- [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]

## Concept Dependencies

- depends-on: [[lorenz-gauge-and-potential-wave-equations|Lorenz Gauge and Potential Wave Equations]]
- contrasts-with: [[static-scalar-and-vector-potentials|Static Scalar and Vector Potentials]]
