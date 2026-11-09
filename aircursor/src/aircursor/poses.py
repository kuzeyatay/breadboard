"""Rotation-independent poses shared by voice, pause and scrolling."""
from __future__ import annotations

import math
from enum import Enum, auto

from .hand_geometry import finger_openness, pinch_distance
from .models import DetectedHand, Point


class HandPose(Enum):
    NEUTRAL = auto()
    V_SIGN = auto()
    FIST = auto()
    SCROLL = auto()
    BENT_HAND = auto()
    STRAIGHT_HAND = auto()


def distance(a: Point, b: Point) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def finger_state(hand: DetectedHand, mcp: int) -> str:
    wrist = hand.wrist
    base, pip, dip, tip = hand.landmarks[mcp:mcp + 4]
    palm = max(distance(wrist, hand.landmarks[9]),
               distance(hand.landmarks[5], hand.landmarks[17]), 1e-6)
    a, b = (pip.x - base.x, pip.y - base.y), (tip.x - pip.x, tip.y - pip.y)
    cosine = (a[0] * b[0] + a[1] * b[1]) / max(math.hypot(*a) * math.hypot(*b), 1e-6)
    reach = distance(tip, wrist) - distance(pip, wrist)
    if cosine > 0.45 and reach > 0.12 * palm:
        return "extended"
    chain = distance(base, pip) + distance(pip, dip) + distance(dip, tip)
    if reach < 0.03 * palm and distance(base, tip) < 0.80 * max(chain, 1e-6):
        return "curled"
    return "unknown"


def classify_pose(hand: DetectedHand | None, pinch_exclusion: float = 0.46) -> HandPose:
    if hand is None or not all(math.isfinite(p.x) and math.isfinite(p.y)
                               for p in hand.landmarks):
        return HandPose.NEUTRAL
    palm = max(distance(hand.wrist, hand.landmarks[9]),
               distance(hand.landmarks[5], hand.landmarks[17]))
    if palm < 0.035:
        return HandPose.NEUTRAL
    index, middle, ring, little = (finger_state(hand, mcp) for mcp in (5, 9, 13, 17))
    # A tucked/relaxed thumb is fine; an extended thumbs-up is not a fist.
    if (all(state == "curled" for state in (index, middle, ring, little))
            and distance(hand.thumb_tip, hand.landmarks[9]) < palm):
        return HandPose.FIST
    # A thumb/index pinch keeps its existing click meaning.
    if pinch_distance(hand) < pinch_exclusion:
        return HandPose.NEUTRAL
    if index == middle == "extended" and little == "curled":
        if ring == "curled":
            return HandPose.V_SIGN
        if ring == "extended":
            return HandPose.SCROLL
    return HandPose.NEUTRAL


def custom_pose(hand: DetectedHand | None, previous=HandPose.NEUTRAL,
                pinch_exclusion: float = 0.46) -> HandPose:
    pose = classify_pose(hand, pinch_exclusion)
    if pose is not HandPose.NEUTRAL or hand is None:
        return pose
    if pinch_distance(hand) < pinch_exclusion:
        return HandPose.NEUTRAL
    openness = finger_openness(hand)
    if openness is not None:
        if openness <= (0.45 if previous is HandPose.BENT_HAND else 0.35):
            return HandPose.BENT_HAND
        if openness >= (0.75 if previous is HandPose.STRAIGHT_HAND else 0.85):
            return HandPose.STRAIGHT_HAND
    return HandPose.NEUTRAL
