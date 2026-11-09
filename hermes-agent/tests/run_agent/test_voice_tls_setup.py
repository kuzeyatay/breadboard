"""Trust setup is reusable; live request transports and custom TLS remain independent."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shutil
import ssl
import threading
from unittest.mock import patch

import certifi
import httpx
import pytest

from agent.process_bootstrap import build_keepalive_http_client
from run_agent import AIAgent


@pytest.fixture(autouse=True)
def isolated_trust(monkeypatch, tmp_path):
    for name in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy',
                 'https_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
                 'HERMES_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'):
        monkeypatch.delenv(name, raising=False)
    bundle = tmp_path / 'trusted.pem'
    shutil.copyfile(certifi.where(), bundle)
    monkeypatch.setattr(certifi, 'where', lambda: str(bundle))
    yield bundle


@pytest.mark.parametrize('builder', [AIAgent._build_keepalive_http_client, build_keepalive_http_client])
def test_trust_store_loaded_once_across_separate_request_clients(builder):
    with patch('ssl.create_default_context', wraps=ssl.create_default_context) as load:
        first = builder('http://127.0.0.1:9/v1')
        second = builder('http://127.0.0.1:9/v1')
        try:
            assert isinstance(first, httpx.Client) and isinstance(second, httpx.Client)
            assert load.call_count == 1, 'repeated model requests must not reload CA files for each mount'
            trust = first._transport._pool._ssl_context
            assert trust.verify_mode == ssl.CERT_REQUIRED and trust.check_hostname
            assert second._transport._pool._ssl_context is trust
            assert first._transport is not second._transport
            assert first._transport._pool is not second._transport._pool
            first.close()
            assert not second.is_closed, 'closing an interrupted request cannot close its successor'
        finally:
            first.close()
            second.close()


def test_parallel_requests_load_trust_once():
    barrier = threading.Barrier(4)
    def construct(_):
        barrier.wait(timeout=10)
        return AIAgent._build_keepalive_http_client('http://127.0.0.1:9/v1')
    with patch('ssl.create_default_context', wraps=ssl.create_default_context) as load:
        with ThreadPoolExecutor(max_workers=4) as pool:
            clients = list(pool.map(construct, range(4)))
        try:
            assert all(isinstance(client, httpx.Client) for client in clients)
            assert load.call_count == 1
            assert len({id(client._transport._pool) for client in clients}) == 4
        finally:
            for client in clients:
                client.close()


def test_ca_file_rotation_refreshes_trust(isolated_trust):
    first = AIAgent._build_keepalive_http_client('https://example.test/v1')
    with isolated_trust.open('a') as bundle:
        bundle.write('\n')
    second = AIAgent._build_keepalive_http_client('https://example.test/v1')
    try:
        assert first._transport._pool._ssl_context is not second._transport._pool._ssl_context
        assert second._transport._pool._ssl_context.verify_mode == ssl.CERT_REQUIRED
    finally:
        first.close()
        second.close()


def test_environment_ca_file_and_directory_are_honored(monkeypatch, tmp_path, isolated_trust):
    alternate = tmp_path / 'alternate.pem'
    shutil.copyfile(isolated_trust, alternate)
    monkeypatch.setenv('SSL_CERT_FILE', str(alternate))
    with patch('ssl.create_default_context', wraps=ssl.create_default_context) as load:
        client = build_keepalive_http_client('https://example.test/v1')
        try:
            assert client is not None
            assert all(call.kwargs.get('cafile') == str(alternate) for call in load.call_args_list)
        finally:
            client.close()
    monkeypatch.delenv('SSL_CERT_FILE')
    directory = tmp_path / 'trust'
    directory.mkdir()
    monkeypatch.setenv('SSL_CERT_DIR', str(directory))
    with patch('ssl.create_default_context', wraps=ssl.create_default_context) as load:
        client = build_keepalive_http_client('https://example.test/v1')
        try:
            assert client is not None
            assert all(call.kwargs.get('capath') == str(directory) for call in load.call_args_list)
        finally:
            client.close()


@pytest.mark.parametrize('builder', [AIAgent._build_keepalive_http_client, build_keepalive_http_client])
def test_caller_tls_configuration_is_preserved(builder):
    custom = ssl.create_default_context(cafile=certifi.where())
    client = builder('https://example.test/v1', verify=custom)
    insecure = builder('http://127.0.0.1:9/v1', verify=False)
    try:
        assert client._transport._pool._ssl_context is custom
        assert custom.verify_mode == ssl.CERT_REQUIRED and custom.check_hostname
        assert insecure._transport._pool._ssl_context.verify_mode == ssl.CERT_NONE
    finally:
        client.close()
        insecure.close()


def test_removed_ca_file_is_not_served_from_stale_cache(isolated_trust):
    client = AIAgent._build_keepalive_http_client('https://example.test/v1')
    client.close()
    isolated_trust.unlink()
    assert AIAgent._build_keepalive_http_client('https://example.test/v1') is None
