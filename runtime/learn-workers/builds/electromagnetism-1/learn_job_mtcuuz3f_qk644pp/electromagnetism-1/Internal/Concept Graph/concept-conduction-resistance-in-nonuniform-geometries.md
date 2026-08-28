---
title: "Conduction Resistance in Nonuniform Geometries"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "conduction-resistance-in-nonuniform-geometries"
locations: ["Page 153", "Page 154", "Chapter 5 Problems 5.8 through 5.19"]
related: ["charge-continuity-and-current-flux-tasks", "coaxial-and-spherical-capacitor-geometries", "series-and-parallel-multiple-dielectric-capacitors"]
---

## ConceptNode: Conduction Resistance in Nonuniform Geometries

Planning node for [[conduction-resistance-in-nonuniform-geometries|1.73 Conduction Resistance in Nonuniform Geometries]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 153, Page 154, Chapter 5 Problems 5.8 through 5.19

Problems 5.8 through 5.19 form a sustained practice sequence on steady conduction through geometries with changing cross section or spatially varying conductivity. The core relations are $\mathbf J=\sigma\mathbf E$, voltage as a line integral of $\mathbf E$, and total current as the surface integral of $\mathbf J$. For a one-dimensional current path whose area or conductivity varies, a differential resistance can be written as $dR=d\ell/[\sigma(\ell)A(\ell)]$ and integrated as a series combination. If current paths occupy side-by-side differential regions under the same voltage, their differential conductances combine in parallel. The problems apply these ideas to a truncated cone, washer, coaxial cylinders, parallel plates, hollow tubes, hemispherical shells, and radially graded media. Several exercises explicitly request two derivations of the same resistance, first from field and current relations and then from differential shell combinations. This reinforces the physical distinction between series layers along the current direction and parallel paths distributed across the conducting area.

### Key planning details

- Ohm's law in point form is $\mathbf J=\sigma\mathbf E$.
- Resistance follows from the ratio of potential difference to total current.
- Layers traversed sequentially by current combine as differential series resistances.
- Side-by-side current channels under a common voltage combine in parallel.
- Spatial variation of $\sigma$ changes $\mathbf E$ even when current continuity fixes $\mathbf J$.
- Power consistency can be checked by integrating volumetric dissipation.

### Source coverage

- Problem 5.8 asks for the resistance of a conducting truncated cone.
- Problem 5.11 treats radial current between coaxial cylindrical surfaces and verifies total dissipated power by volume integration.
- Problem 5.12 uses $\sigma(z)=\sigma_0e^{-z/d}$ between parallel plates.
- Problem 5.15 uses a hemispherical shell with $\sigma(r)=\sigma_0a/r$.
- Problem 5.16 uses a coaxial medium with $\sigma(\rho)=\sigma_0/\rho$ and asks for conductance per unit length.
- Problems 5.17 and 5.19 explicitly reconstruct resistance from differential shell combinations.
