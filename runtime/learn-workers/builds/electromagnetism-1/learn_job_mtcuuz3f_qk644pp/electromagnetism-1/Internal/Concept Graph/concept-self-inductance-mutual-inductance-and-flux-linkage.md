---
title: "Self-Inductance, Mutual Inductance, and Flux Linkage"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "self-inductance-mutual-inductance-and-flux-linkage"
locations: ["Page 284", "Page 288", "Page 289", "Page 290"]
related: ["magnetic-circuits-reluctance-and-air-gaps", "magnetic-energy-and-transmission-line-inductance", "faraday-induction-flux-linkage-and-lenzs-law"]
---

## ConceptNode: Self-Inductance, Mutual Inductance, and Flux Linkage

Planning node for [[self-inductance-mutual-inductance-and-flux-linkage|1.138 Self-Inductance, Mutual Inductance, and Flux Linkage]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 284, Page 288, Page 289, Page 290

The inductance problems connect current-generated magnetic flux to flux linkage. For a winding of $N$ turns linking flux $\Phi$, the flux linkage is $\lambda=N\Phi$, and self-inductance is obtained from $L=\lambda/I$ in a linear system. Mutual inductance measures the flux linkage of one coil caused by current in another, so $M=N_2\Phi_{21}/I_1$ for the flux through coil 2 produced by current $I_1$. When two windings share an ideal magnetic circuit of reluctance $\mathcal{R}$, the source asks students to show that $L_1=N_1^2/\mathcal{R}$, $L_2=N_2^2/\mathcal{R}$, and the fully coupled mutual inductance is $M=N_1N_2/\mathcal{R}$. Other problems require direct integration because the magnetic field varies over the core cross section or because the coupled objects are filaments and loops in free space. The coaxial-solenoid drill gives numerical self and mutual inductances and reinforces that mutual coupling is determined by shared flux rather than merely by physical proximity.

### Key planning details

- Flux linkage is $\lambda=N\Phi$ for $N$ turns linking flux $\Phi$.
- Linear self-inductance is $L=\lambda/I$.
- Mutual inductance is the flux linkage in one winding per current in another.
- For a shared ideal magnetic circuit, inductance scales with the square of turn count.
- Fully shared flux gives $M=N_1N_2/\mathcal{R}$.
- Nonuniform fields require integration before flux linkage is computed.
- Reciprocal coil systems are expected to give the same mutual inductance under interchange of source and receiving coils.

### Source coverage

- Drill D8.13 gives coaxial solenoids and answers $L_{inner}=133.2\ \mathrm{mH}$, $L_{outer}=192\ \mathrm{mH}$, and $M=106.6\ \mathrm{mH}$.
- Problem 8.30 asks for position-dependent core flux density, total flux, self-inductance, and mutual inductance.
- Problem 8.37 gives a toroid of known reluctance with windings $N_1$ and $N_2$ and asks for both self-inductances and mutual inductance.
- Problem 8.38 supplies a rectangular toroidal core with $\mu_r=80$ and windings of 1000 and 2500 turns.
- Problems 8.41 and 8.42 ask for mutual inductance between a rectangular coil and a straight filament and between nearly equal concentric circular rings.
