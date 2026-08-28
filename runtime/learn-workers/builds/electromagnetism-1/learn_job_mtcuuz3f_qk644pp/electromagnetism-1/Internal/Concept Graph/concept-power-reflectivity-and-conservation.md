---
title: "Power Reflectivity and Conservation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "power-reflectivity-and-conservation"
locations: ["Page 426, Example 12.1 setup", "Page 427, Example 12.1 power calculation and Equation (15)", "Page 428, transmitted-power relations, Equation (17), and D12.1"]
related: ["reflection-and-transmission-coefficients", "incident-reflected-and-transmitted-plane-waves", "standing-wave-ratio-and-extremum-locations", "plane-wave-field-and-power-analysis-procedures", "multiple-interface-reflection"]
---

## ConceptNode: Power Reflectivity and Conservation

Planning node for [[power-reflectivity-and-conservation|1.248 Power Reflectivity and Conservation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 426, Example 12.1 setup, Page 427, Example 12.1 power calculation and Equation (15), Page 428, transmitted-power relations, Equation (17), and D12.1

Field-amplitude coefficients do not directly equal power fractions because average power depends on both electric and magnetic fields and therefore on intrinsic impedance. For the reflected wave in region 1, the source derives the general result $$\langle S_{1r}\rangle=|\Gamma|^2\langle S_{1i}\rangle.$$ Thus $|\Gamma|^2$ is the reflected fraction of incident power. A direct transmitted-power expression contains the real parts of reciprocal complex impedances and $|\tau|^2$, so energy conservation often gives the simpler relation $$\langle S_2\rangle=(1-|\Gamma|^2)\langle S_{1i}\rangle.$$ Example 12.1 uses $\eta_1=100\ \Omega$, $\eta_2=300\ \Omega$, and incident electric amplitude $100\ \mathrm{V/m}$. It obtains $\Gamma=0.5$, reflected amplitude $50\ \mathrm{V/m}$, and transmitted amplitude $150\ \mathrm{V/m}$. The incident, reflected, and transmitted average power densities are respectively $50$, $12.5$, and $37.5\ \mathrm{W/m^2}$, confirming power conservation.

### Key planning details

- Average power density is calculated from $(1/2)\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$.
- The reflected power fraction is $|\Gamma|^2$.
- The transmitted power fraction is $1-|\Gamma|^2$ when conservation applies to the interface balance.
- The transmitted electric-field amplitude can exceed the incident amplitude when the second impedance is larger.
- A larger transmitted electric amplitude does not imply creation of power because the associated magnetic field changes with impedance.
- Incident power equals reflected plus transmitted power in Example 12.1.

### Source coverage

- Example 12.1 calculates $\Gamma=0.5$ from $\eta_1=100\ \Omega$ and $\eta_2=300\ \Omega$.
- The example gives $E_{x10}^{-}=50\ \mathrm{V/m}$ and $E_{x20}^{+}=150\ \mathrm{V/m}$.
- The calculated powers are $50$, $12.5$, and $37.5\ \mathrm{W/m^2}$.
- Equation (15) gives $\langle S_{1r}\rangle=|\Gamma|^2\langle S_{1i}\rangle$.
- Equation (17) gives $\langle S_2\rangle=(1-|\Gamma|^2)\langle S_{1i}\rangle$.
- Drill D12.1 applies the power fractions to a 1 MHz wave incident on fresh water.
