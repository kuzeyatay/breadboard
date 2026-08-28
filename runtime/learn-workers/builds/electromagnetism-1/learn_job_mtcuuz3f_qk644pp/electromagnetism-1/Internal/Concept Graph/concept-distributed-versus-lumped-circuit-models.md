---
title: "Distributed Versus Lumped Circuit Models"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "distributed-versus-lumped-circuit-models"
locations: ["Page 315", "Page 316", "Section: Transmission Lines"]
related: ["physical-wavefront-propagation-on-a-transmission-line", "lc-ladder-and-pulse-forming-network", "per-unit-length-transmission-line-model", "retarded-scalar-and-vector-potentials"]
---

## ConceptNode: Distributed Versus Lumped Circuit Models

Planning node for [[distributed-versus-lumped-circuit-models|1.159 Distributed Versus Lumped Circuit Models]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 315, Page 316, Section: Transmission Lines

Ordinary circuit analysis treats connections and components as lumped elements when propagation time across them is negligible. This approximation permits voltages and currents at separated circuit points to be treated as if they share the same time and phase. A transmission line must instead be treated as a distributed element when its length is comparable to a wavelength or when propagation delay is comparable to the shortest time interval of interest. In sinusoidal operation, the practical symptom is a measurable phase difference between the ends of the device. Resistance, capacitance, and inductance must then be described per unit distance, so the interconnection becomes a circuit element with its own frequency-dependent input behavior. Examples include antenna feed lines, computer-network links, long-distance power connections, stereo cables, television service cables, and high-frequency circuit-board interconnects.

### Key planning details

- Lumped models require negligible traversal delay.
- Distributed models are required when spatial delay affects the signal.
- A line length on the order of a wavelength produces wave behavior.
- Distributed resistance, capacitance, and inductance are specified per unit length.
- A measurable end-to-end phase difference indicates that propagation cannot be ignored.

### Source coverage

- Page 315 lists transmission-line applications from antenna connections to high-frequency circuit-board interconnects.
- Page 315 contrasts negligible-length circuit connections with distances on the order of a wavelength or larger.
- Page 315 defines lumped and distributed elements through propagation-delay significance.
- Page 316 lists objectives involving impedance, propagation, line combinations, and transients.
