from django.apps import AppConfig


class ExportsConfig(AppConfig):
    name = "apps.exports"
    label = "exports"

    def ready(self) -> None:
        from . import checks  # noqa: F401
