from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from test_control_gestures import FIST, OPEN, V, pose_hand
from test_scroll_navigation import BENT

from aircursor.control_gestures import ControlGestures
from aircursor.detection_filter import FaceRegion, HandDetectionFilter
from aircursor.models import Point

FACE = FaceRegion(0.25, 0.20, 0.75, 0.95)
ADJACENT_FACE = FaceRegion(0.05, 0.10, 0.40, 0.78)


@pytest.mark.parametrize("hand", [OPEN, FIST, V, BENT, pose_hand((5,))])
def test_face_landmarks_never_reach_gestures_even_with_high_handedness_confidence(hand):
    guard = HandDetectionFilter()
    voice = SimpleNamespace(voice_down=Mock(), voice_up=Mock())
    controls = ControlGestures(voice, paused=True)
    for frame in range(121):
        now = frame / 30
        accepted = guard.update([hand], [FACE], now)
        assert not accepted and guard.face_rejected == 1
        controls.update(None, now)
        assert controls.paused  # A face held for >3s cannot start control.
    voice.voice_down.assert_not_called()


@pytest.mark.parametrize("hand", [OPEN, FIST, V, BENT, pose_hand((5,))])
def test_real_gestures_beside_the_face_survive_after_confirmation(hand):
    guard = HandDetectionFilter()
    for now in (0, 0.04, 0.08):
        assert not guard.update([hand], [ADJACENT_FACE], now)
    accepted = guard.update([hand], [ADJACENT_FACE], 0.12)
    assert len(accepted) == 1 and accepted[0].landmarks == hand.landmarks
    assert accepted[0].tracking_id and not guard.face_rejected


def test_a_confirmed_hand_cannot_turn_into_a_tracked_face():
    guard = HandDetectionFilter()
    for frame in range(5):
        accepted = guard.update([OPEN], [], frame * 0.04)
    assert accepted
    assert not guard.update([OPEN], [FACE], 0.20)
    # Brief face-detector misses must not immediately admit the false hand.
    for now in (0.24, 0.28, 0.40, 0.56):
        assert not guard.update([OPEN], [], now)
    assert not guard.update([OPEN], [], 0.64)  # Reacquisition still needs confirmation.
    for now in (0.68, 0.72, 0.80):
        accepted = guard.update([OPEN], [], now)
    assert accepted  # An old face region cannot block this area forever.


def shifted(hand, amount):
    return replace(hand, landmarks=tuple(replace(p, x=p.x + amount) for p in hand.landmarks))


def test_tracking_jump_or_camera_stall_requires_reconfirmation():
    guard = HandDetectionFilter()
    for frame in range(5):
        accepted = guard.update([OPEN], [], frame * 0.04)
    original_id = accepted[0].tracking_id
    moved = shifted(OPEN, 0.3)
    assert not guard.update([moved], [], 0.20)
    for now in (0.24, 0.28, 0.36):
        accepted = guard.update([moved], [], now)
    assert accepted and accepted[0].tracking_id != original_id
    assert not guard.update([moved], [], 1.0)


def test_brief_tracking_loss_publishes_no_stale_hand_and_preserves_confirmed_identity():
    guard = HandDetectionFilter()
    for frame in range(5):
        accepted = guard.update([OPEN], [], frame * 0.04)
    identifier = accepted[0].tracking_id
    assert not guard.update([], [], 0.20)
    assert guard.update([OPEN], [], 0.24)[0].tracking_id == identifier


def test_intermittent_candidates_and_duplicate_detections_cannot_skip_confirmation():
    guard = HandDetectionFilter()
    for frame in range(20):
        hands = [OPEN, OPEN] if frame % 2 == 0 else []
        assert not guard.update(hands, [], frame * 0.04)


def test_duplicate_landmarks_do_not_steal_a_confirmed_hand_or_create_two_controls():
    guard = HandDetectionFilter()
    for frame in range(5):
        accepted = guard.update([OPEN], [], frame * 0.04)
    identifier = accepted[0].tracking_id
    duplicate = replace(OPEN, landmarks=tuple(replace(p, y=p.y + 0.04) for p in OPEN.landmarks))
    for frame in range(5, 35):
        hands = [OPEN, duplicate] if frame % 2 else [duplicate, OPEN]
        accepted = guard.update(hands, [], frame * 0.04)
        assert len(accepted) == 1 and accepted[0].tracking_id == identifier


def test_two_hands_have_independent_confirmation_and_one_face_does_not_hide_the_other():
    guard = HandDetectionFilter()
    small = pose_hand((5,), scale=0.4)
    left, right = shifted(small, -0.28), shifted(small, 0.28)
    face = FaceRegion(0.1, 0.35, 0.4, 0.8)
    for frame in range(5):
        accepted = guard.update([left, right], [face], frame * 0.04)
    assert guard.face_rejected == 1
    assert len(accepted) == 1 and accepted[0].landmarks == right.landmarks


@pytest.mark.parametrize("bad", [
    replace(OPEN, landmarks=(Point(float("nan"), 0),) + OPEN.landmarks[1:]),
    replace(OPEN, landmarks=(Point(0.5, 0.5),) * 21),
    replace(OPEN, image_aspect=float("inf")),
    replace(OPEN, world_landmarks=(Point(0, 0, float("nan")),) * 21),
])
def test_invalid_or_collapsed_skeletons_are_rejected(bad):
    guard = HandDetectionFilter()
    for frame in range(10):
        assert not guard.update([bad], [], frame * 0.04)


def test_camera_adapter_filters_faces_resets_the_false_track_and_closes_both_models(monkeypatch):
    from mediapipe.python.solutions import face_detection as mp_faces
    from mediapipe.python.solutions import hands as mp_hands

    from aircursor import vision

    raw_hand = SimpleNamespace(landmark=OPEN.landmarks)
    result = SimpleNamespace(multi_hand_landmarks=[raw_hand], multi_hand_world_landmarks=[],
                             multi_handedness=[SimpleNamespace(classification=[
                                 SimpleNamespace(label="Right", score=0.99)])])
    hands = SimpleNamespace(process=Mock(return_value=result), reset=Mock(), close=Mock())
    box = SimpleNamespace(xmin=FACE.left, ymin=FACE.top, width=FACE.right - FACE.left,
                          height=FACE.bottom - FACE.top)
    face_result = SimpleNamespace(detections=[SimpleNamespace(
        location_data=SimpleNamespace(relative_bounding_box=box))])
    faces = SimpleNamespace(process=Mock(return_value=face_result), close=Mock())
    hand_factory, face_factory = Mock(return_value=hands), Mock(return_value=faces)
    monkeypatch.setattr(mp_hands, "Hands", hand_factory)
    monkeypatch.setattr(mp_faces, "FaceDetection", face_factory)
    now = [0.0]
    monkeypatch.setattr(vision.time, "monotonic", lambda: now[0])
    detector = vision.MediaPipeHandDetector()
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    try:
        for index in range(10):
            now[0] = index * 0.04
            assert not detector.process(frame)
        assert "Face ignored" in detector.status
        hands.reset.assert_called_once()  # Reset is throttled, not done every frame.
        assert hand_factory.call_args.kwargs["min_tracking_confidence"] == 0.60
        face_result.detections = []
        for index in range(10, 30):
            now[0] = index * 0.04
            accepted = detector.process(frame)
        assert accepted and accepted[0].image_aspect == 640 / 480
    finally:
        detector.close()
    hands.close.assert_called_once()
    faces.close.assert_called_once()
