---
title: "1.152 Static Scalar and Vector Potentials"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 306", "Section 9.5: The Retarded Potentials"]
related: ["time-varying-electromagnetic-potentials", "lorenz-gauge-and-potential-wave-equations", "retarded-scalar-and-vector-potentials"]
---

# 1.152 Static Scalar and Vector Potentials

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 306, Section 9.5: The Retarded Potentials

The time-varying potential theory begins from the familiar static and direct-current cases. A static volume charge distribution produces the scalar electric potential
$$
V=\int_{\mathrm{vol}}\frac{\rho_v\,dv}{4\pi\epsilon R}
$$
 where $\rho_v$ is volume charge density, $dv$ is a source volume element, $\epsilon$ is permittivity, and $R$ is the distance from source element to observation point. A steady current distribution similarly produces the vector magnetic potential
$$
\mathbf{A}=\int_{\mathrm{vol}}\frac{\mu\mathbf{J}\,dv}{4\pi R}
$$
 where $\mu$ is permeability and $\mathbf{J}$ is current density. Their differential forms are Poisson equations, $\nabla^2V=-\rho_v/\epsilon$ and $\nabla^2\mathbf{A}=-\mu\mathbf{J}$. Once the potentials are known, static fields follow from $\mathbf{E}=-\nabla V$ and $\mathbf{B}=\nabla\times\mathbf{A}$. These relations provide the consistency target for defining time-varying potentials.

## Page-Grounded Details

#### Page 306

D9.5. The unit vector $0.64\mathbf{a}_{x}+0.6\mathbf{a}_{y}-0.48\mathbf{a}_{z}$ is directed from region 2 ($\epsilon_{r}=2,\mu_{r}=3,\sigma_{2}=0$) toward region 1 ($\epsilon_{r1}=4,\mu_{r1}=2,\sigma_{1}=0$). If $\mathbf{B}_{1}=(\mathbf{a}_{x}-2\mathbf{a}_{y}+3\mathbf{a}_{z})\sin300t$ T at point P in region 1 adjacent to the boundary, find the amplitude at P of: (a) $\mathbf{B}_{N1}$ ; (b) $\mathbf{B}_{t1}$ ; (c) $\mathbf{B}_{N2}$ ; (d) $\mathbf{B}_{2}$.

Ans. (a) 2.00 T; (b) 3.16 T; (c) 2.00 T; (d) 5.15 T

D9.6. The surface $y=0$ is a perfectly conducting plane, whereas the region$y>0$ has $\epsilon_{r}=5,\mu_{r}=3$ , and $\sigma=0$ . Let $\mathbf{E}=20\cos(2\times 10^{8}t-2.58z)\mathbf{a}_{y}$ V/m for$y>0$ , and find at $t=6$ ns; (a) $\rho_{S}$ at P(2, 0, 0.3); (b) $\mathbf{H}$ at P; (c) $\mathbf{K}$ at P.

Ans. (a) 0.81 nC/m^2; (b) $-62.3\mathbf{a}_{x}$ mA/m; (c) $-62.3\mathbf{a}_{z}$ mA/m

#### 9.5 THE RETARDED POTENTIALS

The time-varying potentials, usually called retarded potentials for a reason that we will see shortly, find their greatest application in radiation problems (to be addressed in Chapter 14) in which the distribution of t

[Truncated for analysis]

## Core Ideas

- Static scalar potential is an inverse-distance integral over volume charge.
- DC vector potential is an inverse-distance integral over volume current density.
- The potentials satisfy scalar and vector Poisson equations.
- Static electric field is the negative gradient of $V$.
- Magnetic flux density is the curl of $\mathbf{A}$.

## Source Anchors

- Equations (45) and (46) on Page 306 define the static $V$ and dc $\mathbf{A}$ integrals.
- Equations (47) and (48) give the corresponding Poisson equations.
- Equations (49) and (50) give $\mathbf{E}=-\nabla V$ and $\mathbf{B}=\nabla\times\mathbf{A}$.
- Page 306 states that the differential equations may be regarded as point forms of the integral equations.

## Related Pages

- [[time-varying-electromagnetic-potentials|Time-Varying Electromagnetic Potentials]]
- [[lorenz-gauge-and-potential-wave-equations|Lorenz Gauge and Potential Wave Equations]]
- [[retarded-scalar-and-vector-potentials|Retarded Scalar and Vector Potentials]]

