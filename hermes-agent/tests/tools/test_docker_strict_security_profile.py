"""Behavior contracts for the keyless Docker strict security profile."""

import subprocess

import pytest

from hermes_cli import config as config_mod
from tools.environments import docker as docker_env


def _strict_environment(monkeypatch, tmp_path, **overrides):
    """Construct strict Docker with its process boundary fully mocked."""
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        command = list(cmd)
        calls.append(command)
        if command[1:3] == ["image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, stdout="null\n", stderr="")
        if command[1:3] == ["run", "-d"]:
            return subprocess.CompletedProcess(
                command, 0, stdout="strict-container-id\n", stderr=""
            )
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(docker_env, "find_docker", lambda: "/usr/bin/docker")
    monkeypatch.setattr(docker_env.subprocess, "run", fake_run)
    monkeypatch.setattr(docker_env.DockerEnvironment, "init_session", lambda self: None)
    monkeypatch.setattr(docker_env, "_resolve_host_user_spec", lambda: "1000:1000")
    monkeypatch.setattr(docker_env, "_cgroup_limits_ok", True)

    project = tmp_path / "project"
    project.mkdir()
    params = {
        "image": "python:3.11",
        "cwd": "/root",
        "timeout": 900,
        "cpu": 16,
        "memory": 32768,
        "disk": 99999,
        "persistent_filesystem": True,
        "task_id": "strict-test",
        "volumes": [
            f"{tmp_path}:/host",
            "/var/run/docker.sock:/workspace/docker.sock",
        ],
        "forward_env": ["DATABASE_URL"],
        "env": {"PRIVATE_TOKEN": "must-not-cross-boundary"},
        "network": True,
        "host_cwd": str(project),
        "auto_mount_cwd": True,
        "extra_args": ["--privileged", "--network=host"],
        "persist_across_processes": True,
        "security_profile": "strict",
    }
    params.update(overrides)

    env = docker_env.DockerEnvironment(**params)
    run_command = next(command for command in calls if command[1:3] == ["run", "-d"])
    return env, run_command, project


def _option_value(command: list[str], option: str) -> str:
    return command[command.index(option) + 1]


def test_strict_user_never_inherits_root(monkeypatch):
    monkeypatch.setattr(docker_env, "_resolve_host_user_spec", lambda: "0:0")

    assert docker_env._strict_user_spec() == docker_env._STRICT_FALLBACK_USER
    assert not docker_env._strict_user_spec().startswith("0:")


def test_strict_profile_builds_a_non_root_airgapped_bounded_container(
    monkeypatch, tmp_path
):
    env, command, project = _strict_environment(monkeypatch, tmp_path)

    assert env.cwd == "/workspace"
    assert env.timeout == docker_env._STRICT_MAX_COMMAND_TIMEOUT
    assert env._persistent is False
    assert env._persist_across_processes is False

    assert _option_value(command, "--user") == "1000:1000"
    assert "--read-only" in command
    assert "--network=none" in command
    assert _option_value(command, "--cap-drop") == "ALL"
    assert "--cap-add" not in command
    assert _option_value(command, "--security-opt") == "no-new-privileges"
    assert float(_option_value(command, "--cpus")) <= docker_env._STRICT_MAX_CPU
    memory = _option_value(command, "--memory")
    assert memory.endswith("m")
    assert int(memory[:-1]) <= docker_env._STRICT_MAX_MEMORY_MB
    assert _option_value(command, "--memory-swap") == memory
    assert _option_value(command, "--pids-limit") == docker_env._STRICT_PIDS_LIMIT

    # The explicitly selected project is the only host mount. Arbitrary
    # docker_volumes, the Docker socket, and automatic credential/cache mounts
    # do not cross the boundary.
    mounts = [command[index + 1] for index, item in enumerate(command) if item == "-v"]
    assert mounts == [f"{project}:/workspace"]
    assert not any("docker.sock" in item for item in command)

    # Arbitrary run flags and caller-provided environment values cannot undo
    # the profile. Only a fixed non-secret process identity is injected.
    assert "--privileged" not in command
    assert "--network=host" not in command
    env_values = [command[index + 1] for index, item in enumerate(command) if item == "-e"]
    assert set(env_values) == {
        "HOME=/home/sandbox",
        "LOGNAME=sandbox",
        "USER=sandbox",
    }
    assert not any("PRIVATE_TOKEN" in item or "DATABASE_URL" in item for item in command)
    assert "hermes-security-profile=strict" in command


def test_strict_profile_does_not_query_automatic_host_mounts(monkeypatch, tmp_path):
    from tools import credential_files

    def fail_if_called():
        pytest.fail("strict profile must not discover host credentials, caches, or skills")

    monkeypatch.setattr(credential_files, "get_credential_file_mounts", fail_if_called)
    monkeypatch.setattr(credential_files, "get_cache_directory_mounts", fail_if_called)
    monkeypatch.setattr(credential_files, "get_skills_directory_mount", fail_if_called)

    _strict_environment(monkeypatch, tmp_path)


def test_strict_profile_blocks_implicit_passthrough(monkeypatch, tmp_path):
    env, _command, _project = _strict_environment(monkeypatch, tmp_path)

    monkeypatch.setattr(
        "tools.env_passthrough.get_all_passthrough",
        lambda: {"DATABASE_URL", "GITHUB_TOKEN"},
    )
    monkeypatch.setenv("DATABASE_URL", "must-not-cross-boundary")
    monkeypatch.setenv("GITHUB_TOKEN", "must-not-cross-boundary")

    assert env._build_init_env_args() == [
        "-e",
        "HOME=/home/sandbox",
        "-e",
        "LOGNAME=sandbox",
        "-e",
        "USER=sandbox",
    ]


def test_strict_profile_clamps_per_command_timeout(monkeypatch):
    env = docker_env.DockerEnvironment.__new__(docker_env.DockerEnvironment)
    env._max_command_timeout = docker_env._STRICT_MAX_COMMAND_TIMEOUT
    env._persist_across_processes = False
    captured = {}

    def fake_execute(self, command, cwd="", **kwargs):
        captured.update(kwargs)
        return {"output": "ok", "returncode": 0}

    monkeypatch.setattr(docker_env.BaseEnvironment, "execute", fake_execute)

    result = env.execute("sleep forever", timeout=3600)

    assert result["returncode"] == 0
    assert captured["timeout"] == docker_env._STRICT_MAX_COMMAND_TIMEOUT


def test_timed_out_strict_command_removes_the_whole_container(monkeypatch):
    env = docker_env.DockerEnvironment.__new__(docker_env.DockerEnvironment)
    env._security_profile = "strict"
    env._strict_timeout_poisoned = False
    env._max_command_timeout = docker_env._STRICT_MAX_COMMAND_TIMEOUT
    env._persist_across_processes = False
    env._container_id = "strict-container-id"
    env._docker_exe = "/usr/bin/docker"
    commands = []

    monkeypatch.setattr(
        docker_env.BaseEnvironment,
        "execute",
        lambda self, command, cwd="", **kwargs: {
            "output": "timed out",
            "returncode": 124,
        },
    )

    def fake_run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(docker_env.subprocess, "run", fake_run)

    result = env.execute("unbounded work")

    assert result["returncode"] == 124
    assert commands == [["/usr/bin/docker", "rm", "-f", "strict-container-id"]]
    assert env._container_id is None
    assert env._strict_timeout_poisoned is False


def test_failed_timeout_cleanup_poisoning_blocks_more_execution(monkeypatch):
    env = docker_env.DockerEnvironment.__new__(docker_env.DockerEnvironment)
    env._security_profile = "strict"
    env._strict_timeout_poisoned = False
    env._max_command_timeout = docker_env._STRICT_MAX_COMMAND_TIMEOUT
    env._persist_across_processes = False
    env._container_id = "strict-container-id"
    env._docker_exe = "/usr/bin/docker"
    executions = []

    def fake_execute(self, command, cwd="", **kwargs):
        executions.append(command)
        return {"output": "timed out", "returncode": 124}

    monkeypatch.setattr(docker_env.BaseEnvironment, "execute", fake_execute)
    monkeypatch.setattr(
        docker_env.subprocess,
        "run",
        lambda command, **kwargs: subprocess.CompletedProcess(
            command, 1, stdout="", stderr="daemon unavailable"
        ),
    )

    assert env.execute("first")["returncode"] == 124
    blocked = env.execute("must not run")

    assert executions == ["first"]
    assert blocked["returncode"] == 125
    assert "could not be removed" in blocked["output"]
    assert env._container_id == "strict-container-id"
    assert env._strict_timeout_poisoned is True


def test_strict_profile_fails_closed_when_resource_limits_are_unavailable(
    monkeypatch
):
    monkeypatch.setattr(docker_env, "find_docker", lambda: "/usr/bin/docker")
    monkeypatch.setattr(
        docker_env.subprocess,
        "run",
        lambda cmd, **kwargs: subprocess.CompletedProcess(
            cmd, 0, stdout="", stderr=""
        ),
    )
    monkeypatch.setattr(docker_env, "_cgroup_limits_available", lambda image: False)

    with pytest.raises(RuntimeError, match="requires CPU, memory, and PID"):
        docker_env.DockerEnvironment(
            image="python:3.11",
            security_profile="strict",
        )


def test_unknown_profile_fails_before_starting_docker(monkeypatch):
    monkeypatch.setattr(
        docker_env,
        "find_docker",
        lambda: pytest.fail("invalid profile must fail before Docker access"),
    )

    with pytest.raises(ValueError, match="docker_security_profile"):
        docker_env.DockerEnvironment(
            image="python:3.11",
            security_profile="strcit",
        )


def test_config_bridge_reaches_terminal_environment_without_credentials(monkeypatch):
    from tools import terminal_tool

    target = {}
    config_mod.apply_terminal_config_to_env(
        env=target,
        config={
            "terminal": {
                "backend": "docker",
                "docker_security_profile": "strict",
            }
        },
        override=True,
    )

    assert target["TERMINAL_DOCKER_SECURITY_PROFILE"] == "strict"
    assert not any("API_KEY" in key or "TOKEN" in key for key in target)

    monkeypatch.setattr(terminal_tool, "_terminal_config_bridge_attempted", True)
    monkeypatch.setenv("TERMINAL_ENV", target["TERMINAL_ENV"])
    monkeypatch.setenv(
        "TERMINAL_DOCKER_SECURITY_PROFILE",
        target["TERMINAL_DOCKER_SECURITY_PROFILE"],
    )
    runtime_config = terminal_tool._get_env_config()

    assert runtime_config["env_type"] == "docker"
    assert runtime_config["docker_security_profile"] == "strict"


def test_environment_factory_passes_the_selected_profile(monkeypatch):
    from tools import terminal_tool

    captured = {}
    sentinel = object()

    def fake_environment(**kwargs):
        captured.update(kwargs)
        return sentinel

    monkeypatch.setattr(terminal_tool, "_DockerEnvironment", fake_environment)
    monkeypatch.setattr(terminal_tool, "_maybe_reap_docker_orphans", lambda config: None)

    result = terminal_tool._create_environment(
        env_type="docker",
        image="python:3.11",
        cwd="/workspace",
        timeout=60,
        container_config={"docker_security_profile": "strict"},
    )

    assert result is sentinel
    assert captured["security_profile"] == "strict"
