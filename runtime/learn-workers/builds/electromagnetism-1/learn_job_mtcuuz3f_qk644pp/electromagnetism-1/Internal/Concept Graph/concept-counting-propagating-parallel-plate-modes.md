---
title: "Counting Propagating Parallel-Plate Modes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "counting-propagating-parallel-plate-modes"
locations: ["Page 487, Example 13.2"]
related: ["parallel-plate-mode-propagation-and-cutoff", "te-and-tm-polarization-in-parallel-plate-guides"]
---

## ConceptNode: Counting Propagating Parallel-Plate Modes

Planning node for [[counting-propagating-parallel-plate-modes|1.273 Counting Propagating Parallel-Plate Modes]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 487, Example 13.2

The cutoff-wavelength condition provides a direct procedure for counting the modes supported at a given operating wavelength. A mode of order $m$ propagates when $$\lambda<\lambda_{cm}=\frac{2nd}{m}.$$ Rearranging gives an upper bound on the integer mode number: $$m<\frac{2nd}{\lambda}.$$ Every positive integer satisfying this strict inequality identifies one permitted order. In the parallel-plate guide, each positive order has both a TE and a TM mode, so the number of non-TEM guided modes is twice the number of permitted positive orders. The TEM mode, which has no cutoff, is counted separately. Example 13.2 applies the method to the Teflon-filled guide with $n=\sqrt{2.1}$, $d=10\ \text{mm}$, and $\lambda=2\ \text{mm}$. The bound is $m<14.5$, so orders $m=1$ through $14$ propagate. This produces 28 above-cutoff TE and TM modes, excluding TEM.

### Key planning details

- Start from the condition $\lambda<2nd/m$.
- Rearrange to obtain $m<2nd/\lambda$.
- Retain only positive integer mode orders satisfying the strict inequality.
- Each positive order supplies one TE mode and one TM mode.
- The TEM mode is excluded from the TE and TM count.
- For the example, $m<14.5$ means the highest propagating order is $m=14$.
- The example therefore has 28 non-TEM propagating modes.

### Source coverage

- Example 13.2 uses the guide from Example 13.1 and an operating wavelength of $2\ \text{mm}$.
- The inequality becomes $2\ \text{mm}<2\sqrt{2.1}(10\ \text{mm})/m$.
- The resulting bound is $m<14.5$.
- The source concludes that modes through $m=14$ propagate.
- With TE and TM modes for each order, the source reports 28 guided modes excluding TEM.
