"""Scale-stable geometry for pinching, finger folding and palm rotation."""
from __future__ import annotations

import math

from .models import DetectedHand


def image_points(hand: DetectedHand) -> list[tuple[float, float, float]]:
    return [(p.x * hand.image_aspect, p.y, 0.0) for p in hand.landmarks]


def subtract(a, b):
    return tuple(x - y for x, y in zip(a, b, strict=True))


def length(v):
    return math.sqrt(sum(x * x for x in v))


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b, strict=True)) / max(length(a) * length(b), 1e-9)


def world_points(hand: DetectedHand):
    if hand.world_landmarks is None:
        return None
    points = [(p.x, p.y, p.z) for p in hand.world_landmarks]
    if not all(math.isfinite(x) for point in points for x in point):
        return None
    return points if length(subtract(points[9], points[0])) > 0.01 else None


def pinch_distance(hand: DetectedHand) -> float:
    image = image_points(hand)
    if not all(math.isfinite(x) for point in image for x in point):
        return float("nan")
    # Palm length remains usable when the hand is side-on and its width collapses.
    scale = max(length(subtract(image[5], image[17])),
                0.9 * length(subtract(image[9], image[0])), 0.025)
    projected = length(subtract(image[4], image[8])) / scale
    world = world_points(hand)
    if world is None:
        return projected
    scale3 = max(length(subtract(world[5], world[17])),
                 0.9 * length(subtract(world[9], world[0])), 0.01)
    depth = length(subtract(world[4], world[8])) / scale3
    # Visible contact wins only when depth also says the fingertips are nearby;
    # crossing fingers at different depths is not a pinch.
    return min(depth, projected * 1.1) if depth < 0.65 else depth


def finger_openness(hand: DetectedHand | None) -> float | None:
    if hand is None:
        return None
    p = image_points(hand)
    if not all(math.isfinite(x) for point in p for x in point):
        return None
    palm = subtract(p[9], p[0])
    if length(palm) < 0.035:
        return None
    world = world_points(hand)
    alignment = []
    for base in (5, 9, 13, 17):
        bend = cosine(subtract(p[base + 1], p[base]), subtract(p[base + 3], p[base + 1]))
        if world is not None:
            bend = max(bend, cosine(subtract(world[base + 1], world[base]),
                                    subtract(world[base + 3], world[base + 1])))
        finger = subtract(p[base + 3], p[base])
        if bend < 0.45 or length(finger) < 0.25 * length(palm):
            return None
        alignment.append(cosine(palm, finger))
    if max(alignment) - min(alignment) > 0.75:
        return None
    return max(0.0, min(1.0, (sum(alignment) / 4 - 0.05) / 0.8))


def palm_angles(hand: DetectedHand) -> tuple[float, float] | None:
    image = image_points(hand)
    palm = subtract(image[9], image[0])
    if length(palm) < 0.035:
        return None
    roll = math.atan2(palm[0], -palm[1])
    world = world_points(hand)
    if world is None:
        # MediaPipe image z uses the same scale as image x.
        p0, p9 = hand.landmarks[0], hand.landmarks[9]
        z = (p9.z - p0.z) * hand.image_aspect
        tilt = math.atan2(z, max(length(palm), 1e-6))
    else:
        v = subtract(world[9], world[0])
        tilt = math.atan2(v[2], max(math.hypot(v[0], v[1]), 1e-6))
        across = subtract(world[17], world[5])
        yaw = math.atan2(across[2], max(math.hypot(across[0], across[1]), 1e-6))
        roll += 0.7 * yaw * (-1 if hand.handedness == "Left" else 1)
    return (roll, tilt) if all(math.isfinite(x) for x in (roll, tilt)) else None
