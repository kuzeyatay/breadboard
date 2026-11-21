"""Doory's URLs plus the two loopback hooks Breadboard uses (sign-in for the framed editor, image import)."""

import hmac
import os

from django.contrib.auth import login
from django.http import HttpResponseForbidden, HttpResponseRedirect, JsonResponse
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from doory.urls import handler404, handler500, urlpatterns as doory_urls  # noqa: F401

from apps.assets.services import create_asset
from apps.designs import services as designs
from apps.designs.doc.ops import Operation
from apps.designs.edits import apply_edit
from apps.designs.validators import MAX_DIMENSION
from apps.mcp.resolver import DjangoResolver
from pydantic import TypeAdapter

OPERATIONS = TypeAdapter(list[Operation])


def _allowed(request) -> bool:
    ticket = request.GET.get("ticket") or request.headers.get("X-Breadboard-Ticket") or ""
    return hmac.compare_digest(ticket, os.environ["BREADBOARD_DOORY_TICKET"])


def _user():
    from serve import bread_user

    return bread_user()


def sign_in(request):
    """The Design page frames /__breadboard/open?ticket=…&next=/design/<id>: sign in, then go there."""
    if not _allowed(request):
        return HttpResponseForbidden("Unknown ticket.")
    login(request, _user(), backend="apps.accounts.backends.GuardedModelBackend")
    target = request.GET.get("next") or "/"
    return HttpResponseRedirect(target if target.startswith("/") and not target.startswith("//") else "/")


@csrf_exempt
def import_image(request):
    """POST raw image bytes (?title=…): a new design the size of the picture with the picture on it."""
    if request.method != "POST" or not _allowed(request):
        return HttpResponseForbidden("Unknown ticket.")
    user = _user()
    title = (request.GET.get("title") or "Image")[:200]
    asset = create_asset(user, request.body, name=title[:120])
    scale = min(1.0, MAX_DIMENSION / max(asset.width or 1, asset.height or 1))
    width, height = max(1, round((asset.width or 1080) * scale)), max(1, round((asset.height or 1080) * scale))
    design = designs.create_design(user, title=title, document=designs.blank_document(width, height))
    ops = [{"op": "add_image", "asset_id": str(asset.pk), "x": 0, "y": 0, "width": width, "height": height}]
    apply_edit(design.pk, user, OPERATIONS.validate_python(ops), resolver=DjangoResolver(user),
               label="Imported from Breadboard")
    return JsonResponse({"design_id": str(design.pk), "width": width, "height": height})


urlpatterns = [
    path("__breadboard/open", sign_in),
    path("__breadboard/import", import_image),
    *doory_urls,
]
