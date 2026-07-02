---
title: "Scope Contract"
date: "2026-07-02T19:31:11.765Z"
knowledge_type: "scope-contract"
breadboardType: "scope_contract"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
textbookVersion: "textbook_mr3we0dw_29o85pk"
textbookVersionId: "textbook_mr3we0dw_29o85pk"
sourceSetHash: "abe0dd0c8ad5bb8972502ae85f89aff1a2f3e1f5203d84b6637ec5150e75a743"
tags: ["scope-contract", "contract-scope", "contract-test", "contract", "scope", "test"]
---

# Scope Contract

```json
{
  "included": [
    {
      "topic": "What the source claims SNNs are",
      "scope": "Cover Spiking Neural Networks as the source presents them: brain-inspired neural computation using discrete spike events rather than continuous-valued activations, with emphasis on asynchronous, sparse, event-driven processing.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P1.Intro.SyncVsAsync",
        "S1.P2.SNNDescription"
      ]
    },
    {
      "topic": "Why the source motivates SNNs",
      "scope": "Include the stated limitations of ANN, CNN, RNN, LSTM, GRU, and Transformer models only insofar as the paper uses them to motivate SNNs: energy inefficiency, dense synchronous computation, limited temporal suitability, biological unrealism, and high memory or processing demand.",
      "anchors": [
        "S1.P1.Intro.ANNLimits",
        "S1.P1.Intro.ModelSurvey",
        "S1.P1.Intro.SyncVsAsync"
      ]
    },
    {
      "topic": "Core intuition-first contrast",
      "scope": "Preserve the source’s conceptual spine from continuous synchronous computation toward sparse asynchronous spike-based computation, then use that contrast to motivate energy efficiency, temporal dynamics, and spatiotemporal processing claims.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P1.Intro.SyncVsAsync",
        "S1.P2.SNNDescription"
      ]
    },
    {
      "topic": "Named neuron model",
      "scope": "Include the Leaky Integrate-and-Fire neuron model as a named central neuron model, grounded by the source-central figure, but keep treatment qualitative because the supplied material does not provide the governing equations.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P4.F1"
      ]
    },
    {
      "topic": "Training paradigms explicitly compared",
      "scope": "Cover surrogate gradient descent, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity exactly as the source’s compared training approaches.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2.ResearchGap",
        "S1.P2.Contributions"
      ]
    },
    {
      "topic": "Unified evaluation framing",
      "scope": "Present the paper’s core contribution as a unified head-to-head comparison across accuracy, latency, energy consumption or energy per inference, spike count, and convergence behavior.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2.ResearchGap",
        "S1.P2.Contributions"
      ]
    },
    {
      "topic": "Source-derived comparative results",
      "scope": "Use the extracted tables to compare ANN (CNN), converted SNN, surrogate-gradient or direct SNN, and STDP-based SNN on MNIST accuracy, CIFAR-10 accuracy, latency, normalized energy or energy per inference, spike count, and convergence-related values, always preserving OCR uncertainty and missing-context limits.",
      "anchors": [
        "S1.P0.T1",
        "S1.P0.T2",
        "S1.P0.T3",
        "S1.P0.T5",
        "S1.P0.T6"
      ]
    },
    {
      "topic": "Application-oriented tradeoffs",
      "scope": "Include only the applications and deployment settings explicitly named or directly summarized from the source: robotics, neuromorphic vision, edge AI systems, brain-computer interfaces, sensory processing, mobile devices, and other energy-constrained or latency-sensitive scenarios.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2.NeuromorphicHardware",
        "S1.P2.Contributions"
      ]
    },
    {
      "topic": "Neuromorphic hardware context",
      "scope": "Include IBM TrueNorth and Intel Loihi strictly as source-cited examples showing that SNNs can be deployed at scale with low power consumption.",
      "anchors": [
        "S1.P2.NeuromorphicHardware"
      ]
    },
    {
      "topic": "Research gap and source-shaped questions",
      "scope": "Keep the learning path centered on the source’s motivating questions: why use SNNs instead of conventional ANNs, how surrogate-trained, converted, and STDP-based SNNs trade off, and what unified-comparison gap the paper claims to address.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2.ResearchGap",
        "S1.P2.Contributions"
      ]
    },
    {
      "topic": "Open challenges",
      "scope": "Include only the unresolved challenges explicitly stated in the source: hardware standardization and scalable training.",
      "anchors": [
        "S1.P1.Abstract"
      ]
    },
    {
      "topic": "Source-central figure and table handling",
      "scope": "Treat the LIF neuron model figure as mandatory source evidence, use source-derived tables as carefully labeled comparison evidence, treat S1.P0.T4 as likely duplicate support rather than distinct evidence, and exclude unclear page-image placeholders from substantive teaching use.",
      "anchors": [
        "S1.P4.F1",
        "S1.P0.T1",
        "S1.P0.T2",
        "S1.P0.T3",
        "S1.P0.T4",
        "S1.P0.T5",
        "S1.P0.T6"
      ]
    }
  ],
  "excluded": [
    {
      "topic": "Unsupported mathematical expansion",
      "reason": "Do not introduce LIF differential equations, membrane update rules, threshold-reset equations, STDP update equations, surrogate-gradient derivations, or formal energy formulas because they are not present in the supplied source material."
    },
    {
      "topic": "Unsupported metric formalization",
      "reason": "Do not provide formal mathematical definitions of accuracy, latency, energy, spike count, or convergence beyond plain-language explanation, because the supplied material names and tabulates these metrics but does not define them mathematically."
    },
    {
      "topic": "Unverified methodology reconstruction",
      "reason": "Do not specify architectures, preprocessing, simulation windows, hyperparameters, hardware setup, dataset protocol details, or exact evaluation procedures beyond what is explicitly available."
    },
    {
      "topic": "Disconnected background chapters or topic cards",
      "reason": "Do not create standalone cards or separate textbook pages on general neuroscience, synapses, action potentials, deep learning history, conventional network families, neuromorphic hardware internals, or datasets except where briefly needed to understand the source’s own argument."
    },
    {
      "topic": "Broader SNN taxonomy",
      "reason": "Do not expand into additional neuron models, coding schemes, learning rules, neuromorphic chips, or historical surveys not explicitly named in the source."
    },
    {
      "topic": "External comparisons or field-level claims",
      "reason": "Do not compare this paper’s results against outside papers, later benchmarks, or general field consensus; keep all claims source-bound."
    },
    {
      "topic": "Speculative figure use",
      "reason": "Do not treat S1.P17.F1 through S1.P17.F17 as semantic figures unless later verified; they currently appear to be page-image placeholders."
    },
    {
      "topic": "Duplicate evidence overcounting",
      "reason": "Do not count S1.P0.T4 as an independent latency result unless later source validation shows it is distinct from S1.P0.T3."
    },
    {
      "topic": "Disconnected output structures",
      "reason": "Do not produce unsupported expansion, disconnected topic cards, or final Generated Subtopics pages."
    }
  ],
  "background": {
    "allowed": [
      {
        "topic": "Minimal prerequisite framing",
        "scope": "Allow only the minimum first-principles background needed to understand the source’s contrast between conventional neural networks and SNNs."
      },
      {
        "topic": "Conventional model references",
        "scope": "Briefly define ANN, CNN, RNN, LSTM, GRU, and Transformer only when needed to explain the paper’s motivation, without turning them into separate lessons."
      },
      {
        "topic": "Spikes and asynchronous computation",
        "scope": "Introduce spikes, sparse activity, and asynchronous signaling only to the extent required to understand the source’s brain-inspired framing and efficiency claims."
      },
      {
        "topic": "Metrics vocabulary",
        "scope": "Define accuracy, latency, energy per inference, spike count, and convergence in plain language only, without inventing formal definitions absent from the source."
      },
      {
        "topic": "Neuron model and training vocabulary",
        "scope": "Explain what a neuron model and a training paradigm mean only as much as needed to follow the source’s named LIF, surrogate-gradient, conversion, and STDP discussion."
      }
    ],
    "limits": [
      "Background must be introduced only when needed to understand a source claim.",
      "Background must remain subordinate to the source and must not become a parallel content track.",
      "The chapter flow must remain coherent and source-grounded rather than fragmenting into disconnected mini-lessons."
    ]
  },
  "deferred": [
    {
      "topic": "Exact LIF equations and parameter-level interpretation",
      "reason": "The source identifies the LIF neuron model and includes a figure caption, but the governing equations and term definitions are not present in the supplied text."
    },
    {
      "topic": "Formal metric definitions",
      "reason": "The source names and tabulates metrics, but does not provide explicit mathematical definitions for them in the supplied material."
    },
    {
      "topic": "Detailed experimental methodology",
      "reason": "The main prose is truncated after Page 2, so exact architectures, datasets, training setup, and evaluation protocol details are incomplete."
    },
    {
      "topic": "Interpretation of the convergence table metric",
      "reason": "S1.P0.T6 is convergence-related, but the metric represented by its values is unclear in the provided OCR."
    },
    {
      "topic": "Event-based versus static dataset analysis",
      "reason": "The Page 2 contribution framing mentions both event-based and static datasets, but the supplied material does not provide enough later detail for a full treatment."
    },
    {
      "topic": "Additional figure-by-figure walkthrough beyond Fig. 1",
      "reason": "Most extracted figure entries beyond S1.P4.F1 are unclear placeholders rather than verified semantic figures."
    },
    {
      "topic": "Any cross-source synthesis",
      "reason": "This contract is source-only and must not expand beyond the mapped source set."
    },
    {
      "topic": "Any separate subtopic index or final Generated Subtopics page",
      "reason": "The contract forbids disconnected topic cards and final Generated Subtopics pages."
    }
  ],
  "sourceEmphasis": {
    "primarySource": "2510-27379v1",
    "priorityOrder": [
      {
        "priority": "highest",
        "focus": "Use the abstract and first two pages as the authoritative prose backbone for motivation, framing, named models, comparison dimensions, applications, and challenges.",
        "anchors": [
          "S1.P1.Abstract",
          "S1.P1.Intro.ANNLimits",
          "S1.P1.Intro.ModelSurvey",
          "S1.P1.Intro.SyncVsAsync",
          "S1.P2.SNNDescription",
          "S1.P2.NeuromorphicHardware",
          "S1.P2.ResearchGap",
          "S1.P2.Contributions"
        ]
      },
      {
        "priority": "highest",
        "focus": "Emphasize the paper’s core contribution: unified multi-metric comparison across surrogate-trained, converted, and STDP-based SNNs.",
        "anchors": [
          "S1.P2.ResearchGap",
          "S1.P2.Contributions",
          "S1.P0.T1",
          "S1.P0.T3",
          "S1.P0.T5",
          "S1.P0.T6"
        ]
      },
      {
        "priority": "high",
        "focus": "Treat the LIF neuron model figure as mandatory source evidence for neuron-model coverage, limited to qualitative explanation.",
        "anchors": [
          "S1.P4.F1",
          "S1.P1.Abstract"
        ]
      },
      {
        "priority": "high",
        "focus": "Use T1 and T2 for accuracy comparisons, with T1 preferred when accuracy and energy need to be discussed together and T2 used only when a simpler accuracy-only view is necessary.",
        "anchors": [
          "S1.P0.T1",
          "S1.P0.T2"
        ]
      },
      {
        "priority": "high",
        "focus": "Use T3 as the primary latency comparison and treat T4 only as likely duplicate support, not distinct evidence.",
        "anchors": [
          "S1.P0.T3",
          "S1.P0.T4"
        ]
      },
      {
        "priority": "high",
        "focus": "Use T5 for energy-per-inference and spike-count tradeoffs central to the source’s application guidance.",
        "anchors": [
          "S1.P0.T5"
        ]
      },
      {
        "priority": "guarded",
        "focus": "Use T6 only as a convergence-related table with explicit uncertainty about the meaning of its values.",
        "anchors": [
          "S1.P0.T6"
        ]
      }
    ],
    "visualPolicy": [
      "Every figure or table used in teaching must remain explicitly anchored to its source id.",
      "S1.P4.F1 must receive explicit explanatory treatment because it is source-central.",
      "S1.P17.F1 through S1.P17.F17 must be omitted or explicitly marked unused due to unclear identity.",
      "Source-derived tables may be used only with OCR and missing-context caveats.",
      "Overlapping tables must be deduplicated intentionally rather than repeated as separate evidence.",
      "Any eventual visual representation must remain source-aware and support regeneration from the cited source objects."
    ]
  },
  "caveats": [
    "The main prose source is truncated after Page 2, so later claims must not be expanded beyond the abstract, introduction, source anchors, and OCR-derived table content provided here.",
    "The LIF neuron model is clearly central, but only its name and figure caption are reliably available in the supplied material; no unsupported equations or mechanistic details may be invented.",
    "The performance metrics are named and compared numerically, but formal mathematical definitions are not present in the supplied material and must not be fabricated.",
    "OCR-derived tables are usable as source-derived evidence but may contain transcription artifacts, duplication, or missing surrounding explanation.",
    "S1.P0.T6 can be referenced only as a convergence-related table with unclear metric identity unless its label is later verified.",
    "S1.P0.T4 appears duplicative of S1.P0.T3 and should not be treated as an additional independent latency result.",
    "Only S1.P4.F1 is clearly source-central among the extracted figures; S1.P17.F1 through S1.P17.F17 should not drive content planning or claims.",
    "Applications, hardware examples, and tradeoff statements should remain illustrative and source-bounded rather than expanded into broader surveys.",
    "All content must remain a coherent source-grounded learning path rather than a collection of disconnected topic cards.",
    "No unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages are permitted under this contract."
  ]
}
```
