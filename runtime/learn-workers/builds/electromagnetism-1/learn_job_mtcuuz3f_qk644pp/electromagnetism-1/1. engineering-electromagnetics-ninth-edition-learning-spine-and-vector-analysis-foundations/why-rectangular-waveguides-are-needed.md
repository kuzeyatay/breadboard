---
title: "1.288 Why Rectangular Waveguides Are Needed"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 504, Section 13.5.6", "Page 505, Section 13.5.6"]
related: ["te-0p-modes-and-rectangular-guide-single-mode-design", "symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "rectangular-waveguide-cutoff-and-propagation"]
---

# 1.288 Why Rectangular Waveguides Are Needed

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 504, Section 13.5.6, Page 505, Section 13.5.6

Ordinary transmission lines become problematic at sufficiently high frequencies because both conductor loss and unwanted waveguide modes increase in importance. If multiple modes propagate, the input signal power divides among them. Since each mode has its own group velocity and group delay, the separated signal components lose synchronization over distance and produce modal dispersion. A transmission line avoids this by supporting only its TEM mode and keeping all waveguide modes below cutoff, but the required small dimensions worsen power handling and limit attempts to reduce conductor loss. Skin effect increases series resistance per unit length as frequency rises, while reduced conductor spacing lowers the voltage at which dielectric breakdown occurs. A rectangular waveguide trades the zero-cutoff TEM mode for a larger hollow cross section that operates only above its dominant-mode cutoff. Its larger conductor area reduces loss, and its larger cross-sectional area supports more power at a given electric-field strength. It must still remain below the next mode's cutoff, and at still higher frequencies shrinking dimensions, skin depth, machining tolerances, and fabrication difficulty again become limiting.

## Page-Grounded Details

#### Page 504

An air-filled rectangular waveguide has dimensions $a=2$ cm and $b=1$ cm. Deter-mine the range of frequencies over which the guide will operate single mode (TE_10).

Solution. Since the guide is air-filled, $n=1$, and (109) gives, for $m=1$:
$$
f_{C10}=\frac{\omega_{C10}}{2\pi}=\frac{c}{2a}=\frac{3\times 10^{10}}{2(2)}=7.5\,{\rm GHz}
$$
The next higher-order mode will be either TE_20 or TE_01, which from (100) will have the same cutoff frequency because $a=2b$. This frequency will be twice that found for TE_10, or 15 GHz. Thus the operating frequency range over which the guide will be single mode is 7.5 GHz $<f<$ 15 GHz.

#### 13.5.6 The Need for Rectangular Waveguides

Having seen how rectangular waveguides work, questions arise: Why are they used, and when are they useful? Let us consider for a moment the operation of a transmis-sion line at frequencies high enough such that waveguide modes can occur. The onset of guided modes in a transmission line, known as moding, is in fact a problem that needs to be avoided, because signal distortion may result. A signal that is input to such a line will find its power divided in some proportions among the various modes. The si

[Truncated for analysis]

#### Page 505

Because the rectangular guide will not support a TEM mode, it will not operate until the frequency exceeds the cutoff frequency of the lowest-order guided mode of the structure. Thus, the guide must be constructed large enough to accomplish this for a given frequency; the required transverse dimensions will consequently be larger than those of a transmission line that is designed to support only the TEM mode. The increased size, coupled with the fact that there is more conductor surface area than in a transmission line of equal volume, means that losses will be substantially lower in the rectangular waveguide structure. Additionally, the guides will support more power at a given electric field strength than a transmission line, as the rectangular guide will have a higher cross-sectional area.

Still, hollow pipe guides must operate in a single mode in order to avoid the signal distortion problems arising from multimode transmission. This means that the guides must be of dimensions such that they operate above the cutoff frequency of the lowest-order mode, but below the cutoff frequency of the next higher-order mode, as demonstrated in Example 13.4. Increasing the operating frequenc

[Truncated for analysis]

## Core Ideas

- Multimode transmission produces distortion because modes have different group velocities and delays.
- TEM-only transmission-line operation requires all waveguide modes to remain below cutoff.
- Skin effect raises transmission-line series resistance as frequency increases.
- Increasing line dimensions can reduce loss but can also trigger unwanted moding.
- Small conductor separation reduces dielectric-breakdown voltage and power capacity.
- Rectangular guides provide lower loss and greater power handling through larger conducting and cross-sectional areas.
- Rectangular guides must operate above the dominant-mode cutoff and below the next higher-order cutoff.
- At very high frequencies, shrinking guide dimensions and tighter machining tolerances become impractical.

## Source Anchors

- Page 504 states that power divides among modes and that differing group delays cause signal components to lose synchronization.
- The source identifies skin-effect growth in series resistance R as a high-frequency loss mechanism.
- The source states that transmission-line dimensions cannot be enlarged indefinitely because moding may occur.
- Page 505 states that rectangular waveguides have more conductor surface area and substantially lower loss than a transmission line of equal volume.
- Page 505 states that the larger cross-sectional area supports more power at a given electric-field strength.
- The source requires operation above the lowest-order cutoff and below the next higher-order cutoff to avoid multimode distortion.

## Related Pages

- [[te-0p-modes-and-rectangular-guide-single-mode-design|TE_0p Modes and Rectangular-Guide Single-Mode Design]]
- [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
- [[rectangular-waveguide-cutoff-and-propagation|Rectangular Waveguide Cutoff and Propagation]]

## Concept Dependencies

- depends-on: [[rectangular-waveguide-cutoff-and-propagation|Rectangular Waveguide Cutoff and Propagation]]
- depends-on: [[te-0p-modes-and-rectangular-guide-single-mode-design|TE_0p Modes and Rectangular-Guide Single-Mode Design]]
- enables: [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
