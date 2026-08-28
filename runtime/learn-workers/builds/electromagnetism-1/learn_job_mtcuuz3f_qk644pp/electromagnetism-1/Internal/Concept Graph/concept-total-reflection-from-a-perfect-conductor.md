---
title: "Total Reflection from a Perfect Conductor"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "total-reflection-from-a-perfect-conductor"
locations: ["Page 424, perfect-conductor limit", "Page 425, Equations (11) through (14)", "Page 426, Figure 12.2"]
related: ["reflection-and-transmission-coefficients", "standing-wave-ratio-and-extremum-locations", "power-reflectivity-and-conservation", "loss-penetration-depth-and-conductor-power-dissipation"]
---

## ConceptNode: Total Reflection from a Perfect Conductor

Planning node for [[total-reflection-from-a-perfect-conductor|1.247 Total Reflection from a Perfect Conductor]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 424, perfect-conductor limit, Page 425, Equations (11) through (14), Page 426, Figure 12.2

For a perfect conductor, conductivity approaches infinity and the intrinsic impedance of region 2 approaches zero. The transmitted time-varying electric field is therefore zero, while the reflection coefficient becomes $\Gamma=-1$. The reflected electric field has the same amplitude as the incident field but is shifted by $180^\circ$. In a lossless region 1, adding the two counterpropagating fields produces $$E_{xs1}=-j2E_{x10}^{+}\sin(\beta_1z),$$ with instantaneous form $$\mathcal{E}_{x1}(z,t)=2E_{x10}^{+}\sin(\beta_1z)\sin(\omega t).$$ This is a standing wave with electric-field nodes at $z=m\lambda_1/2$, including the conducting boundary. The magnetic standing wave is $$\mathcal{H}_{y1}(z,t)=2\frac{E_{x10}^{+}}{\eta_1}\cos(\beta_1z)\cos(\omega t).$$ Magnetic maxima occur where electric nodes occur, and the two total fields are in time quadrature, producing zero average net power flow.

### Key planning details

- A perfect conductor has $\eta_2=0$ and zero skin depth.
- No time-varying transmitted field exists inside the perfect conductor.
- $\Gamma=-1$ gives complete reflection with a $180^\circ$ electric-field phase reversal.
- Equal counterpropagating amplitudes form a standing wave.
- Electric-field nodes occur at $z=m\lambda_1/2$.
- The conducting surface at $z=0$ is an electric-field node.
- Magnetic maxima coincide with electric nodes.
- The time-average net Poynting power is zero.

### Source coverage

- Page 424 derives $\eta_2=0$, $E_{x20}^{+}=0$, and $\Gamma=-1$ for a perfect conductor.
- Equation (11) gives $E_{xs1}=-j2\sin(\beta_1z)E_{x10}^{+}$.
- Equation (12) gives the instantaneous electric standing wave.
- The node condition is $z=m\lambda_1/2$.
- Equation (14) gives the magnetic standing wave.
- Figure 12.2 shows electric-field zeros at half-wavelength multiples from the conducting surface.
