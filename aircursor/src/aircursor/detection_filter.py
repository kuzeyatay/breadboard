"""Reject face-shaped false positives before they reach any control gesture."""
from __future__ import annotations

import math
from dataclasses import dataclass, replace

from .models import DetectedHand, Point

PALM = (0, 1, 5, 9, 13, 17)


@dataclass(frozen=True, slots=True)
class FaceRegion:
    left: float
    top: float
    right: float
    bottom: float

    @property
    def valid(self) -> bool:
        return (all(math.isfinite(v) for v in (self.left, self.top, self.right, self.bottom))
                and self.right > self.left and self.bottom > self.top)

    def contains(self, point: Point) -> bool:
        pad_x = (self.right - self.left) * 0.04
        pad_y = (self.bottom - self.top) * 0.04
        return (self.left - pad_x <= point.x <= self.right + pad_x
                and self.top - pad_y <= point.y <= self.bottom + pad_y)

    def covers_hand(self, hand: DetectedHand) -> bool:
        # A fingertip beside/over the cheek is fine. A supposed hand whose palm
        # and most landmarks cover the face must not move, click, talk or arm.
        return (sum(self.contains(hand.landmarks[i]) for i in PALM) >= 3
                and sum(self.contains(p) for p in hand.landmarks) >= 13)


def palm_size(hand: DetectedHand) -> float:
    def distance(a, b):
        return math.hypot((a.x - b.x) * hand.image_aspect, a.y - b.y)
    return max(distance(hand.wrist, hand.landmarks[9]),
               distance(hand.landmarks[5], hand.landmarks[17]))


def plausible(hand: DetectedHand) -> bool:
    if not math.isfinite(hand.image_aspect) or not 0.1 <= hand.image_aspect <= 10:
        return False
    points = hand.landmarks + (hand.world_landmarks or ())
    if not all(math.isfinite(value) for point in points for value in (point.x, point.y, point.z)):
        return False
    if not all(-0.1 <= hand.landmarks[i].x <= 1.1 and -0.1 <= hand.landmarks[i].y <= 1.1
               for i in PALM):
        return False
    return 0.035 <= palm_size(hand) <= 1.5


@dataclass(slots=True)
class _Track:
    hand: DetectedHand
    since: float
    last: float
    frames: int
    identifier: str
    confirmed: bool = False


class HandDetectionFilter:
    def __init__(self, confirm_seconds=0.12, grace_seconds=0.15, face_grace=0.40):
        self.confirm_seconds = confirm_seconds
        self.grace_seconds = grace_seconds
        self.face_grace = face_grace
        self._faces: list[FaceRegion] = []
        self._last_face = -math.inf
        self._last_frame: float | None = None
        self._tracks: list[_Track] = []
        self._identifier = 0
        self.face_rejected = 0
        self.candidate_count = 0
        self.status = ""

    def update(self, hands: list[DetectedHand], faces: list[FaceRegion],
               now: float) -> list[DetectedHand]:
        previous_time = self._last_frame
        if self._last_frame is not None and not 0 < now - self._last_frame <= 0.25:
            self._tracks.clear()
            self._faces.clear()
        self._last_frame = now
        valid_faces = [face for face in faces if face.valid]
        if valid_faces:
            self._faces, self._last_face = valid_faces, now
        elif now - self._last_face > self.face_grace:
            self._faces = []

        available = [track for track in self._tracks if now - track.last <= self.grace_seconds]
        current: list[_Track] = []
        accepted: list[DetectedHand] = []
        self.face_rejected = self.candidate_count = 0
        for hand in hands:
            if not plausible(hand):
                continue
            if any(face.covers_hand(hand) for face in self._faces):
                self.face_rejected += 1
                continue

            def distance(track, candidate=hand):
                return math.hypot((track.hand.wrist.x - candidate.wrist.x) * candidate.image_aspect,
                                  track.hand.wrist.y - candidate.wrist.y)

            scale = palm_size(hand)
            # MediaPipe can report the same side-on hand twice. Do not let a
            # duplicate acquire a new identity and steal a confirmed track.
            duplicate = False
            for track in current:
                tolerance = 0.4 * min(scale, palm_size(track.hand))
                palm_distance = sum(math.hypot(
                    (track.hand.landmarks[i].x - hand.landmarks[i].x) * hand.image_aspect,
                    track.hand.landmarks[i].y - hand.landmarks[i].y) for i in PALM) / len(PALM)
                if distance(track) <= tolerance and palm_distance <= tolerance:
                    duplicate = True
                    break
            if duplicate:
                continue
            self.candidate_count += 1
            nearby = [track for track in available
                      if distance(track) <= max(0.06, min(0.20, scale * 0.75))
                      and 0.5 <= scale / palm_size(track.hand) <= 2.0]
            if nearby:
                track = min(nearby, key=lambda item: (not item.confirmed, distance(item)))
                available.remove(track)
                # An unconfirmed candidate needs consecutive observations.
                if not track.confirmed and track.last != previous_time:
                    track.since, track.frames = now, 0
                track.hand, track.last = hand, now
                track.frames += 1
            else:
                self._identifier += 1
                track = _Track(hand, now, now, 1, f"hand-{self._identifier}")
            if track.frames >= 3 and now - track.since >= self.confirm_seconds:
                track.confirmed = True
            current.append(track)
            if track.confirmed:
                accepted.append(replace(hand, tracking_id=track.identifier))
        # A brief miss preserves identity but never publishes stale landmarks.
        self._tracks = current + [track for track in available if track.confirmed]
        self.status = ""
        if not accepted:
            if self.face_rejected:
                self.status = "Face ignored - keep your hand beside your face"
            elif self.candidate_count:
                self.status = "Confirming hand..."
        return accepted
