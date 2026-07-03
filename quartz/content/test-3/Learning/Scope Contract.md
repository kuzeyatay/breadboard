---
title: "Scope Contract"
date: "2026-07-03T07:28:13.614Z"
knowledge_type: "scope-contract"
breadboardType: "scope_contract"
gardenId: "test-3"
internal: "true"
generatedBy: "learn_button"
generated_by: "learn_button"
textbookVersion: "textbook_mr4m0tt7_21gtzv6"
textbookVersionId: "textbook_mr4m0tt7_21gtzv6"
sourceSetHash: "1a8c69e9b052968ea2e755389c511804d1ce94c20dbb841dad31dfcb2910f645"
---

# Scope Contract

```json
{
  "included": [
    {
      "topic": "What the source claims Spiking Neural Networks are",
      "scope": "Define SNNs only as supported by the abstract and introduction: a brain-inspired neural computation paradigm using discrete spike events, sparse event-driven signaling, temporal dynamics, and energy-efficiency framing.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P1.Intro",
        "S1.P2"
      ]
    },
    {
      "topic": "Source-grounded contrast with conventional neural architectures",
      "scope": "Include only the source’s comparison of SNNs with ANNs, CNNs, RNNs, LSTMs/GRUs, and Transformers on synchrony versus asynchrony, continuous activations versus spikes, temporal handling, computational cost, memory or processing demand, power use, and biological realism.",
      "anchors": [
        "S1.P1.Intro",
        "S1.P2"
      ]
    },
    {
      "topic": "Asynchronous spike-based computation",
      "scope": "Cover the source’s explanation that biological communication uses discrete spikes and that SNNs process information through sparse event-driven spike trains rather than synchronous continuous activations.",
      "anchors": [
        "S1.P1.Intro",
        "S1.P2"
      ]
    },
    {
      "topic": "Neuron modeling at source-supported level",
      "scope": "Include the Leaky Integrate-and-Fire neuron model only as named in the abstract and visually grounded by the membrane-potential-with-threshold graph, without extending into unsupported governing equations, reset rules, or parameter derivations.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P4.G1"
      ]
    },
    {
      "topic": "Conceptual SNN architecture",
      "scope": "Include the existence of a conceptual spiking neural network architecture with lateral inhibition as evidenced by the page 4 diagram, described conservatively and only at the level supported by source metadata.",
      "anchors": [
        "S1.P4.F1"
      ]
    },
    {
      "topic": "Training paradigms under comparison",
      "scope": "Include surrogate gradient descent, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity as the three named training strategies and the paper’s main comparison axis.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2.Gap",
        "S1.P2.Contrib"
      ]
    },
    {
      "topic": "Literature gap and contribution framing",
      "scope": "Include the source’s claim that prior work often isolates one method or one metric, and that this paper’s contribution is a unified head-to-head protocol with hardware-aware metrics, convergence analysis, and application-oriented guidance.",
      "anchors": [
        "S1.P2.Gap",
        "S1.P2.Contrib"
      ]
    },
    {
      "topic": "Unified multi-metric evaluation framework",
      "scope": "Include the five core comparison dimensions named by the source: accuracy, latency, energy consumption or energy per inference, spike count, and convergence behavior.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2.Gap",
        "S1.P2.Contrib",
        "S1.P6.E1",
        "S1.P6.E2",
        "S1.P6.E3",
        "S1.P6.E4",
        "S1.P6.E5",
        "S1.P6.E6"
      ]
    },
    {
      "topic": "Metric definitions at caption-derived level",
      "scope": "Include only the caption-supported meanings of accuracy, latency, total spike count, total energy, normalized energy efficiency, and convergence time; define all terms in plain language but do not fabricate exact symbolic notation, variable names, or normalization details.",
      "anchors": [
        "S1.P6.E1",
        "S1.P6.E2",
        "S1.P6.E3",
        "S1.P6.E4",
        "S1.P6.E5",
        "S1.P6.E6"
      ]
    },
    {
      "topic": "Comparative findings explicitly recoverable from source",
      "scope": "Include the abstract-level findings that surrogate gradient-trained SNNs approximate ANN accuracy within 1-2%, show faster convergence by the 20th epoch, and can reach latency as low as 10 milliseconds; converted SNNs are competitive but require higher spike counts and longer simulation windows; STDP-based SNNs converge more slowly but show the lowest spike counts and energy consumption, as low as 5 millijoules per inference.",
      "anchors": [
        "S1.P1.Abstract"
      ]
    },
    {
      "topic": "Performance summaries and trend-level comparison evidence",
      "scope": "Use the page 7-11 tables and graphs only for qualitative or trend-level comparison structure across ANN, converted SNN, direct SNN, surrogate gradient SNN, and STDP-based SNN where captions support those labels, without inventing exact numeric readings.",
      "anchors": [
        "S1.P7.T1",
        "S1.P7.G1",
        "S1.P8.T1",
        "S1.P8.G1",
        "S1.P9.T1",
        "S1.P9.G1",
        "S1.P10.T1",
        "S1.P10.G1",
        "S1.P11.G1"
      ]
    },
    {
      "topic": "Datasets, applications, and deployment contexts named by the source",
      "scope": "Include MNIST and CIFAR-10 only as caption-named datasets in the comparison context, and include robotics, neuromorphic vision, edge AI systems, sensory processing, and brain-computer interfaces only as source-named motivating applications tied to the reported tradeoffs.",
      "anchors": [
        "S1.P1.Abstract",
        "S1.P2",
        "S1.P2.Contrib",
        "S1.P7.G1"
      ]
    },
    {
      "topic": "Neuromorphic hardware relevance",
      "scope": "Include IBM TrueNorth and Intel Loihi only as source-cited examples linking SNNs to neuromorphic engineering and low-power deployment.",
      "anchors": [
        "S1.P2"
      ]
    },
    {
      "topic": "Open challenges named by the source",
      "scope": "Include hardware standardization and scalable training as the explicitly named unresolved challenges.",
      "anchors": [
        "S1.P1.Abstract"
      ]
    },
    {
      "topic": "Source-central visual and formula coverage obligations",
      "scope": "Treat the page 4 graph and diagram, the six page 6 formulas, and the page 7-11 tables and graphs as mandatory evidence-bearing source elements for planning coverage. Each source-central visual cluster must be accounted for in later garden planning either through direct use or explicit non-use justification, with conservative interpretation limits based on available metadata.",
      "anchors": [
        "S1.P4.G1",
        "S1.P4.F1",
        "S1.P6.E1",
        "S1.P6.E2",
        "S1.P6.E3",
        "S1.P6.E4",
        "S1.P6.E5",
        "S1.P6.E6",
        "S1.P7.T1",
        "S1.P7.G1",
        "S1.P8.T1",
        "S1.P8.G1",
        "S1.P9.T1",
        "S1.P9.G1",
        "S1.P10.T1",
        "S1.P10.G1",
        "S1.P11.G1"
      ]
    }
  ],
  "excluded": [
    {
      "topic": "Unsupported neuroscience or neuron-dynamics expansion",
      "reason": "Do not add synaptic physiology, Hodgkin-Huxley dynamics, refractory-period mathematics, detailed membrane-current models, or biological mechanisms not present in the provided source material."
    },
    {
      "topic": "Invented LIF equations or parameters",
      "reason": "Exact symbolic LIF equations, reset rules, membrane constants, current terms, and threshold notation are not available in the supplied source text or metadata."
    },
    {
      "topic": "Detailed STDP, surrogate-gradient, or ANN-to-SNN conversion algorithms",
      "reason": "Do not supply update equations, timing-window rules, surrogate functions, threshold-balancing methods, coding variants, loss formulations, or conversion pipelines not visible in the provided source material."
    },
    {
      "topic": "Experimental protocol details not recoverable from source",
      "reason": "Exclude model architectures, hyperparameters, preprocessing, dataset splits, timestep counts, simulation settings, hardware assumptions, and measurement methodology because they are missing from the provided evidence."
    },
    {
      "topic": "Independent formula reconstruction",
      "reason": "Do not fabricate symbols, denominators, normalization constants, or exact mathematical expressions for the page 6 metrics beyond caption-level descriptions."
    },
    {
      "topic": "Invented numeric table or graph readings",
      "reason": "Do not reconstruct exact values, axes, legends, rankings, or plotted coordinates from page 7-11 figures and tables beyond what captions and abstract-level findings explicitly support."
    },
    {
      "topic": "Terminology resolution without evidence",
      "reason": "Do not assume that 'direct SNN' and 'surrogate gradient SNN' are identical or distinct unless fuller source access confirms the relationship."
    },
    {
      "topic": "Broader history or taxonomy beyond source need",
      "reason": "Exclude disconnected background on perceptrons, backpropagation history, computational neuroscience, coding schemes, or general deep learning taxonomy unless directly required to parse a source claim."
    },
    {
      "topic": "Neuromorphic hardware deep dive",
      "reason": "Do not expand into chip architecture, routing, instruction models, benchmarks, or implementation details for TrueNorth or Loihi beyond their role as named examples."
    },
    {
      "topic": "Standalone application deep dives",
      "reason": "Do not create independent modules on robotics, neuromorphic vision, edge AI, sensory processing, or brain-computer interfaces detached from the paper’s SNN tradeoff narrative."
    },
    {
      "topic": "Disconnected topic cards",
      "reason": "Do not create isolated side topics on CNNs, Transformers, datasets, hardware, or applications outside their role in the paper’s unified comparison story."
    },
    {
      "topic": "Final Generated Subtopics pages",
      "reason": "The contract forbids final Generated Subtopics pages; planning must remain integrated and source-bound rather than atomized into unsupported subtopic fragments."
    }
  ],
  "background": {
    "assumedLearnerStartingPoint": [
      "Learner may know only that neural networks are computational models used in AI.",
      "Learner may not know why continuous activations differ from discrete spikes.",
      "Learner may not know why accuracy, latency, energy, spike count, and convergence are separate evaluation metrics."
    ],
    "minimumConceptualSetupAllowed": [
      {
        "need": "Why compare SNNs to other networks",
        "limit": "Use only the source’s claims about synchronous continuous computation, computational cost, memory or processing demand, temporal handling, and biological realism."
      },
      {
        "need": "What a spike is in this garden",
        "limit": "Define only as a discrete timed event or binary spike signal, matching source language."
      },
      {
        "need": "Why LIF appears",
        "limit": "Present LIF only as a named neuron model and as illustrated by membrane potential changing over time relative to threshold."
      },
      {
        "need": "Why the metrics matter",
        "limit": "Explain them only as the source’s unified protocol for model selection in energy-constrained, latency-sensitive, and neuromorphic settings."
      }
    ],
    "narrativeFrame": "Any later section planning should follow one continuous learning spine: start from the source’s motivation that conventional neural models rely on synchronous continuous computation, introduce SNNs as discrete spike-based alternatives, move into the three compared training paradigms, then into the five evaluation metrics, then into the reported tradeoffs, and finally into application guidance and named challenges.",
    "evidenceHierarchy": [
      "Prefer direct prose claims from pages 1-2 as the primary narrative backbone.",
      "Use page 6 formulas at caption-derived definition level only.",
      "Use page 4 and page 7-11 visuals as bounded evidence layers that show emphasis and qualitative comparison structure without licensing unsupported detail."
    ],
    "structureConstraint": "Background must remain subordinate to the paper’s own framing and must not become an independent textbook on neuroscience, deep learning, or neuromorphic hardware."
  },
  "deferred": [
    {
      "topic": "Full mathematical derivation of LIF dynamics",
      "deferReason": "Unsupported by available source text and notation."
    },
    {
      "topic": "Formal derivations for surrogate gradients, STDP learning windows, and conversion algorithms",
      "deferReason": "The methods are named by the source but not technically specified in the provided material."
    },
    {
      "topic": "Detailed experiment methodology",
      "deferReason": "Model architectures, simulation settings, hardware assumptions, and dataset preparation are not visible in the provided text."
    },
    {
      "topic": "Exact quantitative benchmarking tables and chart recreations",
      "deferReason": "Underlying numeric values, axes, legends, and plotted series are absent."
    },
    {
      "topic": "Precise relation between 'direct SNN' and 'surrogate gradient SNN'",
      "deferReason": "Current evidence does not resolve the terminology."
    },
    {
      "topic": "Expanded application case studies",
      "deferReason": "Applications are listed as motivations, but detailed case studies are not provided."
    },
    {
      "topic": "Assessment design beyond source-inferred question targets",
      "deferReason": "No source-authored question bank is present in the provided material."
    },
    {
      "topic": "Any standalone learner-facing subtopic generation",
      "deferReason": "The contract disallows disconnected topic cards and final Generated Subtopics pages."
    }
  ],
  "sourceEmphasis": {
    "primaryAnchors": [
      "S1.P1.Abstract",
      "S1.P1.Intro",
      "S1.P2",
      "S1.P2.Gap",
      "S1.P2.Contrib"
    ],
    "highPriorityVisuals": [
      {
        "id": "S1.P4.G1",
        "why": "Central for explaining the named LIF neuron model without inventing unsupported equations."
      },
      {
        "id": "S1.P4.F1",
        "why": "Central for grounding the architecture discussion and lateral inhibition mention conservatively."
      },
      {
        "id": "S1.P6.E1",
        "why": "Defines accuracy, one of the five core metrics."
      },
      {
        "id": "S1.P6.E2",
        "why": "Defines latency, a central deployment metric."
      },
      {
        "id": "S1.P6.E3",
        "why": "Defines total spike count, essential to the source’s efficiency comparison."
      },
      {
        "id": "S1.P6.E4",
        "why": "Defines total energy, essential to the low-power framing."
      },
      {
        "id": "S1.P6.E5",
        "why": "Defines normalized energy efficiency, important for cross-model evaluation."
      },
      {
        "id": "S1.P6.E6",
        "why": "Defines convergence time, important for optimization comparison."
      },
      {
        "id": "S1.P7.T1",
        "why": "Summarizes accuracy and normalized energy comparison across model families."
      },
      {
        "id": "S1.P7.G1",
        "why": "Shows the source-central comparison structure involving MNIST, CIFAR-10, and energy."
      },
      {
        "id": "S1.P8.T1",
        "why": "Summarizes latency comparison."
      },
      {
        "id": "S1.P8.G1",
        "why": "Shows latency trends visually."
      },
      {
        "id": "S1.P9.T1",
        "why": "Summarizes energy per inference and spike count by model."
      },
      {
        "id": "S1.P9.G1",
        "why": "Shows the efficiency tradeoff structure visually."
      },
      {
        "id": "S1.P10.T1",
        "why": "Provides epoch-based training-loss comparison structure."
      },
      {
        "id": "S1.P10.G1",
        "why": "Supports convergence-behavior claims qualitatively."
      },
      {
        "id": "S1.P11.G1",
        "why": "Supports 20-epoch training-accuracy curve interpretation at trend level."
      }
    ],
    "coverageRules": [
      "Use the abstract and first two pages as the narrative backbone because they provide the most explicit prose.",
      "Use page 4, page 6, and pages 7-11 materials as evidence-backed support only at the granularity the metadata allows.",
      "Treat later-page figures, graphs, and tables as mandatory source signals for coverage, but phrase interpretations conservatively and qualitatively.",
      "Give special attention to the paper’s stated literature gap and contribution framing so the garden reflects the paper’s actual purpose: unified tradeoff analysis rather than a generic SNN overview.",
      "If later garden stages use visuals, each visual must have a distinct job in the learning spine; paired table-and-graph evidence from the same page should not duplicate one another without justification.",
      "If later garden stages generate visuals, they should be introduced immediately after the concept they clarify rather than collected at the end."
    ],
    "questionTargets": [
      "How asynchronous spike-based communication differs from synchronous continuous activation in conventional networks.",
      "What tradeoffs emerge when comparing surrogate-trained, converted, and STDP-based SNNs across accuracy, latency, energy, spike count, and convergence.",
      "Why SNNs may be more suitable for edge, mobile, or latency-sensitive deployments.",
      "How latency, energy, and spike-count metrics influence application-oriented model selection for neuromorphic systems."
    ]
  },
  "caveats": [
    "Source-only mode is binding: no unsupported expansion, even if omitted material would normally improve pedagogy.",
    "Only pages 1-2 are available as direct prose, and page 2 is truncated mid-sentence; later sections are represented mainly through figure, graph, table, and formula metadata.",
    "All formula handling must remain caption-derived unless fuller notation is recovered.",
    "Any comparison on pages 7-11 must be qualitative, structural, or explicitly labeled as abstract-level summary rather than exact quantitative reconstruction.",
    "The phrases 'within 1-2%', '10 milliseconds', and '5 millijoules per inference' are supported as abstract-level findings and should be attributed at that level only.",
    "The relation between 'direct SNN' and 'surrogate gradient SNN' is unresolved and must remain unresolved in scope.",
    "Source-central visuals are coverage obligations, not permission to invent missing details from unseen axes, legends, tables, or hidden prose.",
    "No unsupported expansion, no disconnected topic cards, and no final Generated Subtopics pages are permitted under this contract."
  ]
}
```
