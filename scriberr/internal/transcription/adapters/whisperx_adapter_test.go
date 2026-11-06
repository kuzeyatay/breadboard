package adapters

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestWhisperXSyncArgsForceCUDAWheelReinstallOnWindowsAMD64(t *testing.T) {
	args := whisperXSyncArgs("windows", "amd64")
	want := []string{
		"sync", "--all-extras", "--dev", "--native-tls",
		"--reinstall-package", "torch",
		"--reinstall-package", "torchaudio",
		"--reinstall-package", "torchvision",
	}
	if !slices.Equal(args, want) {
		t.Fatalf("unexpected sync args: %#v", args)
	}
}

func TestPruneStaleWhisperXTorchMetadataRemovesEmptyCPUDistribution(t *testing.T) {
	root := t.TempDir()
	sitePackages := filepath.Join(root, ".venv", "Lib", "site-packages")
	cudaMetadata := filepath.Join(sitePackages, "torch-2.8.0+cu126.dist-info", "METADATA")
	staleCPU := filepath.Join(sitePackages, "torch-2.8.0+cpu.dist-info")
	if err := os.MkdirAll(filepath.Dir(cudaMetadata), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cudaMetadata, []byte("Version: 2.8.0+cu126\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(staleCPU, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := pruneStaleWhisperXTorchMetadata(root, "windows", "amd64"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(staleCPU); !os.IsNotExist(err) {
		t.Fatalf("stale CPU metadata directory still exists: %v", err)
	}
	if _, err := os.Stat(cudaMetadata); err != nil {
		t.Fatalf("CUDA metadata was removed: %v", err)
	}
}

func TestPruneStaleWhisperXTorchMetadataKeepsNonemptyDirectory(t *testing.T) {
	root := t.TempDir()
	sitePackages := filepath.Join(root, ".venv", "Lib", "site-packages")
	cudaMetadata := filepath.Join(sitePackages, "torch-2.8.0+cu126.dist-info", "METADATA")
	staleCPU := filepath.Join(sitePackages, "torch-2.8.0+cpu.dist-info")
	if err := os.MkdirAll(filepath.Dir(cudaMetadata), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cudaMetadata, []byte("Version: 2.8.0+cu126\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(staleCPU, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staleCPU, "RECORD"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := pruneStaleWhisperXTorchMetadata(root, "windows", "amd64"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(staleCPU); err != nil {
		t.Fatalf("nonempty CPU metadata directory was removed: %v", err)
	}
}

func TestWhisperXSyncArgsLeaveMacOSCPUEnvironmentAlone(t *testing.T) {
	args := whisperXSyncArgs("darwin", "arm64")
	if slices.Contains(args, "--reinstall-package") {
		t.Fatalf("unexpected forced reinstall in CPU environment: %#v", args)
	}
}

func TestAddWhisperXTorchvisionSourceIsIdempotent(t *testing.T) {
	original := "[tool.uv.sources]\ntorch = []\ntriton = [\n]\n"
	updated := addWhisperXTorchvisionSource(original)
	if !strings.Contains(updated, "\ntorchvision = [") {
		t.Fatalf("torchvision source was not added: %s", updated)
	}
	if twice := addWhisperXTorchvisionSource(updated); twice != updated {
		t.Fatal("torchvision source insertion is not idempotent")
	}
}
