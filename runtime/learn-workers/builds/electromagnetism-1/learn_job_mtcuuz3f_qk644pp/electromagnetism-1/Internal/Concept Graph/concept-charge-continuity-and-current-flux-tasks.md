---
title: "Charge Continuity and Current-Flux Tasks"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "charge-continuity-and-current-flux-tasks"
locations: ["Page 152", "Chapter 5 Problems 5.1 through 5.7"]
related: ["conduction-resistance-in-nonuniform-geometries", "semiconductor-conductivity-from-carrier-transport"]
---

## ConceptNode: Charge Continuity and Current-Flux Tasks

Planning node for [[charge-continuity-and-current-flux-tasks|1.72 Charge Continuity and Current-Flux Tasks]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 152, Chapter 5 Problems 5.1 through 5.7

The opening Chapter 5 problem set develops reusable methods for converting a current-density field into total current and for enforcing charge conservation. Total current through a surface is found from $I=\int_S\mathbf J\cdot d\mathbf S$, with the surface normal selecting the relevant component and sign. For a closed surface, the same outward current can be calculated directly over all faces or through the divergence theorem. Time-varying charge and current are linked by the continuity equation, so a specified charge density can constrain the spatial form of $\mathbf J$. The propagating-wave problem introduces $\mathbf J(z,t)=J_0\cos(\omega t-\beta z)\mathbf a_z$ and asks for the relation between phase constant $\beta$, angular frequency $\omega$, and propagation velocity $v$. Other tasks apply current flux in spherical coordinates, rotational motion of a uniformly charged sphere, and a mass-conservation analogy. Together these problems teach a general procedure: identify the correct surface orientation, evaluate flux, and verify consistency with the differential conservation law.

### Key planning details

- Current through a surface is the flux of $\mathbf J$ through that surface.
- Closed-surface current can be evaluated directly or with the divergence theorem.
- The continuity equation connects charge accumulation to current divergence.
- Coordinate-dependent current fields require the corresponding surface element.
- A rotating volume charge distribution produces an effective current.
- The continuity equation also models conserved quantities such as mass.

### Source coverage

- Problem 5.1 asks for current through $y=1$, then outward current from a region by both surface integration and the divergence theorem.
- Problem 5.3 asks for the total current associated with a uniformly charged sphere rotating at angular velocity $\Omega$.
- Problem 5.4 gives $\rho_v=(\cos\omega t)/r^2$ C/m$^3$ and asks for $\mathbf J$.
- Problem 5.5 specifies $\mathbf J(z,t)=J_0\cos(\omega t-\beta z)\mathbf a_z$ A/m$^2$.
- Problem 5.6 asks for current through circular disks from a spherical-coordinate $\mathbf a_\theta$ current density.
- Problem 5.7 transfers the charge-continuity model to mass density and mass flow.
