---
title: "Mode Propagation Condition in Multi-Mode Fiber"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 141", "Page 142", "Section: 11.5.1 Introduction"]
related: ["optical-fiber-losses-and-the-motivation-for-fiber-channels", "multi-mode-and-single-mode-fiber-exploration-procedure", "physical-channel-learning-objectives"]
tags: ["multi-mode-fiber", "single-mode-fiber", "step-index", "graded-index", "refractive-index", "mode-propagation", "total-internal-reflection"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-141-2.png", "/communication-1/assets/communications-1-coursereader-page-142-2.png"]
---

## Mode Propagation Condition in Multi-Mode Fiber

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 141, Page 142, Section: 11.5.1 Introduction

The chapter introduces multimode optical fibers by describing a glass core with either step-index or graded-index refractive-profile design, surrounded by cladding of lower refractive index. Early optical systems operated at relatively low symbol rates, making large-core fibers with multiple supported propagation modes acceptable. To explain modal propagation, the text considers two rays traveling in a waveguide of thickness $d$ with refractive indices $n_1$ and $n_2$ for core and cladding. The key requirement is phase matching: the phase accumulated by one ray over one path must equal the phase accumulated by the other over a corresponding path. From this analysis, the text presents a transcendental mode condition involving wavelength, waveguide thickness, angle $\theta$, and mode index $m$. This equation cannot be solved analytically, so supported propagation angles are found numerically by comparing left- and right-hand sides. Those angles correspond to allowed modes. The point of the topic is that multimode propagation arises only for discrete angle conditions, and these modes later connect to different propagation times and dispersion.

### Source snapshots

![Communications_1_CourseReader Page 141](/communication-1/assets/communications-1-coursereader-page-141-2.png)

![Communications_1_CourseReader Page 142](/communication-1/assets/communications-1-coursereader-page-142-2.png)

### Page-grounded details

#### Page 141

(n=1)?
Optical fibers (the use of thin strands of glass as a means of transporting data) were first
proposed by Charles Kao in the 1960's and have been perfected to provide ultra-low loss in
the following years. First generation of optical fibers were based on a relatively thick glass
core, with either a step (abrupt) change in refractive index or a graded (gradual) change
in refractive index (see Figure 97). Early optical fiber systems, were running at relatively
low symbol rates. Hence, large core fibers, which supported multiple propagation modes
(illustrated by different angles in the fiber in Figure 97), were perfectly suitable.
Figure 97: Illustration of two rays propagating in a glass waveguide of thickness d and refractive
indices n1 and n2
We can better understand the concept of wave propagation in multi-mode fibers but solving
the problem of co-propagation of two rays in a waveguide of thickness d and refractive indices
n1 and n2 for the core and cladding respectively. In order for the wave, represented by the
two rays to continue to propagate, we require that the phase accumulated by ray 1 from
point A to point B is equal to the phase ray 2 accumulates when traversing th

[Truncated for analysis]

#### Page 142

Figure 98: Tracing two rays in a wave guide of thickness d to find the condition for mode propagation
138

### Key points

- Early optical fibers used relatively thick cores and could support multiple propagation modes.
- Two index profiles are mentioned: step-index and graded-index.
- The core and cladding have refractive indices $n_1$ and $n_2$ respectively.
- Mode propagation is derived by equating accumulated phase along two ray paths.
- Allowed propagation occurs only for discrete angles $\theta$ satisfying the mode equation.
- The resulting condition is transcendental and must be solved numerically.
- Supported angles correspond to propagation modes in the waveguide.

### Related topics

- [[optical-fiber-losses-and-the-motivation-for-fiber-channels|Optical Fiber Losses and the Motivation for Fiber Channels]]
- [[multi-mode-and-single-mode-fiber-exploration-procedure|Multi-Mode and Single-Mode Fiber Exploration Procedure]]
- [[physical-channel-learning-objectives|Physical Channel Learning Objectives]]

### Relationships

- applies-to: [[multi-mode-and-single-mode-fiber-exploration-procedure|Multi-Mode and Single-Mode Fiber Exploration Procedure]]
