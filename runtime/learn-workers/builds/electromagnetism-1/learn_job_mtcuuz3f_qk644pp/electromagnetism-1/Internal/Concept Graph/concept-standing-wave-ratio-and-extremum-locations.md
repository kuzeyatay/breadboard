---
title: "Standing-Wave Ratio and Extremum Locations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "standing-wave-ratio-and-extremum-locations"
locations: ["Page 428, Section 12.2 and Equation (18)", "Page 429, Equations (19) through (25)", "Page 430, Equation (26), Example 12.2, and Figure 12.3", "Page 431, completion of Example 12.2 and Equation (27)"]
related: ["reflection-and-transmission-coefficients", "total-reflection-from-a-perfect-conductor", "inferring-material-impedance-from-standing-waves", "power-reflectivity-and-conservation"]
---

## ConceptNode: Standing-Wave Ratio and Extremum Locations

Planning node for [[standing-wave-ratio-and-extremum-locations|1.249 Standing-Wave Ratio and Extremum Locations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 428, Section 12.2 and Equation (18), Page 429, Equations (19) through (25), Page 430, Equation (26), Example 12.2, and Figure 12.3, Page 431, completion of Example 12.2 and Equation (27)

When $|\Gamma|<1$, region 1 contains both incident and reflected fields. Their interference creates spatial maxima and minima superimposed on a remaining traveling-wave contribution. Writing $\Gamma=|\Gamma|e^{j\phi}$, the total phasor is $$E_{x1T}=E_{x10}^{+}[e^{-j\beta_1z}+|\Gamma|e^{j(\beta_1z+\phi)}].$$ The maximum and minimum amplitudes are $(1+|\Gamma|)E_{x10}^{+}$ and $(1-|\Gamma|)E_{x10}^{+}$. Their locations are $$z_{\max}=-\frac{\phi+2m\pi}{2\beta_1},\qquad z_{\min}=-\frac{\phi+(2m+1)\pi}{2\beta_1}.$$ Adjacent maxima, or adjacent minima, are separated by $\lambda_1/2$. The standing-wave ratio is $$s=\frac{1+|\Gamma|}{1-|\Gamma|}.$$ It equals 1 for a matched interface and approaches infinity for total reflection. The phase of $\Gamma$ determines whether the interface itself is a maximum or minimum.

### Key planning details

- Partial reflection produces both traveling-wave and standing-wave behavior in region 1.
- The maximum amplitude is $(1+|\Gamma|)E_{x10}^{+}$.
- The minimum amplitude is $(1-|\Gamma|)E_{x10}^{+}$.
- Maxima and minima of the same type repeat every $\lambda_1/2$.
- $\phi=0$ places an electric maximum at the interface.
- $\phi=\pi$ places an electric minimum at the interface.
- $s=(1+|\Gamma|)/(1-|\Gamma|)$.
- $s=1$ indicates no reflection, while $s\to\infty$ indicates total reflection.

### Source coverage

- Equation (19) gives the total region-1 field including $|\Gamma|$ and phase $\phi$.
- Equations (20) through (25) give the extremum amplitudes and locations.
- Equation (26) decomposes the instantaneous field into traveling and standing contributions.
- Example 12.2 uses $\Gamma=-0.2$ and finds minima of $80\ \mathrm{V/m}$ at half-wavelength intervals.
- Example 12.2 finds maxima of $120\ \mathrm{V/m}$ at 1.25, 3.75, and 6.25 cm from the boundary.
- Equation (27) gives the standing-wave ratio, and D12.2 gives $s=3$ for $\Gamma=\pm1/2$.
