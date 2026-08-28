---
title: "Anisotropic and Nonlinear Magnetic Media"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "anisotropic-and-nonlinear-magnetic-media"
locations: ["Page 265", "Page 266", "Section 8.6"]
related: ["linear-magnetic-constitutive-relations", "ferromagnetic-magnetization-and-hysteresis", "nonlinear-gapped-magnetic-circuit-analysis"]
---

## ConceptNode: Anisotropic and Nonlinear Magnetic Media

Planning node for [[anisotropic-and-nonlinear-magnetic-media|1.122 Anisotropic and Nonlinear Magnetic Media]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 265, Page 266, Section 8.6

The scalar permeability relation $\mathbf{B}=\mu\mathbf{H}$ is restricted to isotropic media. In an anisotropic magnetic material, permeability is a $3\times3$ matrix and each component of $\mathbf{B}$ can depend on all three components of $\mathbf{H}$. For example, $B_x=\mu_{xx}H_x+\mu_{xy}H_y+\mu_{xz}H_z$, with corresponding expressions for $B_y$ and $B_z$. The general identity $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$ remains valid, but $\mathbf{B}$, $\mathbf{H}$, and $\mathbf{M}$ need not be parallel. Single ferromagnetic crystals and thin magnetic films are common anisotropic systems, while many practical ferromagnetic components are polycrystalline. Linearity is another independent assumption. Diamagnetic and paramagnetic materials are commonly close to linear, with relative permeability usually differing from unity by less than about one part in a thousand. Ferromagnetic materials can have effective relative-permeability ratios ranging approximately from 10 to 100,000, but their $B$ versus $H$ response is generally nonlinear and history-dependent. Consequently, a fixed scalar permeability cannot fully describe ferromagnetic operation over a wide field range.

### Key planning details

- Anisotropic permeability is represented by a $3\times3$ matrix.
- Off-diagonal permeability terms couple different field components.
- In anisotropic media, $\mathbf{B}$ and $\mathbf{H}$ are not generally parallel.
- The identity $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$ remains valid for anisotropic materials.
- Single ferromagnetic crystals and thin magnetic films commonly exhibit anisotropy.
- Diamagnetic and paramagnetic materials usually have $\mu_r$ very close to one.
- Ferromagnetic materials can exhibit very large but nonlinear effective permeability.
- A constant susceptibility or permeability requires a linear operating regime.

### Source coverage

- Page 265 gives the component equations for the $3\times3$ permeability matrix.
- The text states that $\mathbf{B}$, $\mathbf{H}$, and $\mathbf{M}$ are not generally parallel in anisotropic media.
- Representative diamagnetic susceptibilities include hydrogen at $-2\times10^{-5}$ and graphite at $-12\times10^{-5}$.
- Representative paramagnetic susceptibilities include oxygen at $2\times10^{-6}$ and ferric oxide at $1.4\times10^{-3}$.
- Page 266 reports typical effective ferromagnetic $\mu_r$ values from 10 to 100,000.
- Diamagnetic, paramagnetic, and antiferromagnetic materials are commonly described as nonmagnetic in engineering usage.
