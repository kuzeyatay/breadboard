---
title: "Constant-Phase Criterion for Wave Direction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "constant-phase-criterion-for-wave-direction"
locations: ["Page 325"]
related: ["complex-representation-of-sinusoidal-waves", "propagation-constant-and-traveling-wave-solutions", "attenuation-and-phase-in-a-lossy-line"]
---

## ConceptNode: Constant-Phase Criterion for Wave Direction

Planning node for [[constant-phase-criterion-for-wave-direction|1.169 Constant-Phase Criterion for Wave Direction]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 325

The direction and speed of a sinusoidal traveling wave can be determined by following a point of constant phase, such as a crest. For a wave whose argument is $\omega t-\beta z$, the $m$th crest satisfies $\omega t-\beta z=2m\pi$. Holding this phase fixed as time increases requires $z$ to increase, so the wave travels in the positive $z$ direction. Rewriting the argument as $\omega(t-z/v_p)$ identifies the phase velocity $v_p=\omega/\beta$. For an argument $\omega t+\beta z$, maintaining the same phase requires $z$ to decrease as time increases, so the wave travels in the negative $z$ direction. This constant-phase procedure is reusable for determining propagation direction from any sinusoidal phase expression. The same directional reasoning applies to current waves, although the relative phase between voltage and current can depend on the line and is handled more cleanly with complex analysis.

### Key planning details

- A crest occurs when the cosine argument is an integer multiple of $2\pi$.
- For $\omega t-\beta z=2m\pi$, increasing $t$ requires increasing $z$.
- The phase form $\omega(t-z/v_p)$ gives $v_p=\omega/\beta$.
- A phase argument $\omega t+\beta z$ represents propagation toward decreasing $z$.
- Wave direction is determined by holding phase constant, not by inspecting amplitude alone.

### Source coverage

- At $t=0$, the $m$th crest satisfies $\beta z=2m\pi$.
- Equation (31) gives $\omega t-\beta z=\omega(t-z/v_p)=2m\pi$.
- The text identifies $\omega t-\beta z$ with positive-$z$ propagation and $\omega t+\beta z$ with negative-$z$ propagation.
