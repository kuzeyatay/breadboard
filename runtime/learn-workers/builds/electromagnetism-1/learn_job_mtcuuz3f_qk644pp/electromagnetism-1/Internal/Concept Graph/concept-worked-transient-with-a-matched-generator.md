---
title: "Worked Transient with a Matched Generator"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "worked-transient-with-a-matched-generator"
locations: ["Page 365", "Page 366", "Page 367", "Page 368"]
related: ["multiple-reflections-and-transient-steady-state", "voltage-and-current-reflection-diagrams", "matched-line-step-propagation-and-transit-delay"]
---

## ConceptNode: Worked Transient with a Matched Generator

Planning node for [[worked-transient-with-a-matched-generator|1.204 Worked Transient with a Matched Generator]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 365, Page 366, Page 367, Page 368

Example 10.11 applies reflection diagrams to a 50 $\Omega$ line driven by a 10 V battery through $R_g=50\ \Omega$ and terminated by $R_L=25\ \Omega$. Initial voltage division between $R_g$ and $Z_0$ launches $V_1^+=5$ V. The load reflection coefficient is $\Gamma_L=(25-50)/(25+50)=-1/3$, so the reflected wave is $V_1^-=-5/3$ V. Because $R_g=Z_0$, the generator is matched and has $\Gamma_g=0$, so the returning wave is absorbed and no further waves appear. The current waves are found independently from their voltage waves: $I_1^+=5/50=0.1$ A and $I_1^-=-(-5/3)/50=1/30$ A. The load reaches $5-5/3=10/3$ V when the first wave and its load reflection arrive. The battery current reaches $0.1+1/30=2/15$ A after the reflected wave returns. These values agree with the final lumped circuit consisting of 50 $\Omega$ and 25 $\Omega$ in series.

### Key planning details

- Matching the generator resistance to $Z_0$ makes $\Gamma_g=0$.
- The initial wave is $V_1^+=V_0Z_0/(R_g+Z_0)=5$ V.
- The 25 $\Omega$ load produces $\Gamma_L=-1/3$.
- The first reflected voltage is $V_1^-=-5/3$ V.
- No waves remain after the first backward wave is absorbed at the generator.
- The steady battery current is $10/(50+25)=2/15$ A.
- The steady load voltage is $10(25)/(50+25)=10/3$ V.
- The reflection diagrams reproduce the ordinary lumped-circuit limit.

### Source coverage

- Page 365 specifies $R_g=Z_0=50\ \Omega$, $R_L=25\ \Omega$, and $V_0=10$ V.
- Source figure S1.P366.F1, Figure 10.23, shows the example's voltage and current reflection diagrams.
- Page 366 calculates $V_1^+=5$ V, $\Gamma_L=-1/3$, and $V_1^-=-5/3$ V.
- Pages 366 and 367 calculate $I_1^+=1/10$ A and $I_1^-=1/30$ A.
- Source figure S1.P367.F1, Figure 10.24, shows load voltage and battery current versus time.
- Pages 367 and 368 verify the steady-state current $2/15$ A and load voltage $10/3$ V.
