---
title: "1.159 Distributed Versus Lumped Circuit Models"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 315", "Page 316", "Section: Transmission Lines"]
related: ["physical-wavefront-propagation-on-a-transmission-line", "lc-ladder-and-pulse-forming-network", "per-unit-length-transmission-line-model", "retarded-scalar-and-vector-potentials"]
---

# 1.159 Distributed Versus Lumped Circuit Models

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 315, Page 316, Section: Transmission Lines

Ordinary circuit analysis treats connections and components as lumped elements when propagation time across them is negligible. This approximation permits voltages and currents at separated circuit points to be treated as if they share the same time and phase. A transmission line must instead be treated as a distributed element when its length is comparable to a wavelength or when propagation delay is comparable to the shortest time interval of interest. In sinusoidal operation, the practical symptom is a measurable phase difference between the ends of the device. Resistance, capacitance, and inductance must then be described per unit distance, so the interconnection becomes a circuit element with its own frequency-dependent input behavior. Examples include antenna feed lines, computer-network links, long-distance power connections, stereo cables, television service cables, and high-frequency circuit-board interconnects.

## Page-Grounded Details

#### Page 315

### Transmission Lines

Transmission lines are used to transmit electric energy and signals from one point to another, specifically from a source to a load. Examples include the connection between a transmitter and an antenna, connections between computers in a network, or connections between a hydroelectric generating plant and a substation several hundred miles away. Other familiar examples include the interconnects between components of a stereo system and the connection between a cable service provider and your television set. Examples that are less familiar include the connections between devices on a circuit board that are designed to operate at high frequencies.

What all of these examples have in common is that the devices to be connected are separated by distances on the order of a wavelength or much larger, whereas in basic circuit analysis methods, connections between elements are assumed to have negligible length. The latter condition enabled us, for example, to take for granted that the voltage across a resistor on one side of a circuit was exactly in phase with the voltage source on the other side, or, more generally, that the time measured at the source location is p

[Truncated for analysis]

#### Page 316

In this chapter, we investigate wave phenomena in transmission lines. Our objectives include:

(1) to understand how to treat transmission lines as circuit elements possessing complex impedances that are functions of line length and frequency,

(2) to understand wave propagation on lines, including cases in which losses may occur,

(3) to learn methods of combining different transmission lines to accomplish a desired objective, and

(4) to understand transient phenomena on lines.

#### 10.1 PHYSICAL DESCRIPTION OF TRANSMISSION LINE PROPAGATION

To obtain a feel for the manner in which waves propagate on transmission lines, the following demonstration may be helpful. Consider a $lossless$ line, as shown in Figure 10.1. By lossless, we mean that all power that is launched into the line at the input end eventually arrives at the output end. A battery having voltage $V_{0}$ is connected to the input by closing switch $S_{1}$ at time $t=0$. When the switch is closed, the effect is to launch voltage, $V^{+}=V_{0}$. This voltage does not instantaneously appear everywhere on the line, but rather begins to travel from the battery toward the load resistor, $R$, at a certain veloc

[Truncated for analysis]

## Core Ideas

- Lumped models require negligible traversal delay.
- Distributed models are required when spatial delay affects the signal.
- A line length on the order of a wavelength produces wave behavior.
- Distributed resistance, capacitance, and inductance are specified per unit length.
- A measurable end-to-end phase difference indicates that propagation cannot be ignored.

## Source Anchors

- Page 315 lists transmission-line applications from antenna connections to high-frequency circuit-board interconnects.
- Page 315 contrasts negligible-length circuit connections with distances on the order of a wavelength or larger.
- Page 315 defines lumped and distributed elements through propagation-delay significance.
- Page 316 lists objectives involving impedance, propagation, line combinations, and transients.

## Related Pages

- [[physical-wavefront-propagation-on-a-transmission-line|Physical Wavefront Propagation on a Transmission Line]]
- [[lc-ladder-and-pulse-forming-network|LC Ladder and Pulse-Forming Network]]
- [[per-unit-length-transmission-line-model|Per-Unit-Length Transmission-Line Model]]
- [[retarded-scalar-and-vector-potentials|Retarded Scalar and Vector Potentials]]

## Concept Dependencies

- related: [[retarded-scalar-and-vector-potentials|Retarded Scalar and Vector Potentials]]
