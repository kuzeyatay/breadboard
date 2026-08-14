---
title: "Coaxial and Spherical Capacitor Geometries"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "coaxial-and-spherical-capacitor-geometries"
locations: ["Page 161", "Section 6.3.1: Coaxial Cable", "Section 6.3.2: Spherical Capacitor"]
related: ["capacitance-as-a-charge-to-potential-ratio", "series-and-parallel-multiple-dielectric-capacitors", "conduction-resistance-in-nonuniform-geometries"]
---

## ConceptNode: Coaxial and Spherical Capacitor Geometries

Planning node for [[coaxial-and-spherical-capacitor-geometries|1.81 Coaxial and Spherical Capacitor Geometries]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 161, Section 6.3.1: Coaxial Cable, Section 6.3.2: Spherical Capacitor

Capacitance for symmetric geometries follows from the same charge-to-potential definition once the electric field and voltage are known. A coaxial capacitor with inner radius $a$, outer radius $b$, length $L$, and dielectric permittivity $\epsilon$ has $$C=\frac{2\pi\epsilon L}{\ln(b/a)}.$$ For concentric spherical conductors of radii $a$ and $b$, Gauss's law gives $E_r=Q/(4\pi\epsilon r^2)$. Integrating this radial field produces $V_{ab}=Q(1/a-1/b)/(4\pi\epsilon)$, so $$C=\frac{4\pi\epsilon}{1/a-1/b}.$$ Sending the outer radius to infinity gives the capacitance of an isolated spherical conductor, $C=4\pi\epsilon a$. The source notes that a free-space sphere of diameter 1 cm has capacitance $0.556$ pF. These derivations illustrate a durable method: exploit symmetry to obtain $\mathbf D$ or $\mathbf E$, integrate the field to find voltage, and divide charge by voltage.

### Key planning details

- Coaxial capacitance depends logarithmically on the radius ratio.
- Spherical capacitance follows from the inverse-square radial field.
- The concentric-sphere voltage is proportional to $1/a-1/b$.
- An isolated sphere is obtained by taking $b\to\infty$.
- All formulas scale linearly with dielectric permittivity.
- The derivation sequence is field, voltage, then charge-to-voltage ratio.

### Source coverage

- Equation (5): $C=2\pi\epsilon L/\ln(b/a)$ for a coaxial cable.
- The spherical field is $E_r=Q/(4\pi\epsilon r^2)$.
- The spherical potential difference is $V_{ab}=Q(1/a-1/b)/(4\pi\epsilon)$.
- Equation (6): $C=4\pi\epsilon/(1/a-1/b)$.
- Equation (7): $C=4\pi\epsilon a$ for an isolated sphere.
- A 1 cm diameter sphere in free space has $C=0.556$ pF.
