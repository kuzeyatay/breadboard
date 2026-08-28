---
title: "Uniform Plane Waves from Sourceless Maxwell Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "uniform-plane-waves-from-sourceless-maxwell-equations"
locations: ["Page 381", "Page 382"]
related: ["free-space-electromagnetic-wave-equation", "intrinsic-impedance-and-field-orientation", "vector-helmholtz-equation-in-free-space"]
---

## ConceptNode: Uniform Plane Waves from Sourceless Maxwell Equations

Planning node for [[uniform-plane-waves-from-sourceless-maxwell-equations|1.213 Uniform Plane Waves from Sourceless Maxwell Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 381, Page 382

A uniform plane wave is introduced as the simplest electromagnetic-wave model and as a useful approximation for practical waves over a limited region. In free space the medium is sourceless, so $\rho_v=0$ and $\mathbf{J}=0$, leaving Maxwell's equations in terms of $\mathbf{E}$ and $\mathbf{H}$. A time-varying electric field produces a magnetic field with curl, while a time-varying magnetic field produces an electric field with curl. This coupled process permits an electromagnetic disturbance to propagate without a transmission-line structure. For a uniform plane wave, both fields lie in a plane transverse to the direction of travel and remain constant in magnitude across that transverse plane, which is why the wave is also called transverse electromagnetic, or TEM. Choosing propagation along $z$ and electric polarization along $x$ restricts the fields to $\mathbf{E}=E_x\mathbf{a}_x$ and $\mathbf{H}=H_y\mathbf{a}_y$, with spatial variation only in $z$. Thus the electric field, magnetic field, and propagation direction are mutually orthogonal.

### Key planning details

- Free space is sourceless in this treatment: $\rho_v=0$ and $\mathbf{J}=0$.
- Time-varying electric and magnetic fields generate one another through Maxwell's curl equations.
- A uniform plane wave is constant across every plane transverse to propagation.
- A TEM wave has both $\mathbf{E}$ and $\mathbf{H}$ transverse to its propagation direction.
- For $+z$ propagation with $x$-polarized electric field, the magnetic field is $y$ directed.
- All field variation in the selected uniform-wave model occurs along $z$.
- Transmission-line waves provide a direct analogy for unconstrained field propagation.

### Source coverage

- Page 381 describes a transmission line as a structure that confines fields while allowing them to propagate as voltage and current waves.
- The free-space assumptions are explicitly $\rho_v=\mathbf{J}=0$.
- For $\mathbf{E}=E_x\mathbf{a}_x$ varying only with $z$, the curl equation becomes $\nabla\times\mathbf{E}=(\partial E_x/\partial z)\mathbf{a}_y=-\mu_0(\partial H_y/\partial t)\mathbf{a}_y$.
- For $\mathbf{H}=H_y\mathbf{a}_y$ varying only with $z$, $\nabla\times\mathbf{H}=-(\partial H_y/\partial z)\mathbf{a}_x=\epsilon_0(\partial E_x/\partial t)\mathbf{a}_x$.
- Page 382 figure 1 should be retained as S1.P382.F1 and used as the source representation of the four sourceless Maxwell equations.
