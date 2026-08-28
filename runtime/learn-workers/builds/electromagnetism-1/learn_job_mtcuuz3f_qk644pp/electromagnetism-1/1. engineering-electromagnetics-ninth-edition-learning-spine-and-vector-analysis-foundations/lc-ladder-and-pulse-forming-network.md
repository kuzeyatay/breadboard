---
title: "1.161 LC Ladder and Pulse-Forming Network"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 317", "Section 10.1: Physical Description of Transmission Line Propagation"]
related: ["physical-wavefront-propagation-on-a-transmission-line", "per-unit-length-transmission-line-model", "lossless-traveling-wave-solutions", "distributed-versus-lumped-circuit-models"]
---

# 1.161 LC Ladder and Pulse-Forming Network

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 317, Section 10.1: Physical Description of Transmission Line Propagation

A transmission line's distributed capacitance and inductance can be approximated by a ladder of lumped capacitors and inductors. After a source is connected, current first rises in the nearest inductor and charges the nearest capacitor. The process then advances to successive sections, producing a moving transition between highly charged and weakly charged capacitors. This transition is the network analogue of the transmission-line wavefront. Smaller inductance and capacitance values permit faster current buildup and capacitor charging, suggesting that speed varies inversely with a function of their product. For a lossless line, the exact result is $v=1/\sqrt{LC}$ when $L$ and $C$ are per-unit-length parameters. If the ladder or line is initially charged and then connected to a load, successive capacitor discharges produce an output pulse, which motivates the name pulse-forming network.

## Page-Grounded Details

#### Page 317

Figure 10.2 Lumped-element model of a transmission line. All inductance values are equal, as are all capacitance values.

to understanding and quantifying this is to note that the conducting transmission line will possess capacitance and inductance that are expressed on a per-unit-length basis. We have already derived expressions for these and evaluated them in Chapters 6 and 8 for certain transmission line geometries. Knowing these line characteristics, we can construct a model for the transmission line using lumped capacitors and inductors, as shown in Figure 10.2. The ladder network thus formed is referred to as a *pulse-forming network*, for reasons that will soon become clear.^1

Consider now what happens when connecting the same switched voltage source to the network. Referring to Figure 10.2, on closing the switch at the battery location, current begins to increase in $L_{1}$, allowing $C_{1}$ to charge. As $C_{1}$ approaches full charge, current in $L_{2}$ begins to increase, allowing $C_{2}$ to charge next. This progressive charging process continues down the network, until all three capacitors are fully charged. In the network, a "wavefront" location can be iden

[Truncated for analysis]

## Core Ideas

- Distributed line inductance and capacitance can be modeled as an LC ladder.
- Sequential inductor current buildup and capacitor charging create a moving wavefront.
- Lower $L$ and $C$ produce faster propagation.
- A lossless line has velocity $v=1/\sqrt{LC}$.
- Sequential discharge of an initially charged ladder forms a load-voltage pulse.

## Source Anchors

- Figure 10.2 on Page 317 shows equal inductors and equal capacitors in the lumped-element line model.
- Page 317 describes charging $C_1$, then $C_2$, and then subsequent capacitors through corresponding inductors.
- Page 317 identifies the location of greatest charge-level difference as the network wavefront.
- Page 317 explains the initially charged network's sequential discharge and pulse formation.

## Related Pages

- [[physical-wavefront-propagation-on-a-transmission-line|Physical Wavefront Propagation on a Transmission Line]]
- [[per-unit-length-transmission-line-model|Per-Unit-Length Transmission-Line Model]]
- [[lossless-traveling-wave-solutions|Lossless Traveling-Wave Solutions]]
- [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]

## Concept Dependencies

- example-of: [[physical-wavefront-propagation-on-a-transmission-line|Physical Wavefront Propagation on a Transmission Line]]
- applies-to: [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]
