---
title: "Magnetic Energy and Transmission-Line Inductance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-energy-and-transmission-line-inductance"
locations: ["Page 288", "Page 289", "Page 290"]
related: ["self-inductance-mutual-inductance-and-flux-linkage", "magnetic-circuits-reluctance-and-air-gaps", "magnetic-force-and-torque-on-charges-and-currents"]
---

## ConceptNode: Magnetic Energy and Transmission-Line Inductance

Planning node for [[magnetic-energy-and-transmission-line-inductance|1.139 Magnetic Energy and Transmission-Line Inductance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 288, Page 289, Page 290

A major group of Chapter 8 problems derives inductance from stored magnetic energy. For a linear medium, the magnetic energy density is integrated over the field-containing volume, and the resulting total energy is equated to $$W_H=\frac{1}{2}LI^2.$$ This provides a reusable path to inductance when the magnetic field is known more easily than the linked flux. The source applies this approach to coaxial lines, cylindrical wires, parallel conducting planes, two-wire lines, toroids, and a cone-sphere structure. Internal inductance arises from magnetic field inside a current-carrying conductor, so it depends on the current distribution. External inductance comes from field outside conductors and commonly produces logarithmic expressions after integrating a $1/\rho$ magnetic field. Composite dielectric or magnetic fillings are handled by dividing the field region into subregions and adding their energy or flux contributions. Problem 8.39 deliberately asks for planar-line inductance by both stored energy and flux, providing a consistency check between two definitions. Problem 8.43 similarly uses energy to establish the internal inductance of a uniformly conducting nonmagnetic wire.

### Key planning details

- Linear magnetic energy is related to inductance by $W_H=\frac{1}{2}LI^2$.
- Energy density must be integrated over every region containing magnetic field.
- Internal inductance is produced by magnetic field inside a conductor.
- Internal inductance depends on current distribution and conductor geometry.
- External inductance often follows from integrating a circumferential field proportional to $1/\rho$.
- Piecewise permeability requires separate regional contributions.
- Energy and flux-linkage methods should produce the same inductance.

### Source coverage

- Problem 8.32 asks for magnetic energy and inductance per unit length of a coaxial transmission line filled with material of relative permeability $\mu_r$.
- Problem 8.34 asks for energy stored per unit length inside a uniformly conducting straight wire.
- Problem 8.36 asks for magnetic energy in the outer conductor region $b<\rho<c$ of a coaxial cable.
- Problem 8.39 derives planar transmission-line inductance first from energy and then from total magnetic flux.
- Problem 8.40 divides a coaxial cable into a magnetic region $a<\rho<c$ and an air region $c<\rho<b$.
- Problem 8.43 states the uniform-wire internal inductance result $\mu_0/(8\pi)\ \mathrm{H/m}$.
- Problem 8.44 gives the approximate two-wire external inductance $(\mu/\pi)\ln(d/a)\ \mathrm{H/m}$.
