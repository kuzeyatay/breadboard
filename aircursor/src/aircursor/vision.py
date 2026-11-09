from __future__ import annotations

import time

from .detection_filter import FaceRegion, HandDetectionFilter
from .models import DetectedHand, Point


class MediaPipeHandDetector:
    """Small adapter that keeps MediaPipe outside the reusable gesture layer."""

    def __init__(self, max_num_hands: int = 2) -> None:
        try:
            from mediapipe.python.solutions import face_detection as mp_faces
            from mediapipe.python.solutions import hands as mp_hands
        except ImportError as error:
            raise RuntimeError("Install AirCursor dependencies before using the camera") from error
        self._hands = mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=max_num_hands,
            model_complexity=1,
            # Preserve sensitivity for side-on hands. The face/continuity filter
            # rejects false positives before any controller sees the landmarks.
            min_detection_confidence=0.65,
            min_tracking_confidence=0.60,
        )
        try:
            self._faces = mp_faces.FaceDetection(model_selection=0, min_detection_confidence=0.60)
        except Exception:
            self._hands.close()
            raise
        self._filter = HandDetectionFilter()
        self._last_reset = -float("inf")
        self.status = ""

    def process(self, frame_bgr: object) -> list[DetectedHand]:
        import cv2

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        face_result = self._faces.process(rgb)
        faces = []
        for face in face_result.detections or []:
            box = face.location_data.relative_bounding_box
            faces.append(FaceRegion(box.xmin, box.ymin, box.xmin + box.width, box.ymin + box.height))
        result = self._hands.process(rgb)
        detected: list[DetectedHand] = []
        world_hands = result.multi_hand_world_landmarks or []
        for index, (landmarks, handedness) in enumerate(zip(
            result.multi_hand_landmarks or [],
            result.multi_handedness or [],
            strict=True,
        )):
            classification = handedness.classification[0]
            detected.append(
                DetectedHand(
                    landmarks=tuple(
                        Point(point.x, point.y, point.z) for point in landmarks.landmark
                    ),
                    handedness=classification.label,
                    confidence=float(classification.score),
                    world_landmarks=(tuple(Point(p.x, p.y, p.z)
                                           for p in world_hands[index].landmark)
                                     if index < len(world_hands) else None),
                    image_aspect=frame_bgr.shape[1] / frame_bgr.shape[0],
                )
            )
        now = time.monotonic()
        accepted = self._filter.update(detected, faces, now)
        self.status = self._filter.status
        if (self._filter.face_rejected and not self._filter.candidate_count
                and now - self._last_reset >= 0.5):
            # Drop a tracked face ROI and make the palm model search afresh.
            self._hands.reset()
            self._last_reset = now
        return accepted

    def close(self) -> None:
        try:
            self._hands.close()
        finally:
            self._faces.close()

