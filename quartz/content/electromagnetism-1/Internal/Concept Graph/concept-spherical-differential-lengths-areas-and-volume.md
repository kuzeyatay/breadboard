---
title: "Spherical Differential Lengths, Areas, and Volume"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "spherical-differential-lengths-areas-and-volume"
locations: ["Page 31", "Figure 1.8d", "Page 32", "Section: 1.9.3 Differential Surfaces and Volume"]
related: ["spherical-coordinates-and-coordinate-surfaces", "cylindrical-differential-lengths-areas-and-volume", "coordinate-system-applications-and-integration-tasks"]
---

## ConceptNode: Spherical Differential Lengths, Areas, and Volume

Planning node for [[spherical-differential-lengths-areas-and-volume|1.26 Spherical Differential Lengths, Areas, and Volume]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 31, Figure 1.8d, Page 32, Section: 1.9.3 Differential Surfaces and Volume

The spherical differential volume element follows from three local orthogonal lengths. Increasing $r$ by $dr$ separates neighboring spheres by $dr$. Increasing $\theta$ by $d\theta$ separates neighboring cones by the arc length $r\,d\theta$. Increasing $\phi$ by $d\phi$ separates neighboring radial planes by $r\sin\theta\,d\phi$, because the relevant circle around the $z$ axis has radius $r\sin\theta$. Pairwise products of these lengths give the differential surface areas, while the product of all three gives the volume. The resulting factor $r^2\sin\theta$ records how coordinate spacing expands with radius and varies with polar angle. Figure 1.8d is source-central because it shows the differential cell whose edge lengths motivate these formulas rather than presenting the formulas as facts to memorize.

### Key planning details

- The radial differential length is $dr$.
- The polar differential length is $r\,d\theta$.
- The azimuthal differential length is $r\sin\theta\,d\phi$.
- One differential area is $r\,dr\,d\theta$.
- A second differential area is $r\sin\theta\,dr\,d\phi$.
- The area on a sphere is $r^2\sin\theta\,d\theta\,d\phi$.
- The differential volume is $dv=r^2\sin\theta\,dr\,d\theta\,d\phi$.

### Source coverage

- Figure 1.8d shows the spherical differential volume element.
- The distance between neighboring spheres is stated as $dr$.
- The distance between neighboring cones is stated as $r d\theta$.
- The distance between neighboring radial planes is stated as $r\sin\theta d\phi$.
- The three surface areas and the volume $r^2\sin\theta dr d\theta d\phi$ are explicitly listed.
