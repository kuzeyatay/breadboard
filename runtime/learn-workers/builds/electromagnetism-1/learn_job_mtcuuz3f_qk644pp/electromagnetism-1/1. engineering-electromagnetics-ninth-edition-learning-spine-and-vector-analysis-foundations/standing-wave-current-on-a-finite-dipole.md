---
title: "1.317 Standing-Wave Current on a Finite Dipole"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 542", "Section 14.4.1 continuation"]
related: ["finite-dipole-as-a-superposition-of-hertzian-dipoles", "half-wave-dipole-pattern-and-performance", "radiation-intensity-directivity-and-radiation-resistance"]
---

# 1.317 Standing-Wave Current on a Finite Dipole

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 542, Section 14.4.1 continuation

A finite center-fed wire antenna can be modeled by borrowing the standing-wave current distribution of an open-ended TEM transmission line. For a very short antenna, the source approximates the current as increasing linearly from zero at each open end to its maximum feed value $I_0$. This approximation is reasonable when the overall antenna length is less than about one-tenth of a wavelength. In the stricter short-antenna regime $\ell<\lambda/20$, retardation along the wire can be neglected, so radiation arriving from different wire positions is approximately in phase. The average current is then $I_0/2$, making the fields one-half of the corresponding uniform-current Hertzian-dipole fields and the radiated power and radiation resistance one-quarter as large. For longer antennas, retardation must be retained and the current is treated as sinusoidal. After unfolding the transmission-line model into a center-fed dipole extending from $-\ell$ to $+\ell$, the symmetric current becomes $I_s(z)=I_0\sin[k(\ell-|z|)]$. This distribution vanishes at both ends and varies according to the phase constant $k=\omega\sqrt{\mu\epsilon}$.

## Page-Grounded Details

#### Page 542

On a short antenna, where $2\mathscr{C}$ is significantly less than a half-wavelength, we see only the first portion of the sine wave; the amplitude of the current increases in an approximately linear manner, from zero at the ends to a maximum value at the feed, as indicated in Figure 14.6. The gap at the feed point is small and has negligible effects. The short antenna approximation (in which a linear current variation along the length can be assumed) is reasonable for antennas having an overall length that is less than about one-tenth of a wavelength.

A simple extension of the Hertzian dipole results can be performed in the short antenna regime ($\mathscr{C}<\lambda/20$). If this is the case, then retardation effects may be neglected. That is, signals arriving at any field point $P$ from the two ends of the antenna are approximately in phase. The average current along the antenna is $I_{0}/2$, where $I_{0}$ is the input current at the feed. The electric and magnetic field intensities will thus be one-half the values given in (22) and (23), and there are no changes in the vertical and horizontal patterns. The power will be one-quarter of its previous value, and thus the

[Truncated for analysis]

## Core Ideas

- A short dipole has approximately triangular current variation, with zero current at its ends and maximum current $I_0$ at the feed.
- The linear-current approximation is reasonable for overall lengths below about $\lambda/10$.
- For $\ell<\lambda/20$, retardation effects along the antenna may be neglected.
- The average current of the triangular distribution is $I_0/2$.
- Halving the effective current halves the fields and reduces power and radiation resistance by a factor of four.
- The finite-dipole current is $I_s(z)=I_0\sin[k(\ell-|z|)]$ for $-\ell\le z\le\ell$.
- The phase constant is $k=\omega\sqrt{\mu\epsilon}$.

## Source Anchors

- Page 542 states that current on a short antenna increases approximately linearly from zero at the ends to a maximum at the feed.
- Page 542 gives the short-antenna applicability limit as an overall length less than about one-tenth wavelength.
- Page 542 states that retardation may be neglected when $\ell<\lambda/20$.
- Equation (51), Page 542: $I_s(z)=I_0\sin(kz)$ for the open-ended transmission-line model.
- Equation (52), Page 542: $I_s(z)=I_0\sin[k(\ell-|z|)]$ after unfolding the line into a dipole.
- The source states that the short antenna has one-half the Hertzian-dipole field values and one-quarter the power and radiation resistance.

## Related Pages

- [[finite-dipole-as-a-superposition-of-hertzian-dipoles|Finite Dipole as a Superposition of Hertzian Dipoles]]
- [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
- [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]

## Concept Dependencies

- enables: [[finite-dipole-as-a-superposition-of-hertzian-dipoles|Finite Dipole as a Superposition of Hertzian Dipoles]]
- applies-to: [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
