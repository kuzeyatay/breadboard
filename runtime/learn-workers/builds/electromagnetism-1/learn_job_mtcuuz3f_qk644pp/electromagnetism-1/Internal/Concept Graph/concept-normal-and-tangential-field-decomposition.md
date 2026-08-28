---
title: "Normal and Tangential Field Decomposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "normal-and-tangential-field-decomposition"
locations: ["Page 151", "Problems D5.9 and D5.10"]
related: ["refraction-of-fields-at-a-dielectric-boundary", "fields-and-polarization-inside-a-teflon-slab", "dielectric-polarization-and-effective-permittivity-tasks"]
---

## ConceptNode: Normal and Tangential Field Decomposition

Planning node for [[normal-and-tangential-field-decomposition|1.70 Normal and Tangential Field Decomposition]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 151, Problems D5.9 and D5.10

Boundary calculations become systematic when a vector field is decomposed into components normal and tangential to the interface. For the plane $z=0$, the normal direction is $\mathbf a_z$, so the normal component of $\mathbf D_1$ is obtained by projection onto $\mathbf a_z$, while the remaining $x$ and $y$ components form the tangential vector. The angle from the normal follows from the ratio of tangential to normal magnitudes. Across a charge-free dielectric boundary, the normal flux density remains unchanged, but tangential electric field continuity requires the tangential flux density to scale with permittivity. Problems D5.9 and D5.10 provide a complete numerical sequence for this procedure. They begin with $\mathbf D_1$, calculate its normal and tangential parts, magnitude, and angle, then transfer the field into Region 2 and calculate polarization. The polarization in a linear dielectric can be obtained from $\mathbf P=\mathbf D-\epsilon_0\mathbf E$, equivalently $\mathbf P=(1-1/\epsilon_r)\mathbf D$. This pair of exercises is a reusable template for planar-interface problems involving arbitrary vector orientations.

### Key planning details

- For the plane $z=0$, the normal component is the $z$ component.
- The tangential vector contains the $x$ and $y$ components.
- The field angle from the normal satisfies $\tan\theta=D_t/D_N$.
- With no free surface charge, $D_{N1}=D_{N2}$.
- Tangential $\mathbf E$ continuity gives $\mathbf D_{t2}=(\epsilon_2/\epsilon_1)\mathbf D_{t1}$.
- Polarization follows from $\mathbf P=\mathbf D-\epsilon_0\mathbf E$.

### Source coverage

- D5.9 uses $\epsilon_{r1}=3.2$ and $\mathbf D_1=-30\mathbf a_x+50\mathbf a_y+70\mathbf a_z$ nC/m$^2$.
- D5.9 gives $D_{N1}=70$ nC/m$^2$, $D_{t1}=58.3$ nC/m$^2$, $D_1=91.1$ nC/m$^2$, and $\theta_1=39.8^\circ$.
- D5.10 gives $\mathbf D_{N2}=70\mathbf a_z$ nC/m$^2$.
- D5.10 gives $\mathbf D_{t2}=-18.75\mathbf a_x+31.25\mathbf a_y$ nC/m$^2$.
- D5.10 gives $\theta_2=27.5^\circ$ and $\mathbf P_2=-9.38\mathbf a_x+15.63\mathbf a_y+35\mathbf a_z$ nC/m$^2$.
