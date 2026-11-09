"""Build fresh gesture state when the on-screen preferences change."""
from .config import AirCursorConfig
from .control_gestures import ControlGestures
from .gestures import GestureManager
from .hand_selector import HandSelector
from .held_scroll import HeldScroll
from .navigation import Navigation
from .pointer import OneEuroFilter, PointerGain, TapStabilizer
from .poses import HandPose


def control_pipeline(config: AirCursorConfig, input_controller, native_input):
    bindings = {HandPose.V_SIGN: config.v_action, HandPose.BENT_HAND: config.bent_action,
                HandPose.STRAIGHT_HAND: config.straight_action}
    paused_poses = tuple(pose for pose, enabled in (
        (HandPose.V_SIGN, config.v_while_paused), (HandPose.BENT_HAND, config.bent_while_paused),
        (HandPose.STRAIGHT_HAND, config.straight_while_paused)) if enabled)
    pinch_exclusion = config.pinch_threshold + 0.14
    min_cutoff, beta = config.min_cutoff, config.beta
    if config.smoothing is not None:
        min_cutoff = 2.25 - 0.02 * config.smoothing
        beta = 0.033 - 0.0003 * config.smoothing
    return (
        HandSelector(config.preferred_hand),
        GestureManager(input_controller, config.drag_hold_ms, scrolling=False,
                       pinch_threshold=config.pinch_threshold, click_action=config.pinch_action),
        ControlGestures(native_input, paused=config.start_paused,
                        voice_confirm=config.gesture_confirm_ms / 1000,
                        fist_hold=config.fist_pause_hold_ms / 1000,
                        fist_start_hold=config.fist_start_hold_ms / 1000,
                        voice_poses=tuple(pose for pose, action in bindings.items() if action == "voice"),
                        paused_voice_poses=tuple(pose for pose in paused_poses if bindings[pose] == "voice"),
                        pinch_exclusion=pinch_exclusion),
        HeldScroll(native_input, config.scroll_rate, config.gesture_confirm_ms / 1000,
                   bindings={pose: 1 if action == "scroll_up" else -1
                             for pose, action in bindings.items() if action.startswith("scroll_")},
                   pinch_exclusion=pinch_exclusion, paused_poses=paused_poses),
        Navigation(native_input, config.navigation_profile, config.orbit_gain,
                   config.zoom_gain, config.invert_zoom, config.cad_rotate, config.cad_zoom),
        OneEuroFilter(min_cutoff, beta, config.derivative_cutoff),
        PointerGain(config.pointer_gain, bounds=input_controller.screen_size(),
                    anchor=native_input.cursor_position_local),
        TapStabilizer(native_input.double_click_time()),
    )
