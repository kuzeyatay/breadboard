---
title: "Antenna Reciprocity and Link Reversal"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "antenna-reciprocity-and-link-reversal"
locations: ["Page 563", "Page 567, Problem 14.28"]
related: ["friis-free-space-transmission-formula", "antenna-effective-area-and-directivity"]
---

## ConceptNode: Antenna Reciprocity and Link Reversal

Planning node for [[antenna-reciprocity-and-link-reversal|1.342 Antenna Reciprocity and Link Reversal]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 563, Page 567, Problem 14.28

The link-reversal problem demonstrates a practical consequence of reciprocal propagation and reciprocal antenna behavior. A ground transmitter radiates 10 kW while a mobile receiving station dissipates 1 mW in its matched load. Without moving the receiver, the roles are reversed and the mobile station radiates 100 W. Because the same path and antenna orientations are retained, the fractional transmission factor between radiated power at one terminal and matched-load power at the other is the same in either direction. The original link therefore establishes a transfer ratio that can be applied directly to the reversed link. This reasoning is also consistent with the symmetric product in the Friis formula, where the two antennas enter through $A_{e1}A_{e2}$ or $D_1D_2$. The method is reusable when neither range nor individual antenna properties need to be recomputed: infer the path gain from one direction, then multiply it by the radiated power in the reverse direction. The assumptions remain those of the underlying link relation, including unchanged geometry, orientation, frequency, propagation environment, and matched receiving loads.

### Key planning details

- The same stationary link is used in both transmission directions.
- The forward link determines the end-to-end power-transfer ratio.
- The reciprocal link uses the same transfer ratio when geometry and frequency are unchanged.
- The Friis antenna product is symmetric under interchange of transmitter and receiver.
- Matched-load received power is distinguished from total intercepted or available power.
- No separate recomputation of distance or antenna factors is needed when the link is unchanged.

### Source coverage

- Problem 14.28 gives 10 kW radiated by the ground station and 1 mW dissipated at the mobile matched load.
- The mobile receiver is explicitly stated not to have moved before transmitting back.
- The mobile station radiates 100 W in the reverse direction.
- Equation (105) contains the symmetric product $A_{e1}A_{e2}$.
- Equation (106) contains the symmetric product $D_1D_2$.
