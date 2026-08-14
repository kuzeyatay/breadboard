---
title: "1.158 Potential and Duality Problems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 314", "Section: Chapter 9 Problems 9.23 through 9.26"]
related: ["time-varying-electromagnetic-potentials", "lorenz-gauge-and-potential-wave-equations", "retarded-scalar-and-vector-potentials", "maxwell-equation-application-problems"]
---

# 1.158 Potential and Duality Problems

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 314, Section: Chapter 9 Problems 9.23 through 9.26

The final Chapter 9 problems turn the potential definitions into calculation and verification procedures. One task asks for a vector potential consistent with a specified transmission-line electric field and a boundary value. Another starts from a sinusoidal vector potential and requires the associated magnetic field, electric field, scalar potential, and propagation constant. A retarded-potential example asks the student to verify the Lorenz gauge, reconstruct $\mathbf{B}$, $\mathbf{H}$, $\mathbf{E}$, and $\mathbf{D}$, and check all source-free Maxwell equations. The duality problem then exchanges $\epsilon$ with $\mu$, $\mathbf{E}$ with $\mathbf{H}$, and $\mathbf{H}$ with $-\mathbf{E}$ to show that the source-free point-form equations retain their structure. Together these tasks teach that potentials, fields, gauges, constitutive laws, and Maxwell equations must all agree.

## Page-Grounded Details

#### Page 314

$\underline{9.19}$ In Section 9.1, Faraday's law was used to show that the field $\mathbf{E}=-\frac{1}{2} kB_{0}e^{kt}$ $\rho\mathbf{a}_{\phi}$ results from the changing magnetic field $\mathbf{B}=B_{0}e^{kt}\mathbf{a}_{z}$. (a) Show that these fields do not satisfy Maxwell's other curl equation. (b) If we let $B_{0}=1\$ T and $k=10^{6}\,s^{-1}$, we are establishing a fairly large magnetic flux density in $1\,\mu$ s. Use the $\nabla\times\mathbf{H}$ equation to show that the rate at which $B_{z}$ should (but does not) change with $\rho$ is only about $5\times 10^{-6}\$ T per meter in free space at $t=0$.

$\underline{9.20}$ Given Maxwell's equations in point form, assume that all fields vary as $e^{st}$ and write the equations without explicitly involving time.

$\underline{9.21}$ (a) Show that under static field conditions, Eq. (55) reduces to Ampère's circuital law. (b) Verify that Eq. (51) becomes Faraday's law when we take the curl.

$\underline{9.22}$ In a sourceless medium in which $\mathbf{J}=0$ and $\rho_{v}=0$, assume a rectangular coordinate system in which $\mathbf{E}$ and $\mathbf{H}$ are functions only of $z$ and $t$. The m

[Truncated for analysis]

## Core Ideas

- Recover fields from $V$ and $\mathbf{A}$ using the time-varying potential definitions.
- Use a specified potential value to remove integration ambiguity.
- Verify the Lorenz gauge before using proposed retarded potentials.
- Check reconstructed fields against all source-free Maxwell equations.
- Recognize electric-magnetic duality under the stated field and material substitutions.

## Source Anchors

- Problem 9.23 on Page 314 asks for $\mathbf{A}(y,z,t)$ from a parallel-plate line electric field and the condition $\mathbf{A}(0,z,t)=0$.
- Problem 9.24 starts with $\mathbf{A}=A_0\cos(\omega t-kz)\mathbf{a}_y$ and asks for $\mathbf{H}$, $\mathbf{E}$, $V$, and $k$.
- Problem 9.25 gives explicit retarded potentials and requires gauge and Maxwell-equation verification.
- Problem 9.26 states the substitutions that demonstrate the duality principle.

## Related Pages

- [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
- [[lorenz-gauge-and-potential-wave-equations|Lorenz Gauge and Potential Wave Equations]]
- [[retarded-scalar-and-vector-potentials|Retarded Scalar and Vector Potentials]]
- [[maxwell-equation-application-problems|Maxwell-Equation Application Problems]]

## Concept Dependencies

- applies-to: [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
- applies-to: [[lorenz-gauge-and-potential-wave-equations|Lorenz Gauge and Potential Wave Equations]]
- applies-to: [[retarded-scalar-and-vector-potentials|Retarded Scalar and Vector Potentials]]
