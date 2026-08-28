---
title: "Cylindrical Differential Lengths, Areas, and Volume"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "cylindrical-differential-lengths-areas-and-volume"
locations: ["Page 27", "Figure 1.6c", "Page 28", "Section: 1.8.3 Differential Area and Volume"]
related: ["cylindrical-coordinates-and-coordinate-surfaces", "spherical-differential-lengths-areas-and-volume", "coordinate-system-applications-and-integration-tasks"]
---

## ConceptNode: Cylindrical Differential Lengths, Areas, and Volume

Planning node for [[cylindrical-differential-lengths-areas-and-volume|1.21 Cylindrical Differential Lengths, Areas, and Volume]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 27, Figure 1.6c, Page 28, Section: 1.8.3 Differential Area and Volume

A small cylindrical-coordinate volume is formed by incrementing $\rho$, $\phi$, and $z$ by $d\rho$, $d\phi$, and $dz$. Its limiting shape has three orthogonal side lengths: $d\rho$ in the radial direction, $\rho\,d\phi$ in the azimuthal direction, and $dz$ in the axial direction. The factor $\rho$ is necessary because $d\phi$ is an angular increment and therefore dimensionless, while the corresponding arc length is $\rho d\phi$. Multiplying pairs of side lengths gives the differential face areas, and multiplying all three gives the volume element. Thus the geometry directly produces the cylindrical Jacobian factor $\rho$. Figure 1.6c is central to this derivation because it presents the truncated wedge and labels the three physical edge lengths from which all area and volume expressions follow.

### Key planning details

- The radial differential length is $d\rho$.
- The azimuthal differential length is $\rho\,d\phi$.
- The axial differential length is $dz$.
- The face normal to $\mathbf{a}_z$ has area $\rho\,d\rho\,d\phi$.
- The face normal to $\mathbf{a}_\phi$ has area $d\rho\,dz$.
- The face normal to $\mathbf{a}_\rho$ has area $\rho\,d\phi\,dz$.
- The differential volume is $dv=\rho\,d\rho\,d\phi\,dz$.

### Source coverage

- Figure 1.6c labels the differential side lengths $d\rho$, $\rho d\phi$, and $dz$.
- The volume is bounded by two cylinders, two radial planes, and two horizontal planes.
- The text emphasizes that $d\phi$ is not a length but $\rho d\phi$ is.
- The listed differential surface areas are $\rho d\rho d\phi$, $d\rho dz$, and $\rho d\phi dz$.
- The volume element is stated as $\rho d\rho d\phi dz$.
