---
title: "Matched and Mismatched Receiver-Line Example"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "matched-and-mismatched-receiver-line-example"
locations: ["Page 344", "Page 345"]
related: ["finite-lossless-line-input-impedance", "voltage-standing-wave-ratio-and-load-recovery", "reflection-at-a-load-discontinuity", "half-wave-and-quarter-wave-impedance-transformation", "average-power-in-a-lossy-transmission-line"]
---

## ConceptNode: Matched and Mismatched Receiver-Line Example

Planning node for [[matched-and-mismatched-receiver-line-example|1.190 Matched and Mismatched Receiver-Line Example]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 344, Page 345

The receiver-line example integrates matching, phase delay, input impedance, VSWR, and delivered power. Figure 10.8 uses a $2$ m, $300\ \Omega$ lossless line with phase velocity $2.5\times10^8$ m/s at $100$ MHz. With a $300\ \Omega$ load and a source having $300\ \Omega$ internal impedance, both ends are matched. The wavelength is $2.5$ m, $\beta=0.8\pi$ rad/m, and the electrical length is $1.6\pi$ rad. The line input and load voltages both have $30$ V amplitude, but the load voltage is delayed by $1.6\pi$. The delivered power is $1.5$ W. Adding a second $300\ \Omega$ receiver in parallel makes $Z_L=150\ \Omega$, giving $\Gamma=-1/3$, VSWR $2$, and $Z_{\mathrm{in}}=466-j206\ \Omega$. The source then supplies $1.333$ W, less than the matched-load power, and the lossless line delivers that total to the parallel receivers.

### Key planning details

- A $300\ \Omega$ load matches the $300\ \Omega$ line.
- The matched line has $\Gamma=0$ and VSWR $1$.
- At $100$ MHz, the wavelength is $2.5$ m and the electrical length is $1.6\pi$ rad.
- The matched load receives $1.5$ W.
- Two $300\ \Omega$ receivers in parallel produce a $150\ \Omega$ load.
- The mismatched case has $\Gamma=-1/3$ and VSWR $2$.
- The transformed input impedance is $466-j206\ \Omega$.
- The mismatched source-line system delivers $1.333$ W.

### Source coverage

- Figure 10.8 depicts a line matched at both ends and states that this produces no reflections and maximum load power.
- Pages 344 and 345 specify $Z_0=300\ \Omega$, $l=2$ m, $v_p=2.5\times10^8$ m/s, and $f=100$ MHz.
- The matched case gives $V_{\mathrm{in}}=30\cos(2\pi10^8t)$ V and $V_L=30\cos(2\pi10^8t-1.6\pi)$ V.
- The matched input and load powers are both $1.5$ W.
- The parallel-receiver case gives $\Gamma=-1/3$, $s=2$, and $Z_{\mathrm{in}}=510\angle-23.8^\circ=466-j206\ \Omega$.
- The mismatched case supplies $1.333$ W to the lossless line and load combination.
