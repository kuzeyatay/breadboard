---
title: "Potential-to-Charge Capacitance Workflow"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "potential-to-charge-capacitance-workflow"
locations: ["Page 177", "Page 178"]
related: ["direct-integration-of-one-dimensional-laplace-problems", "cylindrical-one-dimensional-potential-solutions", "spherical-one-dimensional-potential-solutions", "capacitance-estimation-from-a-flux-plot"]
---

## ConceptNode: Potential-to-Charge Capacitance Workflow

Planning node for [[potential-to-charge-capacitance-workflow|1.93 Potential-to-Charge Capacitance Workflow]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 177, Page 178

Once a potential function has been found from Laplace's equation, capacitance is obtained by systematically reconstructing the field and conductor charge. First calculate $\mathbf{E}=-\nabla V$. Next use $\mathbf{D}=\epsilon\mathbf{E}$. Evaluate the normal component of $\mathbf{D}$ at a conductor surface, identify $\rho_S=D_N$, and integrate the surface charge density to obtain $Q$. Finally use $C=|Q|/V_0$. For the parallel-plate solution $V=V_0x/d$, the source obtains $$\mathbf{E}=-\frac{V_0}{d}\mathbf{a}_x,$$ $$\mathbf{D}=-\epsilon\frac{V_0}{d}\mathbf{a}_x,$$ and, on the plate at $x=0$ with outward normal $\mathbf{a}_x$, $$\rho_S=-\epsilon\frac{V_0}{d}.$$ Integrating over plate area $S$ gives $Q=-\epsilon V_0S/d$, so the capacitance magnitude is $$C=\frac{\epsilon S}{d}.$$ This workflow is reused for cylindrical and spherical capacitor geometries.

### Key planning details

- Compute $\mathbf{E}$ from the negative gradient of $V$.
- Compute $\mathbf{D}$ using the material permittivity.
- Evaluate the normal flux density at the conductor.
- Use $\rho_S=D_N$ at the conductor surface.
- Integrate $\rho_S$ over the conductor to find total charge.
- Use the magnitude of charge in $C=|Q|/V_0$.
- For parallel plates, $C=\epsilon S/d$.

### Source coverage

- Example 6.2 lists the five-step potential-to-charge procedure.
- At $x=0$, $\mathbf{D}_S=-\epsilon V_0\mathbf{a}_x/d$.
- The source identifies $D_N=\rho_S$.
- The surface integral gives $Q=-\epsilon V_0S/d$.
- Equation (33) gives $C=\epsilon S/d$.
- The text states that the procedure will be reused in later examples.
