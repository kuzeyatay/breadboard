---
title: "Phasor-Domain Telegraphist Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "phasor-domain-telegraphist-equations"
locations: ["Page 327", "Page 328"]
related: ["complex-instantaneous-voltage-and-phasor-voltage", "propagation-constant-and-traveling-wave-solutions", "characteristic-impedance-of-a-transmission-line"]
---

## ConceptNode: Phasor-Domain Telegraphist Equations

Planning node for [[phasor-domain-telegraphist-equations|1.173 Phasor-Domain Telegraphist Equations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 327, Page 328

The time-domain transmission-line equations become ordinary differential equations in position under sinusoidal steady-state analysis. Substituting $\mathcal{V}(z,t)=\operatorname{Re}\{V_s(z)e^{j\omega t}\}$ converts each time derivative into multiplication by $j\omega$, and the common factor $e^{j\omega t}$ cancels. The voltage wave equation becomes $d^2V_s/dz^2=(R+j\omega L)(G+j\omega C)V_s$. The first-order telegraphist equations similarly become $dV_s/dz=-(R+j\omega L)I_s$ and $dI_s/dz=-(G+j\omega C)V_s$. The combinations $Z=R+j\omega L$ and $Y=G+j\omega C$ are the per-unit-length series impedance and shunt admittance. This transformation is central because it replaces explicit time differentiation with algebraic frequency factors while retaining the spatial evolution needed to analyze propagation, attenuation, characteristic impedance, reflections, and finite line behavior.

### Key planning details

- In phasor form, $\partial/\partial t$ becomes multiplication by $j\omega$.
- The common factor $e^{j\omega t}$ divides out after substitution.
- The voltage equation becomes $d^2V_s/dz^2=ZYV_s$.
- The first-order equations are $dV_s/dz=-ZI_s$ and $dI_s/dz=-YV_s$.
- $Z=R+j\omega L$ is series impedance per unit distance.
- $Y=G+j\omega C$ is shunt admittance per unit distance.

### Source coverage

- Equations (38) through (40) transform the real voltage wave equation into phasor form.
- Equation (40) identifies $Z=R+j\omega L$ and $Y=G+j\omega C$.
- Equations (44a) and (44b) are the phasor-domain telegraphist equations.
