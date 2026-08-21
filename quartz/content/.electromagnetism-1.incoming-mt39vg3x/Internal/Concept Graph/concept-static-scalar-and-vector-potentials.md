---
title: "Static Scalar and Vector Potentials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "static-scalar-and-vector-potentials"
locations: ["Page 306", "Section 9.5: The Retarded Potentials"]
related: ["time-varying-electromagnetic-potentials", "lorenz-gauge-and-potential-wave-equations", "retarded-scalar-and-vector-potentials"]
---

## ConceptNode: Static Scalar and Vector Potentials

Planning node for [[static-scalar-and-vector-potentials|1.152 Static Scalar and Vector Potentials]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 306, Section 9.5: The Retarded Potentials

The time-varying potential theory begins from the familiar static and direct-current cases. A static volume charge distribution produces the scalar electric potential $$V=\int_{\mathrm{vol}}\frac{\rho_v\,dv}{4\pi\epsilon R},$$ where $\rho_v$ is volume charge density, $dv$ is a source volume element, $\epsilon$ is permittivity, and $R$ is the distance from source element to observation point. A steady current distribution similarly produces the vector magnetic potential $$\mathbf{A}=\int_{\mathrm{vol}}\frac{\mu\mathbf{J}\,dv}{4\pi R},$$ where $\mu$ is permeability and $\mathbf{J}$ is current density. Their differential forms are Poisson equations, $\nabla^2V=-\rho_v/\epsilon$ and $\nabla^2\mathbf{A}=-\mu\mathbf{J}$. Once the potentials are known, static fields follow from $\mathbf{E}=-\nabla V$ and $\mathbf{B}=\nabla\times\mathbf{A}$. These relations provide the consistency target for defining time-varying potentials.

### Key planning details

- Static scalar potential is an inverse-distance integral over volume charge.
- DC vector potential is an inverse-distance integral over volume current density.
- The potentials satisfy scalar and vector Poisson equations.
- Static electric field is the negative gradient of $V$.
- Magnetic flux density is the curl of $\mathbf{A}$.

### Source coverage

- Equations (45) and (46) on Page 306 define the static $V$ and dc $\mathbf{A}$ integrals.
- Equations (47) and (48) give the corresponding Poisson equations.
- Equations (49) and (50) give $\mathbf{E}=-\nabla V$ and $\mathbf{B}=\nabla\times\mathbf{A}$.
- Page 306 states that the differential equations may be regarded as point forms of the integral equations.
