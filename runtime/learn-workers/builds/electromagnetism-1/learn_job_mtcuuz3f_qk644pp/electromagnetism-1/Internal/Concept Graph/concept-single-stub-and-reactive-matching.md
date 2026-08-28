---
title: "Single-Stub and Reactive Matching"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "single-stub-and-reactive-matching"
locations: ["Page 378", "Page 379"]
related: ["smith-chart-impedance-and-admittance-procedures", "transmission-line-reflection-and-standing-wave-analysis", "quarter-wave-impedance-transformation"]
---

## ConceptNode: Single-Stub and Reactive Matching

Planning node for [[single-stub-and-reactive-matching|1.212 Single-Stub and Reactive Matching]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 378, Page 379

Single-stub matching removes the reactive part of a transformed load admittance at a selected point on a lossless line. The main-line distance is chosen so that the normalized conductance equals unity. A shunt stub then supplies an equal and opposite susceptance, leaving the input matched to $Z_0$ on the source side. The source problems treat both short-circuited and open-circuited stubs, ask for shortest attachment distances and stub lengths, and include inverse problems in which a known matched geometry must be used to recover the original load. A related task replaces the stub with a shunt capacitor after finding a point where the input admittance has real part $1/Z_0$ and negative imaginary part. The capacitor contributes positive susceptance at the operating frequency and restores unity standing-wave ratio. Because stub and line lengths are electrical lengths, the chosen solution depends on wavelength and may have multiple periodic equivalents. Figures 10.35 and 10.36 contain the line and stub geometries required for Problems 10.34 and 10.36 and must remain attached to this matching procedure.

### Key planning details

- Transform the load to a point where normalized conductance is unity.
- Cancel the remaining susceptance with a shunt stub or lumped reactance.
- Short- and open-circuited stubs realize different susceptance-length relations.
- The shortest solution is selected among periodic line-length alternatives.
- A matched line has unity standing-wave ratio to the source side of the matching element.
- A shunt capacitor supplies frequency-dependent positive susceptance.
- Inverse matching problems recover the load from known stub geometry and a matched-input condition.

### Source coverage

- Problem 10.32 asks for the shortest attachment distance and short-circuited stub length for $Z_L=250\,\Omega$ and $Z_0=50\,\Omega$.
- Problem 10.33 uses $Z_L=100+j150\,\Omega$ and $Z_0=100\,\Omega$ and requests both short- and open-circuited stub solutions.
- Problem 10.34 gives $\lambda=100$ cm, $d_1=10$ cm, and $d=25$ cm, with the line matched to the left of the stub, and asks for $Z_L$.
- Problem 10.35 uses $Z_L=25+j75\,\Omega$, $Z_0=50\,\Omega$, $v=c$, and $f=300$ MHz, then asks for a shunt capacitance that produces unity standing-wave ratio.
- Figures 10.35 and 10.36 should be retained as S1.P378.F2 and S1.P379.F1 and used to reconstruct the exact stub topologies.
