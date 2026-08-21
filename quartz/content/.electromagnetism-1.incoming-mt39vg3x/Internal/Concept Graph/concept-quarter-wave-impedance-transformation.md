---
title: "Quarter-Wave Impedance Transformation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "quarter-wave-impedance-transformation"
locations: ["Page 374", "Page 375"]
related: ["distributed-line-parameters-attenuation-and-power-budgets", "transmission-line-reflection-and-standing-wave-analysis", "single-stub-and-reactive-matching"]
---

## ConceptNode: Quarter-Wave Impedance Transformation

Planning node for [[quarter-wave-impedance-transformation|1.209 Quarter-Wave Impedance Transformation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 374, Page 375

A quarter-wave transmission-line section transforms its terminating impedance and can match two lines with different real characteristic impedances. The problem set develops this through lines joined by an intermediate section, loaded quarter-wave lines, and frequency changes that alter the section's electrical length. For two real line impedances $Z_{01}$ and $Z_{03}$, the matching section uses the geometric-mean characteristic impedance $Z_{02}=\sqrt{Z_{01}Z_{03}}$. Its physical length follows from the wavelength in that section, which can be inferred from its distributed capacitance and characteristic impedance for a lossless line. The match is frequency-specific: doubling frequency turns a section that was one quarter wavelength long into a half-wavelength section, changing the impedance seen at the junction and generally restoring mismatch. Related problems use the general lossless-line input-impedance transformation to calculate source loading, dissipated power, load voltage, standing-wave ratio, and reflected power. A separate maximum-power-transfer problem asks for the line length that transforms a complex load into the complex conjugate required by the source impedance.

### Key planning details

- A quarter-wave line transforms a load according to $Z_{\mathrm{in}}=Z_0^2/Z_L$.
- A real-to-real quarter-wave match uses $Z_{02}=\sqrt{Z_{01}Z_{03}}$.
- The shortest matching section has electrical length $\lambda/4$ at the design frequency.
- Changing frequency changes electrical length even when physical length is fixed.
- A half-wave section repeats its terminating impedance at the input.
- Mismatch after a frequency shift can be quantified by reflection coefficient, standing-wave ratio, and reflected-power fraction.
- A line can transform a displaced complex load to satisfy the source's conjugate-match condition.

### Source coverage

- Problem 10.10 joins $100\,\Omega$ and $25\,\Omega$ lines with a quarter-wave section at 1 GHz and then doubles the frequency to 2 GHz.
- Problem 10.10 gives the intermediate-line capacitance as 100 pF/m and asks for the shortest physical length.
- Problem 10.12 asks for an equation in line length $\ell$ that makes the transformed load the complex conjugate of $Z_g=R_g+jX_g$.
- Problem 10.14 uses a one-quarter-wavelength $50\,\Omega$ line terminated by $50-j50\,\Omega$.
- Problem 10.16 uses a $40\,\Omega$, $\lambda/4$ section terminated by $25\,\Omega$ and asks how its input impedance changes when frequency is halved.
- Figure 10.29, retained as S1.P375.F1, belongs to Problem 10.15 and should support a source-aware circuit interpretation before solution.
