---
title: "1.72 Charge Continuity and Current-Flux Tasks"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 152", "Chapter 5 Problems 5.1 through 5.7"]
related: ["conduction-resistance-in-nonuniform-geometries", "semiconductor-conductivity-from-carrier-transport"]
---

# 1.72 Charge Continuity and Current-Flux Tasks

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 152, Chapter 5 Problems 5.1 through 5.7

The opening Chapter 5 problem set develops reusable methods for converting a current-density field into total current and for enforcing charge conservation. Total current through a surface is found from $I=\int_S\mathbf J\cdot d\mathbf S$, with the surface normal selecting the relevant component and sign. For a closed surface, the same outward current can be calculated directly over all faces or through the divergence theorem. Time-varying charge and current are linked by the continuity equation, so a specified charge density can constrain the spatial form of $\mathbf J$. The propagating-wave problem introduces $\mathbf J(z,t)=J_0\cos(\omega t-\beta z)\mathbf a_z$ and asks for the relation between phase constant $\beta$, angular frequency $\omega$, and propagation velocity $v$. Other tasks apply current flux in spherical coordinates, rotational motion of a uniformly charged sphere, and a mass-conservation analogy. Together these problems teach a general procedure: identify the correct surface orientation, evaluate flux, and verify consistency with the differential conservation law.

## Page-Grounded Details

#### Page 152

3. Fink, D. G., and H. W. Beaty. Standard Handbook for Electrical Engineers. 16th ed. New York: McGraw-Hill, 2013.

4. Maxwell, J. C. A Treatise on Electricity and Magnetism. New York: Cambridge University Press, 2010.

5. Wert, C. A., and R. M. Thomson. Physics of Solids. 2nd ed. New York: McGraw-Hill, 1970. This is an advanced undergraduate-level text that covers metals, semiconductors, and dielectrics.

#### CHAPTER 5 PROBLEMS

5.1

Given the current density $\mathbf{J}=-10^{4}[\sin(2x)e^{-2y}\mathbf{a}_{x}+\cos(2x)e^{-2y}\mathbf{a}_{y}]$ kA/m^2 (a) Find the total current crossing the plane $y=1$ in the $\mathbf{a}_{y}$ direction in the region $0<x<1$, $0<z<2$. (b) Find the total current leaving the region $0<x$, $y<1$, $2<z<3$ by integrating $\mathbf{J}\cdot d\mathbf{S}$ over the surface of the cube. (c) Repeat part b, but use the divergence theorem.

5.2

Given $\mathbf{J}=-10^{-4}(y\mathbf{a}_{x}+x\mathbf{a}_{y})$ A/m^2, find the current crossing the $y=0$ plane in the $-\mathbf{a}_{y}$ direction between $z=0$ and 1, and $x=0$ and 2.

5.3

A solid sphere of radius b contains charge Q, uniformly distributed throughout the sphere volume. The sphere r

[Truncated for analysis]

## Core Ideas

- Current through a surface is the flux of $\mathbf J$ through that surface.
- Closed-surface current can be evaluated directly or with the divergence theorem.
- The continuity equation connects charge accumulation to current divergence.
- Coordinate-dependent current fields require the corresponding surface element.
- A rotating volume charge distribution produces an effective current.
- The continuity equation also models conserved quantities such as mass.

## Source Anchors

- Problem 5.1 asks for current through $y=1$, then outward current from a region by both surface integration and the divergence theorem.
- Problem 5.3 asks for the total current associated with a uniformly charged sphere rotating at angular velocity $\Omega$.
- Problem 5.4 gives $\rho_v=(\cos\omega t)/r^2$ C/m$^3$ and asks for $\mathbf J$.
- Problem 5.5 specifies $\mathbf J(z,t)=J_0\cos(\omega t-\beta z)\mathbf a_z$ A/m$^2$.
- Problem 5.6 asks for current through circular disks from a spherical-coordinate $\mathbf a_\theta$ current density.
- Problem 5.7 transfers the charge-continuity model to mass density and mass flow.

## Related Pages

- [[conduction-resistance-in-nonuniform-geometries|Conduction Resistance in Nonuniform Geometries]]
- [[semiconductor-conductivity-from-carrier-transport|Semiconductor Conductivity from Carrier Transport]]

## Concept Dependencies

- related: [[conduction-resistance-in-nonuniform-geometries|Conduction Resistance in Nonuniform Geometries]]
