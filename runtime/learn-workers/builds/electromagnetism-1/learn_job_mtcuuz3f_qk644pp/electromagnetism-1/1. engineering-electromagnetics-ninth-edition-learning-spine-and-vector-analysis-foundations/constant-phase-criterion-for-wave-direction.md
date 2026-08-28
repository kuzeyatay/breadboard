---
title: "1.169 Constant-Phase Criterion for Wave Direction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 325"]
related: ["complex-representation-of-sinusoidal-waves", "propagation-constant-and-traveling-wave-solutions", "attenuation-and-phase-in-a-lossy-line"]
---

# 1.169 Constant-Phase Criterion for Wave Direction

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 325

The direction and speed of a sinusoidal traveling wave can be determined by following a point of constant phase, such as a crest. For a wave whose argument is $\omega t-\beta z$, the $m$th crest satisfies $\omega t-\beta z=2m\pi$. Holding this phase fixed as time increases requires $z$ to increase, so the wave travels in the positive $z$ direction. Rewriting the argument as $\omega(t-z/v_p)$ identifies the phase velocity $v_p=\omega/\beta$. For an argument $\omega t+\beta z$, maintaining the same phase requires $z$ to decrease as time increases, so the wave travels in the negative $z$ direction. This constant-phase procedure is reusable for determining propagation direction from any sinusoidal phase expression. The same directional reasoning applies to current waves, although the relative phase between voltage and current can depend on the line and is handled more cleanly with complex analysis.

## Page-Grounded Details

#### Page 325

We next consider a point (such as a wave crest) on the cosine function of Eq. (27a), the occurrence of which requires the argument of the cosine to be an integer multiple of $2\pi$. Considering the $m$th crest of the wave, the condition at $t=0$ becomes
$$
\beta z=2m\pi
$$
To keep track of this point on the wave, we require that the entire cosine argument be the same multiple of $2\pi$ for all time. From (27a) the condition becomes
$$
\omega t-\beta z=\omega(t-z/v_{p})=2m\pi\quad{(31)}
$$
Again, with increasing time, the position $z$ must also increase in order to satisfy (31). Consequently the wave crest (and the entire wave) travels in the positive $z$ direction at velocity $v_{p}$. Eq. (27b), having cosine argument $(\omega t+\beta z)$, describes a wave that travels in the negative $z$ direction, since as time increases, $z$ must now decrease to keep the argument constant. Similar behavior is found for the wave current, but complications arise from line-dependent phase differences that occur between current and voltage. These issues are best addressed once we are familiar with complex analysis of sinusoidal signals.

#### 10.5 COMPLEX ANALYSIS OF SINUSOID

[Truncated for analysis]

## Core Ideas

- A crest occurs when the cosine argument is an integer multiple of $2\pi$.
- For $\omega t-\beta z=2m\pi$, increasing $t$ requires increasing $z$.
- The phase form $\omega(t-z/v_p)$ gives $v_p=\omega/\beta$.
- A phase argument $\omega t+\beta z$ represents propagation toward decreasing $z$.
- Wave direction is determined by holding phase constant, not by inspecting amplitude alone.

## Source Anchors

- At $t=0$, the $m$th crest satisfies $\beta z=2m\pi$.
- Equation (31) gives $\omega t-\beta z=\omega(t-z/v_p)=2m\pi$.
- The text identifies $\omega t-\beta z$ with positive-$z$ propagation and $\omega t+\beta z$ with negative-$z$ propagation.

## Related Pages

- [[complex-representation-of-sinusoidal-waves|Complex Representation of Sinusoidal Waves]]
- [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
- [[attenuation-and-phase-in-a-lossy-line|Attenuation and Phase in a Lossy Line]]

## Concept Dependencies

- enables: [[complex-representation-of-sinusoidal-waves|Complex Representation of Sinusoidal Waves]]
- part-of: [[propagation-constant-and-traveling-wave-solutions|Propagation Constant and Traveling-Wave Solutions]]
