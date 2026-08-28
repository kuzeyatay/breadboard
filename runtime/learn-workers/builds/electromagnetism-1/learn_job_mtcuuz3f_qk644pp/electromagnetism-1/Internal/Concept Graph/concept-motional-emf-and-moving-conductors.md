---
title: "Motional EMF and Moving Conductors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "motional-emf-and-moving-conductors"
locations: ["Page 295", "Page 296", "Page 297", "Page 298"]
related: ["faraday-induction-flux-linkage-and-lenzs-law", "transformer-emf-and-the-differential-form-of-faradays-law", "magnetic-force-and-torque-on-charges-and-currents"]
---

## ConceptNode: Motional EMF and Moving Conductors

Planning node for [[motional-emf-and-moving-conductors|1.144 Motional EMF and Moving Conductors]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 295, Page 296, Page 297, Page 298

Motional emf arises when a conductor or closed path moves through a magnetic field. In the sliding-bar example, a conducting bar moves along two rails in a uniform, time-constant magnetic flux density. If the rail separation is $d$, the bar position is $y$, and its speed is $v=dy/dt$, the enclosed flux is $\Phi=Byd$. Faraday's law gives $$\mathrm{emf}=-Bvd.$$ The same result follows microscopically from the magnetic force per unit charge, $$\frac{\mathbf{F}}{Q}=\mathbf{v}\times\mathbf{B},$$ which is defined as the motional electric field intensity $$\mathbf{E}_m=\mathbf{v}\times\mathbf{B}.$$ The induced voltage is then $$\mathrm{emf}=\oint(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{L}.$$ When the magnetic field also varies with time, transformer and motional terms are added. The source warns that merely switching from one circuit path to another is not itself motion through a field or explicit field variation. An apparent change in enclosed flux caused only by circuit substitution therefore need not produce an emf.

### Key planning details

- Moving charges in a magnetic field experience force per charge $\mathbf{v}\times\mathbf{B}$.
- The motional electric field is $\mathbf{E}_m=\mathbf{v}\times\mathbf{B}$.
- Motional emf is $\oint(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{L}$.
- For the sliding bar, the enclosed flux is $\Phi=Byd$.
- The sliding-bar voltage is $\mathrm{emf}=-Bvd$.
- Transformer and motional contributions add when both field variation and motion occur.
- Circuit substitution by switching is not equivalent to continuous motion of a conductor through magnetic flux.

### Source coverage

- S1.P295.F9.1 shows a sliding shorting bar, two rails, a high-resistance voltmeter, uniform $\mathbf{B}$, and velocity $\mathbf{v}$.
- Equation (9) gives $\mathrm{emf}=-Bvd$.
- Equations (10) and (11) define force per charge and $\mathbf{E}_m=\mathbf{v}\times\mathbf{B}$.
- Equation (12) gives $\mathrm{emf}=\oint(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{L}$.
- Equation (14) combines transformer and motional emf.
- S1.P297.F9.2 shows a switched circuit whose apparent flux-linkage increase produces no voltmeter indication because one circuit is substituted for another.
- Drill D9.2 applies the sliding-bar model with $d=7\ \mathrm{cm}$, $\mathbf{B}=0.3\mathbf{a}_z\ \mathrm{T}$, and position-dependent velocity.
