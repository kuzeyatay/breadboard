---
title: "Half-Wave and Quarter-Wave Impedance Transformation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "half-wave-and-quarter-wave-impedance-transformation"
locations: ["Page 343", "Page 344"]
related: ["finite-lossless-line-input-impedance", "reflection-at-a-load-discontinuity", "characteristic-impedance-of-a-transmission-line", "matched-and-mismatched-receiver-line-example"]
---

## ConceptNode: Half-Wave and Quarter-Wave Impedance Transformation

Planning node for [[half-wave-and-quarter-wave-impedance-transformation|1.189 Half-Wave and Quarter-Wave Impedance Transformation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 343, Page 344

Special electrical lengths simplify the general finite-line input-impedance formula. If $l=m\lambda/2$, then $\beta l=m\pi$, the sine terms vanish, and the input impedance exactly repeats the load: $Z_{\mathrm{in}}=Z_L$. If the line has an odd quarter-wave length, then $\beta l=(2m+1)\pi/2$, the cosine terms vanish, and $$Z_{\mathrm{in}}=\frac{Z_0^2}{Z_L}.$$ This impedance-inversion property enables a quarter-wave transformer between two real line impedances $Z_{01}$ and $Z_{03}$. Inserting a quarter-wave section with characteristic impedance $Z_{02}$ produces an input impedance $Z_{02}^2/Z_{03}$. Requiring this to equal $Z_{01}$ gives $$Z_{02}=\sqrt{Z_{01}Z_{03}}.$$ The technique eliminates reflection at the design frequency, but it is inherently narrowband because the required electrical length changes when frequency changes.

### Key planning details

- A half-wave line repeats its terminating impedance at the input.
- $Z_{\mathrm{in}}=Z_L$ when $l=m\lambda/2$.
- A quarter-wave line inverts impedance as $Z_{\mathrm{in}}=Z_0^2/Z_L$.
- A matching section requires $Z_{02}=\sqrt{Z_{01}Z_{03}}$.
- Quarter-wave matching removes the junction reflection at the design frequency.
- The method is limited to a frequency or narrow band satisfying the quarter-wave condition.

### Source coverage

- Equation (99) gives the half-wave impedance repetition.
- Equation (100) gives the quarter-wave impedance inversion.
- Equations (101) and (102) apply the finite-line formula to an inserted matching section.
- Equation (103) gives $Z_{02}=\sqrt{Z_{01}Z_{03}}$.
- The source explicitly identifies the method as quarter-wave matching and notes its frequency limitation.
