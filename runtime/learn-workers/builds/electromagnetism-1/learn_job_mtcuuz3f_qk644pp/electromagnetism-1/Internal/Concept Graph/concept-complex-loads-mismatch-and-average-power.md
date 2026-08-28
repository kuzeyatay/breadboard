---
title: "Complex Loads, Mismatch, and Average Power"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "complex-loads-mismatch-and-average-power"
locations: ["Page 347", "Page 348"]
related: ["forward-and-reflected-voltage-reconstruction", "smith-chart-impedance-and-reflection-coefficient-mapping", "constant-resistance-and-constant-reactance-circles", "standing-wave-voltage-extrema-on-a-lossless-line"]
---

## ConceptNode: Complex Loads, Mismatch, and Average Power

Planning node for [[complex-loads-mismatch-and-average-power|1.193 Complex Loads, Mismatch, and Average Power]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 347, Page 348

Examples 10.8 and 10.9 contrast a partially dissipative complex load with a purely reactive load. Two 300 $\Omega$ receivers in parallel produce 150 $\Omega$; placing $-j300\ \Omega$ in parallel with them gives $Z_L=120-j60\ \Omega$. Relative to a 300 $\Omega$ line, this load has $\Gamma=0.447\angle-153.4^\circ$ and $s=2.62$, indicating a worse mismatch than the preceding resistive case. Transforming through the same $288^\circ$ electrical length gives $Z_{\mathrm{in}}=755-j138.5\ \Omega$. A 60 V Thevenin source with 300 $\Omega$ source resistance then supplies $I_{s,\mathrm{in}}=0.0564\angle7.47^\circ$ A. The real part of the input impedance absorbs 1.200 W, which reaches the lossless-line load, so each receiver receives 0.6 W. By contrast, a purely capacitive $-j300\ \Omega$ load has $|\Gamma|=1$, infinite VSWR, purely reactive input impedance, and zero average delivered power.

### Key planning details

- Parallel impedances must be combined before calculating the load reflection coefficient.
- For Example 10.8, $Z_L=150\parallel(-j300)=120-j60\ \Omega$.
- The mismatch measures are $\Gamma=0.447\angle-153.4^\circ$ and $s=2.62$.
- For a lossless line, average input power equals average load power.
- A pure reactance has $|\Gamma|=1$ and reflects all incident average power.
- When $|\Gamma|=1$, the VSWR is infinite.
- A lossless line terminated in a pure reactance presents a pure reactance at its input.

### Source coverage

- Page 347 calculates $Z_L=120-j60\ \Omega$ for the receiver and capacitor combination.
- Page 347 calculates $\Gamma=0.447\angle-153.4^\circ$ and $s=2.62$.
- Page 347 obtains $Z_{\mathrm{in}}=755-j138.5\ \Omega$ and $I_{s,\mathrm{in}}=0.0564\angle7.47^\circ$ A.
- Page 347 finds $P_{\mathrm{in}}=P_L=1.200$ W, giving 0.6 W to each receiver.
- Pages 347 and 348 calculate $\Gamma=-j=1\angle-90^\circ$, $s=\infty$, and $Z_{\mathrm{in}}=j589\ \Omega$ for the purely capacitive load.
- Page 348 includes Problems D10.4 and D10.5 as a reusable procedure for finding $\Gamma$, $s$, $Z_{\mathrm{in}}$, endpoint voltages, and delivered power.
