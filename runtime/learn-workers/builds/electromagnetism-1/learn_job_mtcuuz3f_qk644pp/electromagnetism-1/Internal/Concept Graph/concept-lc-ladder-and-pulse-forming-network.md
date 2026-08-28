---
title: "LC Ladder and Pulse-Forming Network"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lc-ladder-and-pulse-forming-network"
locations: ["Page 317", "Section 10.1: Physical Description of Transmission Line Propagation"]
related: ["physical-wavefront-propagation-on-a-transmission-line", "per-unit-length-transmission-line-model", "lossless-traveling-wave-solutions", "distributed-versus-lumped-circuit-models"]
---

## ConceptNode: LC Ladder and Pulse-Forming Network

Planning node for [[lc-ladder-and-pulse-forming-network|1.161 LC Ladder and Pulse-Forming Network]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 317, Section 10.1: Physical Description of Transmission Line Propagation

A transmission line's distributed capacitance and inductance can be approximated by a ladder of lumped capacitors and inductors. After a source is connected, current first rises in the nearest inductor and charges the nearest capacitor. The process then advances to successive sections, producing a moving transition between highly charged and weakly charged capacitors. This transition is the network analogue of the transmission-line wavefront. Smaller inductance and capacitance values permit faster current buildup and capacitor charging, suggesting that speed varies inversely with a function of their product. For a lossless line, the exact result is $v=1/\sqrt{LC}$ when $L$ and $C$ are per-unit-length parameters. If the ladder or line is initially charged and then connected to a load, successive capacitor discharges produce an output pulse, which motivates the name pulse-forming network.

### Key planning details

- Distributed line inductance and capacitance can be modeled as an LC ladder.
- Sequential inductor current buildup and capacitor charging create a moving wavefront.
- Lower $L$ and $C$ produce faster propagation.
- A lossless line has velocity $v=1/\sqrt{LC}$.
- Sequential discharge of an initially charged ladder forms a load-voltage pulse.

### Source coverage

- Figure 10.2 on Page 317 shows equal inductors and equal capacitors in the lumped-element line model.
- Page 317 describes charging $C_1$, then $C_2$, and then subsequent capacitors through corresponding inductors.
- Page 317 identifies the location of greatest charge-level difference as the network wavefront.
- Page 317 explains the initially charged network's sequential discharge and pulse formation.
