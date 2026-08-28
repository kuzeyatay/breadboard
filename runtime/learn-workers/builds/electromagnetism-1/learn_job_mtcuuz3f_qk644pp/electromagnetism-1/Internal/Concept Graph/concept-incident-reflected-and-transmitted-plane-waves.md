---
title: "Incident, Reflected, and Transmitted Plane Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "incident-reflected-and-transmitted-plane-waves"
locations: ["Page 421, Chapter 12 introduction and Section 12.1", "Page 422, Figure 12.1 and incident-wave definitions", "Page 423, transmitted and reflected field definitions"]
related: ["boundary-conditions-require-a-reflected-wave", "reflection-and-transmission-coefficients", "power-reflectivity-and-conservation", "multiple-interface-reflection"]
---

## ConceptNode: Incident, Reflected, and Transmitted Plane Waves

Planning node for [[incident-reflected-and-transmitted-plane-waves|1.244 Incident, Reflected, and Transmitted Plane Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 421, Chapter 12 introduction and Section 12.1, Page 422, Figure 12.1 and incident-wave definitions, Page 423, transmitted and reflected field definitions

Normal incidence occurs when a plane wave propagates perpendicular to a planar boundary. The text places the boundary at $z=0$, with region 1 occupying $z<0$ and region 2 occupying $z>0$. An $x$-polarized incident wave travels in the positive $z$ direction in region 1, with magnetic field along $y$. A transmitted wave travels away from the boundary in the positive $z$ direction in region 2 and uses that medium's propagation constant $k_2$ and intrinsic impedance $\eta_2$. Figure 12.1 establishes the geometry and shows that all electric and magnetic fields are parallel to the interface. An additional reflected wave travels in the negative $z$ direction in region 1. Its electric phasor varies as $e^{+jk_1z}$, and its magnetic field carries a minus sign relative to $\mathbf{E}/\eta_1$ so that the Poynting vector points in the negative $z$ direction.

### Key planning details

- Region 1 is $z<0$ and region 2 is $z>0$.
- The incident wave travels in the positive $z$ direction.
- The transmitted wave travels into region 2 in the positive $z$ direction.
- The reflected wave travels in the negative $z$ direction.
- The fields are tangential to the boundary, with $\mathbf{E}$ along $x$ and $\mathbf{H}$ along $y$.
- Each region has its own propagation constant and intrinsic impedance.
- The reflected magnetic field changes sign so that reflected power flows in the negative $z$ direction.

### Source coverage

- Figure 12.1 shows the propagation directions of the incident, reflected, and transmitted waves.
- The incident phasor is $E_{xs1}^{+}(z)=E_{x10}^{+}e^{-jk_1z}$.
- Its magnetic field is $H_{ys1}^{+}(z)=E_{x10}^{+}e^{-jk_1z}/\eta_1$.
- The transmitted fields use $k_2$ and $\eta_2$ in region 2.
- Equation (5) gives $E_{xs1}^{-}(z)=E_{x10}^{-}e^{jk_1z}$.
- Equation (6) gives $H_{ys1}^{-}(z)=-(E_{x10}^{-}/\eta_1)e^{jk_1z}$.
