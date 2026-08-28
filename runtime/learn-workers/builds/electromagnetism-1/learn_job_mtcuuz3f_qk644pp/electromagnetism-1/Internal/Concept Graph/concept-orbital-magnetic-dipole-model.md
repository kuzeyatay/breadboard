---
title: "Orbital Magnetic Dipole Model"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "orbital-magnetic-dipole-model"
locations: ["Page 286"]
related: ["magnetic-force-and-torque-on-charges-and-currents", "magnetization-magnetic-materials-and-bound-currents"]
---

## ConceptNode: Orbital Magnetic Dipole Model

Planning node for [[orbital-magnetic-dipole-model|1.134 Orbital Magnetic Dipole Model]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 286

Problems 8.16 and 8.17 model an orbiting electron as an equivalent current loop. If an electron of charge magnitude $e$ completes an orbit of radius $a$ with angular velocity $\omega$, its orbital period is $T=2\pi/\omega$ and the equivalent current magnitude is $I=e/T=e\omega/(2\pi)$. Multiplying this current by the loop area $\pi a^2$ gives the orbital magnetic dipole moment magnitude $$m=I\pi a^2=\frac{ea^2\omega}{2}.$$ A magnetic field parallel to the orbital plane is perpendicular to the dipole moment, so the torque magnitude becomes $$\tau=mB=\frac{ea^2\omega B}{2}.$$ The source then connects the orbital speed to electrostatic binding by equating Coulomb attraction with the centrifugal requirement. This yields $$\omega=\left(\frac{4\pi\epsilon_0m_ea^3}{e^2}\right)^{-1/2},$$ where $m_e$ is electron mass. Problem 8.17 considers a magnetic field aligned with the atom's magnetic moment and states that the field decreases angular velocity by $eB/(2m_e)$ and decreases orbital moment by $e^2a^2B/(4m_e)$. The model is applied numerically to hydrogen with $a\approx6\times10^{-11}\ \mathrm{m}$ and $B=0.5\ \mathrm{T}$.

### Key planning details

- An orbiting charge can be represented as a current loop.
- The equivalent orbital current is $I=e\omega/(2\pi)$.
- The loop area is $\pi a^2$.
- The orbital magnetic moment magnitude is $m=ea^2\omega/2$.
- For a field parallel to the orbital plane, the torque magnitude is $ea^2\omega B/2$.
- The angular velocity follows from balancing Coulomb and centrifugal forces.
- An aligned external magnetic field changes both angular velocity and orbital magnetic moment.

### Source coverage

- Problem 8.16(a) explicitly asks for the equivalent orbital dipole moment $ea^2\omega/2$.
- Problem 8.16(b) gives the magnetic torque target $ea^2\omega B/2$.
- Problem 8.16(c) gives $\omega=(4\pi\epsilon_0m_ea^3/e^2)^{-1/2}$.
- Problem 8.16(d) specifies a hydrogen orbital radius near $6\times10^{-11}\ \mathrm{m}$ and $B=0.5\ \mathrm{T}$.
- Problem 8.17 states decreases of $eB/(2m_e)$ in angular velocity and $e^2a^2B/(4m_e)$ in orbital moment.
