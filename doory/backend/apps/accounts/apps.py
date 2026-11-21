from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    label = "accounts"

    def ready(self) -> None:
        from apps.core.storage import delete_files_on_delete

        from . import checks  # noqa: F401
        from .models import User

        delete_files_on_delete(User, "avatar")
