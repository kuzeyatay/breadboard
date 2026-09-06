"""Readiness must identify the app that actually registers subscription voice."""
import unittest
from chatmock.app import create_app


class VoiceReadinessTests(unittest.TestCase):
    def test_health_capability_matches_registered_voice_routes(self):
        app = create_app()
        client = app.test_client()
        self.assertEqual(client.get('/health').json['breadboard_subscription_voice'], 1)
        routes = {rule.rule for rule in app.url_map.iter_rules()}
        self.assertIn('/breadboard/voice/status', routes)
        self.assertIn('/breadboard/voice/sessions', routes)
        # Unauthenticated requests reach the real handler, never a missing route.
        self.assertEqual(client.get('/breadboard/voice/status').status_code, 403)


if __name__ == '__main__':
    unittest.main()
