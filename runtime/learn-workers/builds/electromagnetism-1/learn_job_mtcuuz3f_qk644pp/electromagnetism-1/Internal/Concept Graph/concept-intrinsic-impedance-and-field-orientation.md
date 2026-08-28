---
title: "Intrinsic Impedance and Field Orientation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "intrinsic-impedance-and-field-orientation"
locations: ["Page 387", "Page 388", "Page 389"]
related: ["uniform-plane-waves-from-sourceless-maxwell-equations", "phasor-representation-of-uniform-plane-waves", "traveling-wave-direction-and-sinusoidal-solutions"]
---

## ConceptNode: Intrinsic Impedance and Field Orientation

Planning node for [[intrinsic-impedance-and-field-orientation|1.218 Intrinsic Impedance and Field Orientation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 387, Page 388, Page 389

Maxwell's curl equation fixes both the magnitude ratio and orientation relationship between the electric and magnetic fields of a plane wave. Substituting the forward- and backward-wave electric-field solution into $\nabla\times\mathbf{E}_s=-j\omega\mu_0\mathbf{H}_s$ produces corresponding magnetic waves. For forward propagation, $E_{x0}=\eta_0H_{y0}$; for backward propagation, $E_{x0}'=-\eta_0H_{y0}'$. The intrinsic impedance is $\eta_0=\sqrt{\mu_0/\epsilon_0}=377\,\Omega$, analogous to the characteristic impedance of a transmission line because it is the ratio of electric to magnetic field amplitudes in a traveling wave. The backward-wave minus sign reverses the magnetic-field direction so that $\mathbf{E}\times\mathbf{H}$ points along the actual direction of propagation. For a forward $+z$ wave with positive $x$-directed electric field, the magnetic field is positive $y$ directed and the two fields are in phase. The ideal uniform plane wave has infinite transverse extent and therefore infinite total energy, but distant antenna fields can approximate it locally.

### Key planning details

- The forward-wave amplitude relation is $E_{x0}=\eta_0H_{y0}$.
- The backward-wave relation is $E_{x0}'=-\eta_0H_{y0}'$.
- The free-space intrinsic impedance is $\eta_0=\sqrt{\mu_0/\epsilon_0}=377\,\Omega\approx120\pi\,\Omega$.
- Intrinsic impedance has ohmic units because it is the ratio of V/m to A/m.
- The sign change for a backward wave reverses the magnetic-field direction.
- The Poynting direction is set by $\mathbf{S}=\mathbf{E}\times\mathbf{H}$.
- For a forward free-space wave, $E_x$ and $H_y$ are in phase.
- A physical far field approximates a plane wave only over a limited region.

### Source coverage

- Equation (32) gives $H_{ys}=E_{x0}\sqrt{\epsilon_0/\mu_0}e^{-jk_0z}-E_{x0}'\sqrt{\epsilon_0/\mu_0}e^{jk_0z}$.
- Equations (34a) and (34b) give the forward and backward electric-to-magnetic amplitude relations.
- Equation (35) defines $\eta_0=377\,\Omega\approx120\pi\,\Omega$.
- The source states that $\mathbf{S}=\mathbf{E}\times\mathbf{H}$ has units of watts per square meter and points in the propagation direction.
- Figure 11.1 should be retained as S1.P389.F1; it shows the spatially uniform transverse distributions and confirms that $E_x$ and $H_y$ are in phase.
- Diagnostic D11.1 uses $E=250$ V/m and gives magnetic-field amplitude $0.663$ A/m, consistent with division by $377\,\Omega$.
- Diagnostic D11.2 provides a vector magnetic-field phasor and asks for frequency and instantaneous field values.
