---
title: "Standing-Wave Current on a Finite Dipole"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "standing-wave-current-on-a-finite-dipole"
locations: ["Page 542", "Section 14.4.1 continuation"]
related: ["finite-dipole-as-a-superposition-of-hertzian-dipoles", "half-wave-dipole-pattern-and-performance", "radiation-intensity-directivity-and-radiation-resistance"]
---

## ConceptNode: Standing-Wave Current on a Finite Dipole

Planning node for [[standing-wave-current-on-a-finite-dipole|1.317 Standing-Wave Current on a Finite Dipole]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 542, Section 14.4.1 continuation

A finite center-fed wire antenna can be modeled by borrowing the standing-wave current distribution of an open-ended TEM transmission line. For a very short antenna, the source approximates the current as increasing linearly from zero at each open end to its maximum feed value $I_0$. This approximation is reasonable when the overall antenna length is less than about one-tenth of a wavelength. In the stricter short-antenna regime $\ell<\lambda/20$, retardation along the wire can be neglected, so radiation arriving from different wire positions is approximately in phase. The average current is then $I_0/2$, making the fields one-half of the corresponding uniform-current Hertzian-dipole fields and the radiated power and radiation resistance one-quarter as large. For longer antennas, retardation must be retained and the current is treated as sinusoidal. After unfolding the transmission-line model into a center-fed dipole extending from $-\ell$ to $+\ell$, the symmetric current becomes $I_s(z)=I_0\sin[k(\ell-|z|)]$. This distribution vanishes at both ends and varies according to the phase constant $k=\omega\sqrt{\mu\epsilon}$.

### Key planning details

- A short dipole has approximately triangular current variation, with zero current at its ends and maximum current $I_0$ at the feed.
- The linear-current approximation is reasonable for overall lengths below about $\lambda/10$.
- For $\ell<\lambda/20$, retardation effects along the antenna may be neglected.
- The average current of the triangular distribution is $I_0/2$.
- Halving the effective current halves the fields and reduces power and radiation resistance by a factor of four.
- The finite-dipole current is $I_s(z)=I_0\sin[k(\ell-|z|)]$ for $-\ell\le z\le\ell$.
- The phase constant is $k=\omega\sqrt{\mu\epsilon}$.

### Source coverage

- Page 542 states that current on a short antenna increases approximately linearly from zero at the ends to a maximum at the feed.
- Page 542 gives the short-antenna applicability limit as an overall length less than about one-tenth wavelength.
- Page 542 states that retardation may be neglected when $\ell<\lambda/20$.
- Equation (51), Page 542: $I_s(z)=I_0\sin(kz)$ for the open-ended transmission-line model.
- Equation (52), Page 542: $I_s(z)=I_0\sin[k(\ell-|z|)]$ after unfolding the line into a dipole.
- The source states that the short antenna has one-half the Hertzian-dipole field values and one-quarter the power and radiation resistance.
