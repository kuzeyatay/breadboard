---
title: "Power Reflection and Load Absorption"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "power-reflection-and-load-absorption"
locations: ["Page 335", "Page 336"]
related: ["reflection-at-a-load-discontinuity", "average-power-in-a-lossy-transmission-line", "decibel-characterization-of-transmission-loss", "cascaded-line-and-junction-loss"]
---

## ConceptNode: Power Reflection and Load Absorption

Planning node for [[power-reflection-and-load-absorption|1.184 Power Reflection and Load Absorption]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 335, Page 336

The magnitude of the voltage reflection coefficient determines the reflected fraction of incident average power. Since reflected voltage amplitude is $\Gamma$ times incident voltage amplitude, the reflected power contains the product $\Gamma\Gamma^*=|\Gamma|^2$. Thus $$\frac{\langle\mathcal{P}_r\rangle}{\langle\mathcal{P}_i\rangle}=|\Gamma|^2,$$ and the fraction accepted or dissipated by the load is $1-|\Gamma|^2$. This accepted-power fraction is not $|\tau|^2$, because the voltage transmission coefficient alone does not account for the associated load current. For two joined semi-infinite lines, the second line acts as the load, giving $\Gamma=(Z_{02}-Z_{01})/(Z_{02}+Z_{01})$. Example 10.5 uses $Z_0=50\ \Omega$ and $Z_L=50-j75\ \Omega$ to find $|\Gamma|=0.60$, so a $100$ mW incident wave delivers $64$ mW to the load. This procedure separates voltage reflection from power delivery.

### Key planning details

- Reflected power fraction is $|\Gamma|^2$.
- Accepted load-power fraction is $1-|\Gamma|^2$.
- The transmitted power fraction is not generally $|\tau|^2$.
- A matched load accepts all incident power in the stated line model.
- For two lines, treat the second characteristic impedance as the terminating load.
- Power calculations use the magnitude of the complex reflection coefficient.

### Source coverage

- Equations (76a) and (76b) give incident and reflected average powers.
- Equation (77a) gives the reflected fraction $|\Gamma|^2$.
- Equation (77b) gives the accepted fraction $1-|\Gamma|^2$.
- Equation (78) gives the reflection coefficient between two semi-infinite lines.
- Example 10.5 obtains $\Gamma=0.36-j0.48=0.60e^{-j0.93}$ and $64$ mW delivered power.
