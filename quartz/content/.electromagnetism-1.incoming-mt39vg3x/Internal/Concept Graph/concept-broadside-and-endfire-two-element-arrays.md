---
title: "Broadside and Endfire Two-Element Arrays"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "broadside-and-endfire-two-element-arrays"
locations: ["Page 552", "Page 553", "Section 14.5.2", "Example 14.3", "Example 14.4", "Problem D14.6", "Problem D14.7"]
related: ["two-element-array-far-zone-phase-geometry", "pattern-multiplication-for-antenna-arrays", "uniform-linear-array-beam-conditions"]
---

## ConceptNode: Broadside and Endfire Two-Element Arrays

Planning node for [[broadside-and-endfire-two-element-arrays|1.327 Broadside and Endfire Two-Element Arrays]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 552, Page 553, Section 14.5.2, Example 14.3, Example 14.4, Problem D14.6, Problem D14.7

The H-plane beam direction of a two-element array is controlled through spacing $d$ and relative current phase $\xi$. With in-phase currents, $\xi=0$, the array factor is $A=\cos[(\pi d/\lambda)\cos\phi]$. It always reaches a maximum at $\phi=90^\circ$ and $270^\circ$, normal to the plane containing the antennas, which defines broadside operation. Choosing $d=\lambda/2$ additionally creates zeros along the array axis at $\phi=0$ and $180^\circ$. Larger spacing can introduce sidelobes. Endfire operation instead places a maximum along the array axis. The condition is $\xi/2\pm\pi d/\lambda=m\pi$, where the sign selects the positive or negative $x$ direction. A practical unidirectional case uses $d=\lambda/4$ and $\xi=-\pi/2$. Its factor $A=\cos[(\pi/4)(\cos\phi-1)]$ is maximum at $\phi=0$ and zero at $\phi=\pi$. The imposed current lag compensates propagation delay in the forward direction and reinforces it in the reverse direction, producing constructive interference forward and destructive interference backward.

### Key planning details

- In-phase excitation, $\xi=0$, produces a broadside array.
- Broadside maxima occur at $\phi=90^\circ$ and $270^\circ$ for any spacing.
- With $d=\lambda/2$, broadside-array zeros occur at $\phi=0$ and $180^\circ$.
- Increasing spacing beyond $\lambda/2$ introduces additional maxima.
- Endfire operation requires an array-factor maximum along the $x$ axis.
- The endfire condition is $\xi/2\pm\pi d/\lambda=m\pi$.
- The choice $d=\lambda/4$ and $\xi=-\pi/2$ gives a single beam toward positive $x$.
- Forward phase compensation and reverse phase opposition explain unidirectional endfire behavior.

### Source coverage

- Example 14.3, Page 552 derives the broadside factor for $\xi=0$.
- For $d=\lambda/2$, Example 14.3 reports zeros at $\phi=0$ and $\pi$ and maxima along positive and negative $y$.
- Example 14.4 derives the endfire condition $\xi/2\pm\pi d/\lambda=m\pi$.
- The practical endfire choice is $m=0$, $d=\lambda/4$, and $\xi=-\pi/2$.
- The resulting factor is $A=\cos[(\pi/4)(\cos\phi-1)]$.
- Page 553 explains constructive interference in positive $x$ and destructive interference in negative $x$.
- Problems D14.6 and D14.7 test how spacing and wavelength changes alter beam and null directions.
