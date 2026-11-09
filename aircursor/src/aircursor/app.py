from __future__ import annotations

import argparse
import ctypes
import time
from collections.abc import Callable
from dataclasses import replace

from .app_context import WindowsAppContext
from .breadboard_bridge import BreadboardBridge
from .config import EDITABLE_SETTINGS, AirCursorConfig
from .control_gestures import ControlResult
from .gestures import InteractionMode, PinchState, pinch_midpoint
from .input import WindowsInputController
from .interaction import FrameInputController
from .monitors import WindowsDisplays, select_monitor
from .pointer import CoordinateMapper
from .runtime_settings import control_pipeline
from .vision import MediaPipeHandDetector
from .voice_watchdog import VoiceWatchdog


def emergency_stop_pressed(voice_held: bool = False) -> bool:
    if not hasattr(ctypes, "windll"):
        return False
    key_down = ctypes.windll.user32.GetAsyncKeyState
    return bool((voice_held or key_down(0x11) & 0x8000)
                and key_down(0x12) & 0x8000 and key_down(0x1B) & 0x8000)


def pause_chord_pressed(voice_held: bool = False) -> bool:
    if not hasattr(ctypes, "windll"):
        return False
    key_down = ctypes.windll.user32.GetAsyncKeyState
    return bool((voice_held or key_down(0x11) & 0x8000)
                and key_down(0x12) & 0x8000 and key_down(0x4D) & 0x8000)


def run(config: AirCursorConfig, *, bridge: BreadboardBridge | None = None,
        show_preview: bool = True, reload_config: Callable[[], AirCursorConfig] | None = None) -> None:
    import cv2

    config.validate()
    displays = WindowsDisplays()
    target = select_monitor(displays.list(), config.monitor, config.monitor_device_id)
    native_input = WindowsInputController(target, displays)
    input_controller = FrameInputController(native_input)
    width, height = input_controller.screen_size()
    mapper = CoordinateMapper(width, height, config.margin_x, config.margin_y)
    (selector, gestures, controls, held_scroll, navigation, smoother, gain,
     stabilizer) = control_pipeline(config, input_controller, native_input)
    if bridge and hasattr(bridge, "set_settings"):
        bridge.set_settings(config)
    app_context = WindowsAppContext()
    watchdog = VoiceWatchdog(native_input)
    detector = MediaPipeHandDetector()

    capture = cv2.VideoCapture(config.camera_index, cv2.CAP_DSHOW)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, config.camera_width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, config.camera_height)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not capture.isOpened():
        detector.close()
        capture.release()
        raise RuntimeError("Camera unavailable or already in use")

    pause_key_held = False
    mouse_blocked = False
    window_title = f"AirCursor - {target.name}"
    if show_preview:
        cv2.namedWindow(window_title, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_title, 800, 600)
        cv2.moveWindow(window_title, target.left + 40, target.top + 40)
    gestures.reset()
    watchdog.start()
    print(f"Target: {target.name} | {target.device_id} | {target.size}", flush=True)

    try:
        while True:
            commands = bridge.commands() if bridge else []
            if "stop" in commands:
                break
            if "reload-settings" in commands and bridge and reload_config:
                # No old pinch, orbit, voice hold or fist countdown crosses an edit.
                controls.release_voice()
                navigation.suspend(disable=True)
                gestures.reset()
                native_input.release_all()
                if not controls.paused:
                    controls.toggle_pause()
                try:
                    loaded = reload_config()
                    updated = replace(config, **{key: getattr(loaded, key) for key in EDITABLE_SETTINGS},
                                      settings_revision=loaded.settings_revision, start_paused=True)
                    updated.validate()
                    (selector, gestures, controls, held_scroll, navigation, smoother, gain,
                     stabilizer) = control_pipeline(updated, input_controller, native_input)
                    gestures.reset()
                    config = updated
                    mouse_blocked = True
                    bridge.set_settings(config)
                except (OSError, ValueError, TypeError) as error:
                    bridge.settings_error(str(error))
            if "embed" in commands and show_preview:
                cv2.destroyWindow(window_title)
                show_preview = False
            native_input.ensure_target()
            if emergency_stop_pressed(controls.voice_held):
                break
            pause_key = pause_chord_pressed(controls.voice_held)
            if ((pause_key and not pause_key_held)
                    or ("pause" in commands and not controls.paused)):
                controls.toggle_pause()
                navigation.suspend(disable=True)
                held_scroll.reset()
                gestures.reset()
                smoother.reset()
                gain.reset()
                stabilizer.reset()
            pause_key_held = pause_key
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError("The camera stopped responding")
            if config.mirror_preview:
                frame = cv2.flip(frame, 1)

            hands = detector.process(frame)
            hand = selector.select(hands)
            now = time.monotonic()
            mode = InteractionMode.TRACKING_LOST
            # Release orbit modifiers before starting a voice chord, otherwise a
            # borrowed Shift could be released in the middle of V-to-talk.
            if controls.paused or controls.reserves(hand):
                navigation.suspend(disable=controls.paused)
            control = controls.update(hand, now)
            if controls.paused:
                navigation.suspend(disable=True)
                # Selected shortcuts can run without enabling any pointer, pinch or CAD input.
                # Keep the paused ControlResult even when the scroll detector finds no gesture.
                if config.scroll_enabled and not controls.reserves(hand) and not controls.voice_held:
                    shortcut = held_scroll.update(hand, now, paused=True)
                    if shortcut.blocks_mouse:
                        control = shortcut
                else:
                    held_scroll.reset()
            elif control.blocks_mouse:
                held_scroll.reset()
                navigation.suspend(disable=controls.paused)
            else:
                # Complete an existing click/drag release before considering another pose.
                click_pending = gestures.pinch.state is not PinchState.OPEN
                if navigation.active or not click_pending:
                    control = navigation.update(hand, now, app_context.read())
                else:
                    control = ControlResult(False, "")
                if control.blocks_mouse:
                    held_scroll.reset()
                elif config.scroll_enabled and not click_pending:
                    control = held_scroll.update(hand, now)

            if control.blocks_mouse:
                if not mouse_blocked:
                    gestures.reset()
                    smoother.reset()
                    gain.reset()
                    stabilizer.reset()
            elif hand is None:
                gestures.reset()
                smoother.reset()
                gain.reset()
                stabilizer.reset()
            else:
                result = gestures.update(hand, now)
                mode = result.mode
                if mode in {InteractionMode.POINTER, InteractionMode.PINCH, InteractionMode.DRAG}:
                    point = pinch_midpoint(hand)
                    screen_point = mapper.map(*point)
                    screen_point = smoother.filter(screen_point, now)
                    screen_point = gain.apply(screen_point)
                    screen_point = stabilizer.stabilize(
                        screen_point, mode, now, result.tap_completed
                    )
                    input_controller.move(round(screen_point[0]), round(screen_point[1]))
            mouse_blocked = control.blocks_mouse

            if hand is not None:
                for landmark in hand.landmarks:
                    cv2.circle(
                        frame,
                        (int(landmark.x * frame.shape[1]), int(landmark.y * frame.shape[0])),
                        3,
                        (100, 230, 190),
                        -1,
                    )

            left = int(config.margin_x * frame.shape[1])
            right = int((1.0 - config.margin_x) * frame.shape[1])
            top = int(config.margin_y * frame.shape[0])
            bottom = int((1.0 - config.margin_y) * frame.shape[0])
            cv2.rectangle(frame, (left, top), (right, bottom), (130, 220, 90), 2)
            detection_status = getattr(detector, "status", "") if hand is None else ""
            if show_preview:
                # Breadboard already displays this status below the image; leave its frame unobscured.
                cv2.rectangle(frame, (0, 0), (frame.shape[1], 74), (28, 32, 36), -1)
                cv2.putText(frame, control.status or mode.name, (16, 24),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1, cv2.LINE_AA)
                cv2.putText(frame, detection_status or "Custom gestures: see Breadboard settings",
                            (16, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (210, 220, 230), 1,
                            cv2.LINE_AA)
                cv2.putText(frame, "Fist / Ctrl+Alt+M: pause | Ctrl+Alt+Esc: quit",
                            (16, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (210, 220, 230), 1,
                            cv2.LINE_AA)
            if bridge:
                bridge.publish(frame, paused=controls.paused, status=control.status or mode.name,
                               detail=detection_status, display=f"{target.name} · {width} × {height}")
            if show_preview:
                cv2.imshow(window_title, frame)
            key = (cv2.waitKey(1) & 0xFF) if show_preview else -1
            if key == ord(" "):
                controls.toggle_pause()
                navigation.suspend(disable=True)
                held_scroll.reset()
                gestures.reset()
                smoother.reset()
                gain.reset()
                stabilizer.reset()
            if key in {ord("q"), 27} or (show_preview and cv2.getWindowProperty(
                    window_title, cv2.WND_PROP_VISIBLE) < 1):
                break
    finally:
        try:
            controls.release_voice()
        finally:
            try:
                gestures.reset()
                native_input.release_all()
            finally:
                try:
                    watchdog.close()
                finally:
                    detector.close()
                    capture.release()
                    cv2.destroyAllWindows()


def build_parser() -> argparse.ArgumentParser:
    from .cad_profiles import PROFILES

    parser = argparse.ArgumentParser(description="Control the Windows pointer with one hand")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index")
    parser.add_argument("--hand", choices=("Auto", "Left", "Right"), default="Auto")
    parser.add_argument("--drag-hold-ms", type=int, default=650)
    parser.add_argument("--no-scroll", action="store_true")
    parser.add_argument("--monitor", default="external", help="Display device name or external/primary")
    parser.add_argument("--monitor-id", help="Require the saved display hardware ID")
    parser.add_argument("--list-monitors", action="store_true")
    parser.add_argument("--start-paused", action="store_true", default=True,
                        help="Start paused (default); hold a fist for 3 seconds to enable control")
    parser.add_argument("--navigation-profile", choices=("auto", *PROFILES), default="auto")
    parser.add_argument("--scroll-rate", type=float, default=480.0, help="Wheel units per second")
    parser.add_argument("--invert-zoom", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.list_monitors:
        import json
        from dataclasses import asdict

        print(json.dumps([asdict(monitor) for monitor in WindowsDisplays().list()], indent=2))
        return
    run(
        AirCursorConfig(
            camera_index=args.camera,
            preferred_hand=args.hand,
            drag_hold_ms=args.drag_hold_ms,
            scroll_enabled=not args.no_scroll,
            monitor=args.monitor,
            monitor_device_id=args.monitor_id,
            start_paused=args.start_paused,
            navigation_profile=args.navigation_profile,
            scroll_rate=args.scroll_rate,
            invert_zoom=args.invert_zoom,
        )
    )


if __name__ == "__main__":
    main()

