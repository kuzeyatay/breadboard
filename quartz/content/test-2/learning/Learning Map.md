---
title: "Learning Map"
date: "2026-07-16T09:20:29.270Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrnask8c_laya7c2"
learningVersionId: "learning_mrnask8c_laya7c2"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Learning Map

## Section Order

- 1. Why Spiking Neural Networks Matters
  - 1.1 [[learning/1. Why Spiking Neural Networks Matters/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
  - 1.2 [[learning/1. Why Spiking Neural Networks Matters/1.2 Why Training Spiking Networks Are Difficult|Why Training Spiking Networks Are Difficult]]
- 2. How Spike Event Works
  - 2.1 [[learning/2. How Spike Event Works/2.1 Spikes, Timing, and Temporal Information|Spikes, Timing, and Temporal Information]]
  - 2.2 [[learning/2. How Spike Event Works/2.2 Event-Driven Computation and Energy Efficiency|Event-Driven Computation and Energy Efficiency]]
  - 2.3 [[learning/2. How Spike Event Works/2.3 Membrane Potential, Input Integration, and Leakage|Membrane Potential, Input Integration, and Leakage]]
  - 2.4 [[learning/2. How Spike Event Works/2.4 From Encoded Inputs to Competing Neurons|From Encoded Inputs to Competing Neurons]]
  - 2.5 [[learning/2. How Spike Event Works/2.5 Excitation, Inhibition, and Winner Selection|Excitation, Inhibition, and Winner Selection]]
- 3. Describing Firing Threshold Formally
  - 3.1 [[learning/3. Describing Firing Threshold Formally/3.1 Threshold Crossing, Spike Emission, and Reset|Threshold Crossing, Spike Emission, and Reset]]
  - 3.2 [[learning/3. Describing Firing Threshold Formally/3.2 Classification Accuracy|Classification Accuracy]]
  - 3.3 [[learning/3. Describing Firing Threshold Formally/3.3 Inference Latency|Inference Latency]]
  - 3.4 [[learning/3. Describing Firing Threshold Formally/3.4 Spike Count and Energy per Inference|Spike Count and Energy per Inference]]
- 4. How Surrogate Gradient Is Applied
  - 4.1 [[learning/4. How Surrogate Gradient Is Applied/4.1 Surrogate-Gradient Training|Surrogate-Gradient Training]]
  - 4.2 [[learning/4. How Surrogate Gradient Is Applied/4.2 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
  - 4.3 [[learning/4. How Surrogate Gradient Is Applied/4.3 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]]
  - 4.4 [[learning/4. How Surrogate Gradient Is Applied/4.4 Evaluating SNNs Across Multiple Metrics|Evaluating SNNs Across Multiple Metrics]]
- 5. Comparing and Interpreting the Results
  - 5.1 [[learning/5. Comparing and Interpreting the Results/5.1 Accuracy per Joule|Accuracy per Joule]]
  - 5.2 [[learning/5. Comparing and Interpreting the Results/5.2 Convergence Time and Learning Curves|Convergence Time and Learning Curves]]
  - 5.3 [[learning/5. Comparing and Interpreting the Results/5.3 Comparing SNN Training Strategies|Comparing SNN Training Strategies]]
- 6. Using Application-oriented Model Selection in Practice
  - 6.1 [[learning/6. Using Application-oriented Model Selection in Practice/6.1 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
  - 6.2 [[learning/6. Using Application-oriented Model Selection in Practice/6.2 Neuromorphic Computing and SNN Deployment|Neuromorphic Computing and SNN Deployment]]
  - 6.3 [[learning/6. Using Application-oriented Model Selection in Practice/6.3 Scalable Training and Hardware Standardization|Scalable Training and Hardware Standardization]]
  - 6.4 [[learning/6. Using Application-oriented Model Selection in Practice/6.4 Reasoning from Spikes to Deployment Choices|Reasoning from Spikes to Deployment Choices]]

## Prerequisite Chain

- Start here -> Why Spiking Neural Networks Matters
- Why Spiking Neural Networks Matters -> How Spike Event Works
- How Spike Event Works -> Describing Firing Threshold Formally
- Describing Firing Threshold Formally -> How Surrogate Gradient Is Applied
- How Surrogate Gradient Is Applied -> Comparing and Interpreting the Results
- Comparing and Interpreting the Results -> Using Application-oriented Model Selection in Practice

## Trunk, Branch, Leaf Concepts

- Trunk: Why Spiking Neural Networks Matters
  - Branch/leaf: Why Spiking Neural Networks Exist
  - Branch/leaf: Why Training Spiking Networks Are Difficult
- Trunk: How Spike Event Works
  - Branch/leaf: Spikes, Timing, and Temporal Information
  - Branch/leaf: Event-Driven Computation and Energy Efficiency
  - Branch/leaf: Membrane Potential, Input Integration, and Leakage
  - Branch/leaf: From Encoded Inputs to Competing Neurons
  - Branch/leaf: Excitation, Inhibition, and Winner Selection
- Trunk: Describing Firing Threshold Formally
  - Branch/leaf: Threshold Crossing, Spike Emission, and Reset
  - Branch/leaf: Classification Accuracy
  - Branch/leaf: Inference Latency
  - Branch/leaf: Spike Count and Energy per Inference
- Trunk: How Surrogate Gradient Is Applied
  - Branch/leaf: Surrogate-Gradient Training
  - Branch/leaf: ANN-to-SNN Conversion
  - Branch/leaf: Spike-Timing-Dependent Plasticity
  - Branch/leaf: Evaluating SNNs Across Multiple Metrics
- Trunk: Comparing and Interpreting the Results
  - Branch/leaf: Accuracy per Joule
  - Branch/leaf: Convergence Time and Learning Curves
  - Branch/leaf: Comparing SNN Training Strategies
- Trunk: Using Application-oriented Model Selection in Practice
  - Branch/leaf: Choosing an SNN Training Strategy
  - Branch/leaf: Neuromorphic Computing and SNN Deployment
  - Branch/leaf: Scalable Training and Hardware Standardization
  - Branch/leaf: Reasoning from Spikes to Deployment Choices

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- The supplied source map is compacted, so exact numerical values from result tables and graphs must be recovered from the full primary source before long-form prose is generated.
- Reported MNIST and CIFAR-10 comparisons must remain specific to the evaluated models and settings; they must not be generalized into universal ANN-versus-SNN claims.
- Formal LIF differential equations, surrogate derivative choices, ANN-to-SNN conversion procedures, and STDP update equations are deferred because they are not anchored in the supplied artifacts.
- TrueNorth and Loihi may be identified as source-named neuromorphic examples, but detailed hardware specifications or comparative benchmarks require additional sources.
- The units are intentionally not clustered into learner-facing sections; Breadboard should propose section names and ordering from this unit sequence and request confirmation before generating long-form garden content.
