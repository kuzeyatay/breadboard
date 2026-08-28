---
title: "1.148 Maxwell Equations in Integral Form and Field Boundaries"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 304"]
related: ["maxwell-equations-and-supporting-constitutive-relations", "transformer-emf-and-the-differential-form-of-faradays-law", "capacitor-illustration-of-displacement-current", "magnetic-material-interfaces-and-spatially-varying-permeability"]
---

# 1.148 Maxwell Equations in Integral Form and Field Boundaries

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 304

The integral forms express Maxwell's equations through measurable circulation and flux quantities. Applying Stokes' theorem to the curl equations gives Faraday's law
$$
\oint\mathbf{E}\cdot d\mathbf{L}=-\int_S\frac{\partial\mathbf{B}}{\partial t}\cdot d\mathbf{S}
$$
 and the Ampère-Maxwell law
$$
\oint\mathbf{H}\cdot d\mathbf{L}=I+\int_S\frac{\partial\mathbf{D}}{\partial t}\cdot d\mathbf{S}
$$
 Applying the divergence theorem to the divergence equations gives Gauss's electric law
$$
\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_{\mathrm{vol}}\rho_v\,dv
$$
 and Gauss's magnetic law
$$
\oint_S\mathbf{B}\cdot d\mathbf{S}=0
$$
 The source explains that experimental laws naturally concern macroscopic integral quantities, while differential equations represent a local field theory. Integral equations also generate boundary conditions needed to determine constants when partial differential equations are solved in adjoining media. For two physical media with no singular boundary behavior in the stated setup, Faraday's integral law gives continuity of tangential electric field,
$$
E_{t1}=E_{t2}
$$
 This connects global circulation laws to local interface constraints.

## Page-Grounded Details

#### Page 304

D9.4. Let $\mu=10^{-5}$ H/m, $\epsilon=4\times 10^{-9}$ F/m, $\sigma=0$, and $\rho_{v}=0$. Find k (including units) so that each of the following pairs of fields satisfies Maxwell's equations: (a) $\mathbf{D}=6\mathbf{a}_{x}-2y\mathbf{a}_{y}+2z\mathbf{a}_{z}$ nC/m^2, $\mathbf{H}=k x\mathbf{a}_{x}+10y\mathbf{a}_{y}-25z\mathbf{a}_{z}$ A/m; (b) $\mathbf{E}=(20y-kt)\mathbf{a}_{x}$ V/m, $\mathbf{H}=(y+2\times 10^{6}t)\mathbf{a}_{z}$ A/m.

Answer. (a) 15 A/m^2; (b) $-2.5\times 10^{8}$ V/(m*s)

#### 9.4 MAXWELL'S EQUATIONS IN INTEGRAL FORM

The integral forms of Maxwell's equations are usually easier to recognize in terms of the experimental laws from which they have been obtained by a generalization process. Experiments must treat physical macroscopic quantities, and their results therefore are expressed in terms of integral relationships. A differential equation always represents a theory. We now collect the integral forms of Maxwell's equations from Section 9.3.

Integrating (20) over a surface and applying Stokes' theorem, we obtain Fara-day's law,
$$
\oint\mathbf{E}\cdot d\mathbf{L}=-\int_{S}\frac{\partial\mathbf{B}}{\partial t}\cdot d\mathbf{S}\qquad(33)
$$
and t

[Truncated for analysis]

## Core Ideas

- Stokes' theorem converts curl equations into closed-path circulation laws.
- The divergence theorem converts divergence equations into closed-surface flux laws.
- Faraday's integral law relates electric circulation to changing magnetic flux.
- The Ampère-Maxwell integral law includes conduction and displacement current.
- Gauss's electric law relates outward electric flux to enclosed charge.
- Gauss's magnetic law states that net magnetic flux through a closed surface is zero.
- Integral laws provide boundary conditions for solutions of the point equations.

## Source Anchors

- Equation (33) gives the integral form of Faraday's law.
- Equation (34) gives the integral Ampère-Maxwell law.
- Equation (35) gives the electric Gauss law in integral form.
- Equation (36) gives zero net magnetic flux through a closed surface.
- The source states that these equations determine boundary conditions for $\mathbf{B}$, $\mathbf{D}$, $\mathbf{H}$, and $\mathbf{E}$.
- Equation (37) gives tangential electric-field continuity as $E_{t1}=E_{t2}$.

## Related Pages

- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
- [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
- [[capacitor-illustration-of-displacement-current|Capacitor Illustration of Displacement Current]]
- [[magnetic-material-interfaces-and-spatially-varying-permeability|Magnetic Material Interfaces and Spatially Varying Permeability]]

## Concept Dependencies

- derives-from: [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
- related: [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
- applies-to: [[capacitor-illustration-of-displacement-current|Capacitor Illustration of Displacement Current]]
