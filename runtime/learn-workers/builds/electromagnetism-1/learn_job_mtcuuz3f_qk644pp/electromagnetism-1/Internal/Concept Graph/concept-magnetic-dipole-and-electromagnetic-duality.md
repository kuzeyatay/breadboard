---
title: "Magnetic Dipole and Electromagnetic Duality"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-dipole-and-electromagnetic-duality"
locations: ["Page 539", "Page 540", "Section 14.3", "Figure 14.5"]
related: ["radiation-from-time-varying-currents-and-the-hertzian-dipole-model", "general-electromagnetic-fields-of-a-hertzian-dipole", "near-field-and-far-field-behavior"]
---

## ConceptNode: Magnetic Dipole and Electromagnetic Duality

Planning node for [[magnetic-dipole-and-electromagnetic-duality|1.315 Magnetic Dipole and Electromagnetic Duality]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 539, Page 540, Section 14.3, Figure 14.5

A small circular current loop acts as a magnetic dipole whose field pattern is dual to that of the electric Hertzian dipole. The loop has radius $a$, lies in the $xy$ plane, is centered at the origin, and carries $I(t)=I_0\cos\omega t$. Rather than deriving its fields from the retarded potential again, the source exploits electromagnetic duality. In a source-free medium, Maxwell's equations retain their form under the substitutions $\mathbf{E}\to\mathbf{H}$, $\mathbf{H}\to-\mathbf{E}$, $\epsilon\to\mu$, and $\mu\to\epsilon$. A static-axis comparison between the electric dipole and current loop establishes the required source substitution. The electric dipole moment term is related to the loop area $\pi a^2$ using the harmonic current-charge relation $I_0=j\omega Q$. Applying the duality substitutions to the Hertzian-dipole fields produces the loop components $E_{\phi s}$, $H_{rs}$, and $H_{\theta s}$. In the far field, only $E_{\phi s}$ and $H_{\theta s}$ survive. The electric and magnetic roles are interchanged, but the angular field pattern remains the same.

### Key planning details

- A small current loop is called a magnetic dipole antenna.
- The loop lies in the $xy$ plane and carries sinusoidal current.
- Electric and magnetic dipoles have identical pattern shapes with field roles interchanged.
- Source-free Maxwell equations exhibit electric-magnetic duality.
- The substitutions include $\mathbf{E}\to\mathbf{H}$ and $\mathbf{H}\to-\mathbf{E}$.
- Permittivity and permeability are also interchanged.
- The loop source strength contains its area $\pi a^2$.
- In the far zone, $E_{\phi s}$ and $H_{\theta s}$ are the surviving loop fields.

### Source coverage

- Figure 14.5 shows electric and magnetic dipoles as dual structures with interchanged $\mathbf{E}$ and $\mathbf{H}$ roles.
- The source-free equations include $\nabla\times\mathbf{H}=\epsilon\,\partial\mathbf{E}/\partial t$ and $\nabla\times\mathbf{E}=-\mu\,\partial\mathbf{H}/\partial t$.
- The static electric-dipole axis field is $$\mathbf{E}|_{\theta=0}=\frac{Qd}{2\pi\epsilon z^3}\mathbf{a}_z.$$
- The static current-loop axis field is $$\mathbf{H}|_{\theta=0}=\frac{\pi a^2I_0}{2\pi z^3}\mathbf{a}_z.$$
- The harmonic relation is $$I_0=j\omega Q\quad\Rightarrow\quad Q=\frac{I_0}{j\omega}.$$
- The source states that the substitution $d\to j\omega\epsilon(\pi a^2)$, together with the field and material exchanges, transforms the electric-dipole solution into the loop solution.
- The loop field equations are given as Eqs. (48) through (50).
