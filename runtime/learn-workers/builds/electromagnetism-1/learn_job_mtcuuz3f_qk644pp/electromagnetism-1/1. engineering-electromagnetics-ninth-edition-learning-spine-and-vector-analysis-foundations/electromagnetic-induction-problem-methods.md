---
title: "1.156 Electromagnetic Induction Problem Methods"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 310", "Page 311", "Page 312", "Section: Chapter 9 Problems 9.1 through 9.9"]
related: ["time-varying-electromagnetic-potentials", "maxwell-equation-application-problems", "distributed-versus-lumped-circuit-models"]
---

# 1.156 Electromagnetic Induction Problem Methods

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 310, Page 311, Page 312, Section: Chapter 9 Problems 9.1 through 9.9

The chapter problems consolidate several reusable methods for finding induced voltage and current. For a stationary loop in a time-varying magnetic field, Faraday's law relates the closed-path electric field or emf to the negative time derivative of magnetic flux. For moving conductors, the motional contribution depends on $\mathbf{v}\times\mathbf{B}$ and must be integrated along the moving segment. Rotating-loop problems require expressing the loop's magnetic flux as a time-dependent area projection before differentiating it. Sliding-bar problems can combine position-dependent magnetic flux density, time-dependent geometry, rail resistance, and external loads. When both the conductor and field vary, the total flux derivative must account for all time dependence. Direction follows Lenz's law and the orientation chosen for the loop integral and surface normal.

## Page-Grounded Details

#### Page 310

We may summarize the use of the potentials by stating that a knowledge of the distribution of $\rho_{v}$ and **J** throughout space theoretically enables us to determine **V** and **A** from (57) and (58). The electric and magnetic fields are then obtained by applying (50) and (51). If the charge and current distributions are unknown, or reasonable approximations cannot be made for them, these potentials usually offer no easier path toward the solution than does the direct application of Maxwell's equations.

D9.7. A point charge of $4\,\cos\,10^{8}\pi t\,\mu\text{C}$ is located at $P_{+}(0,\,0,\,1.5)$, whereas $-4\,\cos\,10^{8}\pi t\,\mu\text{C}$ is at $P_{-}(0,\,0,\,-1.5)$, both in free space. Find **V** at $P(r=450,\,\theta,\,\phi=0)$ at $t=15$ ns for $\theta=$: (a) $0^{\circ}$; (b) $90^{\circ}$; (c) $45^{\circ}$.

Ans. (a) 159.8 V; (b) 0; (c) 143 V

#### REFERENCES

1. Bewley, L. V. *Flux Linkages and Electromagnetic Induction*. New York: Macmillan, 1952. This little book discusses many of the paradoxical examples involving induced (?) voltages.

2. Faraday, M. *Experimental Researches in Electricity*. London: B. Quaritch, 1839, 1855. Very interesting read

[Truncated for analysis]

#### Page 311

Figure 9.4 See Problem 9.1.

9.3
Given $\mathbf{H} = 300\mathbf{a}_{z}\cos(3\times10^{8}t - y)$ A/m in free space, find the emf developed in the general $\mathbf{a}_{\phi}$ direction about the closed path having corners at $(a)$ (0, 0, 0), $(1, 0, 0)$, $(1, 1, 0)$, and $(0, 1, 0)$; $(b)$ (0, 0, 0) $$ (2\pi, 0, 0) $$ (2\pi, 2\pi, 0) $, and$ (0, 2\pi, 0) $.

9.4
A rectangular loop of wire containing a high-resistance voltmeter has corners initially at $(a/2, b/2, 0)$, $(-a/2, b/2, 0)$, $(-a/2, -b/2, 0)$, and $(a/2, -b/2, 0)$. The loop begins to rotate about the x axis at constant angular velocity $\omega$, with the first-named corner moving in the $\mathbf{a}_{z}$ direction at $t = 0$. Assume a uniform magnetic flux density $\mathbf{B} = B_{0}\mathbf{a}_{z}$. Determine the induced emf in the rotating loop and specify the direction of the current.

9.5
The location of the sliding bar in Figure 9.5 is given by $x = 5t + 2t^{3}$, and the separation of the two rails is 20 cm. Let $\mathbf{B} = 0.8x^{2}\mathbf{a}_{z}$ T. Find the voltmeter reading at $(a)$ t = 0.4 s; $(b)$ x = 0.6 m $.

9.6
Let the wire loop of Problem 9.4 be stationary in its $ t

[Truncated for analysis]

#### Page 312

Figure 9.6 See Problem 9.7.

9.7

The rails in Figure 9.6 each have a resistance of 2.2 $\Omega$/m. The bar moves to the right at a constant speed of 9 m/s in a uniform magnetic field of 0.8 T. Find $I(t)$, $0<t<1$ s, if the bar is at x = 2 m at t = 0 and (a) a 0.3 $\Omega$ resistor is present across the left end with the right end open-circuited; (b) a 0.3 $\Omega$ resistor is present across each end.

9.8

A perfectly conducting filament is formed into a circular ring of radius a. At one point, a resistance R is inserted into the circuit, and at another a battery of voltage $V_{0}$ is inserted. Assume that the loop current itself produces negligible magnetic field. (a) Apply Faraday's law, Eq. (4), evaluating each side of the equation carefully and independently to show the equality; (b) repeat part a, assuming the battery is removed, the ring is closed again, and a linearly increasing B field is applied in a direction normal to the loop surface.

9.9

A square filamentary loop of wire is 25 cm on a side and has a resistance of 125 $\Omega$ per meter length. The loop lies in the z = 0 plane with its corners at (0, 0, 0), (0.25, 0, 0), (0.25, 0.25, 0), and (0, 0.25,

[Truncated for analysis]

## Core Ideas

- Compute magnetic flux before differentiating when loop geometry or field varies.
- Use $\mathbf{v}\times\mathbf{B}$ for motional emf in moving conductors.
- Include position-dependent resistance when rails contribute distributed resistance.
- Use Lenz's law and consistent loop orientation to determine current direction.
- Convert induced emf to current or power only after establishing total circuit resistance.

## Source Anchors

- Problems 9.1 through 9.2 on Page 310 address time-varying flux and moving-bar emf.
- Figure 9.4 on Page 311 is the source-central circuit geometry for Problem 9.1 and must be used when interpreting $V_{ab}(t)$ and $I(t)$.
- Problems 9.3 through 9.6 on Page 311 cover closed-path emf, a rotating loop, a sliding bar, and a stationary loop in a traveling magnetic field.
- Figure 9.5 on Page 311 supplies the sliding-bar geometry for Problem 9.5.
- Figure 9.6 on Page 312 supplies the rail-and-load configuration for Problem 9.7.
- Problems 9.7 through 9.9 on Page 312 add distributed rail resistance, explicit verification of Faraday's law, and ohmic power in a moving loop.

## Related Pages

- [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
- [[maxwell-equation-application-problems|Maxwell-Equation Application Problems]]
- [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]

## Concept Dependencies

- related: [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
