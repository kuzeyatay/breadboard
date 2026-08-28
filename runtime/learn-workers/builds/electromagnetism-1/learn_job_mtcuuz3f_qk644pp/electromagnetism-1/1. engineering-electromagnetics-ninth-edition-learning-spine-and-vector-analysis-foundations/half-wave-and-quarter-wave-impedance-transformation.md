---
title: "1.189 Half-Wave and Quarter-Wave Impedance Transformation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 343", "Page 344"]
related: ["finite-lossless-line-input-impedance", "reflection-at-a-load-discontinuity", "characteristic-impedance-of-a-transmission-line", "matched-and-mismatched-receiver-line-example"]
---

# 1.189 Half-Wave and Quarter-Wave Impedance Transformation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 343, Page 344

Special electrical lengths simplify the general finite-line input-impedance formula. If $l=m\lambda/2$, then $\beta l=m\pi$, the sine terms vanish, and the input impedance exactly repeats the load: $Z_{\mathrm{in}}=Z_L$. If the line has an odd quarter-wave length, then $\beta l=(2m+1)\pi/2$, the cosine terms vanish, and
$$
Z_{\mathrm{in}}=\frac{Z_0^2}{Z_L}
$$
 This impedance-inversion property enables a quarter-wave transformer between two real line impedances $Z_{01}$ and $Z_{03}$. Inserting a quarter-wave section with characteristic impedance $Z_{02}$ produces an input impedance $Z_{02}^2/Z_{03}$. Requiring this to equal $Z_{01}$ gives
$$
Z_{02}=\sqrt{Z_{01}Z_{03}}
$$
 The technique eliminates reflection at the design frequency, but it is inherently narrowband because the required electrical length changes when frequency changes.

## Page-Grounded Details

#### Page 343
$$
Z_{\mathrm{in}}=Z_{0}\left[\frac{Z_{L}\cos(\beta l)+jZ_{0}\sin(\beta l)}{Z_{0}\cos(\beta l)+jZ_{L}\sin(\beta l)}\right]
$$
(98)

This is the quantity that we need in order to create the equivalent circuit in Figure 10.7.

One special case is that in which the line length is a half-wavelength, or an inte-ger multiple thereof. In that case,
$$
\beta l=\frac{2\pi}{\lambda}\frac{m\lambda}{2}=m\pi\quad(m=0,1,2,\ldots)
$$
Using this result in (98), we find
$$
Z_{\mathrm{in}}(l=m\lambda/2)=Z_{L}
$$
(99)

For a half-wave line, the equivalent circuit can be constructed simply by removing the line completely and placing the load impedance at the input. This simplifica-tion works, of course, provided the line length is indeed an integer multiple of a half-wavelength. Once the frequency begins to vary, the condition is no longer satis-fied, and (98) must be used in its general form to find $Z_{\mathrm{in}}$.

Another important special case is that in which the line length is an odd multiple of a quarter wavelength:
$$
\beta l=\frac{2\pi}{\lambda}(2m+1)\frac{\lambda}{4}=(2m+1)\frac{\pi}{2}\quad(m=0,1,2,\ldots)
$$
Using this result in (98) leads to
$$
Z_{\mathrm{in}}(l=\lambda/4)=\f

[Truncated for analysis]

#### Page 344

if $Z_{02}$ is chosen so that
$$
 Z_{02} = \sqrt{Z_{01}Z_{03}} $$
(103)

This technique is called _quarter-wave matching_ and again is limited to the frequency (or narrow band of frequencies) such that $l = (2m + 1)\lambda/4$. We will encounter more examples of these techniques when we explore electromagnetic wave reflection in Chapter 12. Meanwhile, further examples that involve the use of the input impedance and the VSWR are presented in Section 10.12.

#### 10.12 SOME TRANSMISSION LINE EXAMPLES

In this section, we apply many of the results that we obtained in the previous sections to several typical transmission line problems. We simplify our work by restricting our attention to the lossless line.

We begin by assuming a two-wire 300 $\Omega$ line ($Z_{0} = 300~{}\Omega$), such as the lead-in wire from the antenna to a television or FM receiver. The circuit is shown in Figure 10.8. The line is 2 m long, and the values of $L$ and $C$ are such that the velocity on the line is $2.5\times 10^{8}$ m/s. We will terminate the line with a receiver having an input resistance of 300 $\Omega$ and represent the antenna by its Thevenin equivalent $Z = 300~{}\Omega$ in ser

[Truncated for analysis]

## Core Ideas

- A half-wave line repeats its terminating impedance at the input.
- $Z_{\mathrm{in}}=Z_L$ when $l=m\lambda/2$.
- A quarter-wave line inverts impedance as $Z_{\mathrm{in}}=Z_0^2/Z_L$.
- A matching section requires $Z_{02}=\sqrt{Z_{01}Z_{03}}$.
- Quarter-wave matching removes the junction reflection at the design frequency.
- The method is limited to a frequency or narrow band satisfying the quarter-wave condition.

## Source Anchors

- Equation (99) gives the half-wave impedance repetition.
- Equation (100) gives the quarter-wave impedance inversion.
- Equations (101) and (102) apply the finite-line formula to an inserted matching section.
- Equation (103) gives $Z_{02}=\sqrt{Z_{01}Z_{03}}$.
- The source explicitly identifies the method as quarter-wave matching and notes its frequency limitation.

## Related Pages

- [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]
- [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
- [[characteristic-impedance-of-a-transmission-line|Characteristic Impedance of a Transmission Line]]
- [[matched-and-mismatched-receiver-line-example|Matched and Mismatched Receiver-Line Example]]

## Concept Dependencies

- derives-from: [[finite-lossless-line-input-impedance|Finite Lossless Line Input Impedance]]
- applies-to: [[reflection-at-a-load-discontinuity|Reflection at a Load Discontinuity]]
