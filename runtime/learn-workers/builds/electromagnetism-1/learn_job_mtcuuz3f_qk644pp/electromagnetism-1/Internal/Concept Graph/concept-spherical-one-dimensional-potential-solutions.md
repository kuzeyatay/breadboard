---
title: "Spherical One-Dimensional Potential Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "spherical-one-dimensional-potential-solutions"
locations: ["Page 180", "Page 181", "Page 182"]
related: ["direct-integration-of-one-dimensional-laplace-problems", "potential-to-charge-capacitance-workflow", "cylindrical-one-dimensional-potential-solutions", "laplace-and-poisson-boundary-value-problem-family"]
---

## ConceptNode: Spherical One-Dimensional Potential Solutions

Planning node for [[spherical-one-dimensional-potential-solutions|1.95 Spherical One-Dimensional Potential Solutions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 180, Page 181, Page 182

Spherical coordinates also provide two distinct one-dimensional solutions. For radial dependence $V=V(r)$ between concentric spheres of radii $a$ and $b$, with $V=V_0$ at $r=a$ and $V=0$ at $r=b$, the potential is $$V=V_0\frac{1/r-1/b}{1/a-1/b}.$$ The corresponding capacitance is $$C=\frac{4\pi\epsilon}{1/a-1/b}.$$ For polar-angle dependence $V=V(\theta)$, Laplace's equation reduces to $$\frac{1}{r^2\sin\theta}\frac{d}{d\theta}\left(\sin\theta\frac{dV}{d\theta}\right)=0.$$ Excluding $r=0$ and $\theta=0,\pi$, integration gives $$V=A\ln\left(\tan\frac{\theta}{2}\right)+B.$$ Constant-$\theta$ surfaces are cones. For a cone at $\theta=\alpha$ held at $V_0$ and a plane at $\theta=\pi/2$ held at zero, the potential is the ratio of logarithms shown in Equation (42). The ideal infinite cone yields infinite charge and capacitance, so a finite cone of length $r_1$ is approximated by $$C\doteq\frac{2\pi\epsilon r_1}{\ln(\cot(\alpha/2))}.$$

### Key planning details

- Radial spherical symmetry produces a potential affine in $1/r$.
- The concentric-sphere capacitance is $4\pi\epsilon/(1/a-1/b)$.
- Polar-angle symmetry produces $\ln(\tan(\theta/2))$ dependence.
- Constant-$\theta$ equipotential surfaces are cones.
- The cone-plane field has only a $\mathbf{a}_\theta$ component.
- An ideal cone extending to infinity has infinite capacitance.
- Finite-cone capacitance is approximate because edge fringing is neglected.

### Source coverage

- Equation (39) gives the concentric-sphere potential.
- Equation (40) gives the concentric-sphere capacitance.
- Equation (41) gives $V=A\ln(\tan(\theta/2))+B$.
- S1.P181.F1, Figure 6.11 shows a cone at $\theta=\alpha$ and a plane at $\theta=\pi/2$.
- Equation (42) applies $V=V_0$ on the cone and zero potential on the plane.
- The charge integral from $r=0$ to infinity diverges.
- The finite-size approximation uses $C\doteq2\pi\epsilon r_1/\ln(\cot(\alpha/2))$.
