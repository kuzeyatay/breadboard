---
title: "Wireless Propagation as Spherical Power Spreading"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 134", "Section: 11.4.1 RF propagation"]
related: ["free-space-wireless-propagation-and-friis-equation", "single-reflection-ground-model-and-the-1-over-d-4-rule", "knife-edge-diffraction-loss-calculation"]
tags: ["rf-propagation", "atmospheric-absorption", "frequency", "humidity", "antenna", "wireless-channel"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-134-2.png"]
---

## Wireless Propagation as Spherical Power Spreading

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 134, Section: 11.4.1 RF propagation

The wireless channel section begins with a geometric view of RF propagation: transmitted power spreads over concentric spheres centered at the transmitter. This model supports the idea that received power density falls with distance because the same total power is distributed over an area that grows as $4\pi d^2$. The text also warns that propagation loss is not the only effect in wireless channels. RF signals are subject to atmospheric absorption, and the amount of attenuation depends on both frequency and humidity. That dependence is important because it means some parts of the spectrum can suffer significantly greater loss in real environments than free-space formulas alone predict. This conceptual model lays the groundwork for Friis' free-space equation and for later deviations caused by reflections and diffraction. The chapter uses diagrams to help interpret propagation: one figure shows energy radiating in concentric spheres toward a user, and another shows radio-wave attenuation changing with frequency and humidity levels.

### Source snapshots

![Communications_1_CourseReader Page 134](/communication-1/assets/communications-1-coursereader-page-134-2.png)

### Page-grounded details

#### Page 134

11.4 Wireless channel
11.4.1 RF propagation
The basic rule for calculating the power distribution of a wireless transmission system
assumes power propagates in all directions equally on the surface of a sphere whose center
is at the transmitter site.
Figure 93: Energy is radiating in concentric spheres from the antenna to reach a user
In addition to the propagation losses, RF radiation is prone to atmospheric absorption. The
amount of absorption is a function of the frequency and the humidy as can be seen in Figure
94.
Figure 94: Attenuation of Radio waves as a function of frequency and humidity levels
11.4.2 Free space wireless propagation
The most simplified model for the energy to spread from the transmitter (in free space) is
to assume a point transmitter emitting equal power in all directions. At a distance d one
can imagine the power being equally distributed on the surface of a sphere with a surface
area equal to 4πd2. The amount of power captured by the receiver can be simply calculated
130

### Key points

- A basic RF propagation model assumes equal power radiation in all directions.
- Power spreads on the surface of a sphere centered at the transmitter.
- The sphere area grows as $4\pi d^2$, so power density decreases with distance.
- Atmospheric absorption adds to propagation losses.
- Absorption depends on frequency and humidity.
- The spherical-spreading model is the basis for later received-power equations.

### Related topics

- [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
- [[single-reflection-ground-model-and-the-1-over-d-4-rule|Single-Reflection Ground Model and the $1/d^4$ Rule]]
- [[knife-edge-diffraction-loss-calculation|Knife-Edge Diffraction Loss Calculation]]

### Relationships

- depends-on: [[free-space-wireless-propagation-and-friis-equation|Free-Space Wireless Propagation and Friis Equation]]
