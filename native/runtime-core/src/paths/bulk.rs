//! A separate, pinned authority for a closed set of large payloads. Canonical
//! jobs, databases and all ordinary `resolve_data` operations remain on dataRoot.
use super::*;
use serde::Deserialize;

const VENV_IDS: &[&str] = &[
    "deep-tutor",
    "deer-flow",
    "legal",
    "money-printer",
    "openexecutive",
    "shorts",
    "stock-analyst",
    "tradingagents",
    "vibe-trading",
    "acestep",
    "comfyui",
    "resource2skill",
    "formsmith",
    "solidworks-mcp",
    "agent-reach",
    "matraix",
    "openmontage",
    "subsai",
    "colpali",
    "humanizer",
    "cad",
];
const TOOLCHAINS: &[&str] = &[
    "bolt-slides",
    "wardrobe",
    "openmontage",
    "comfyui",
    "google-images",
    "audio-analyzer",
    "career-ops-browsers",
    "openmaic",
    "openmaic-tools",
    "cache",
    "vlm-ocr-models",
    "voicebox",
];
const TOP_LEVEL: &[&str] = &[
    "hyperframes-cli",
    "hyperframes-browser",
    "openscience-cli",
    "openwork-runtime",
];

fn payload_namespace(relative: &str) -> Option<String> {
    let parts = relative.split('/').collect::<Vec<_>>();
    if parts.len() >= 4 && parts[..2] == ["runtime-v2", "services"] {
        if (parts[3] == ".venv" && VENV_IDS.contains(&parts[2]))
            || (parts[2] == "resource2skill" && parts[3] == "browsers")
            || (parts[2] == "acestep" && ["source", "uv-cache", "cache"].contains(&parts[3]))
        {
            return Some(parts[..4].join("/"));
        }
    }
    if parts.len() >= 3
        && parts[..2] == ["runtime-v2", "toolchains"]
        && TOOLCHAINS.contains(&parts[2])
    {
        return Some(parts[..3].join("/"));
    }
    TOP_LEVEL.contains(&parts[0]).then(|| parts[0].to_owned())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PayloadReady {
    version: u32,
    relative: String,
    verified_at: String,
}

// Writers use Date.toISOString(): keep this control record deliberately small
// and deterministic rather than accepting locale dates or ambiguous offsets.
fn canonical_iso(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 24
        || [4, 7, 10, 13, 16, 19, 23]
            .into_iter()
            .zip(b"--T::.Z")
            .any(|(i, c)| b[i] != *c)
    {
        return false;
    }
    if b.iter()
        .enumerate()
        .any(|(i, c)| ![4, 7, 10, 13, 16, 19, 23].contains(&i) && !c.is_ascii_digit())
    {
        return false;
    }
    let number = |a, b| value[a..b].parse::<u32>().unwrap_or(u32::MAX);
    let (year, month, day) = (number(0, 4), number(5, 7), number(8, 10));
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    day > 0 && day <= days && number(11, 13) < 24 && number(14, 16) < 60 && number(17, 19) < 60
}

fn required_files(namespace: &str) -> &[&str] {
    if namespace.ends_with("/.venv") {
        return if cfg!(windows) {
            &["Scripts/python.exe"]
        } else {
            &["bin/python"]
        };
    }
    match namespace {
        "runtime-v2/toolchains/bolt-slides" | "runtime-v2/toolchains/wardrobe" => {
            &["node_modules/vite/bin/vite.js"]
        }
        "runtime-v2/toolchains/openmontage" => &["tools/tool_registry.py", "AGENT_GUIDE.md"],
        "runtime-v2/toolchains/comfyui" => &["main.py"],
        "runtime-v2/toolchains/openmaic" => &[".next/BUILD_ID", "packages/@openmaic/generation/dist/index.js", "public/vendor/maic-importer/index.js"],
        "runtime-v2/toolchains/google-images" => &["src/index.js"],
        "runtime-v2/toolchains/vlm-ocr-models" => &["HunyuanOCR-Q8_0.gguf", "mmproj-HunyuanOCR-Q8_0.gguf"],
        "runtime-v2/toolchains/voicebox" => &["voicebox-server.exe"],
        "hyperframes-cli" => &["node_modules/hyperframes/bin/hyperframes.mjs"],
        "openscience-cli" => &["node_modules/@synsci/openscience/bin/openscience"],
        "openwork-runtime" => &[
            "apps/server/src/cli.ts",
            "apps/server/node_modules/@opencode-ai/sdk/package.json",
        ],
        "runtime-v2/services/acestep/source" => &["acestep/api_server.py"],
        _ => &[],
    }
}

impl RuntimePaths {
    /// Called only with Electron's bootstrap root, never a submitted job path.
    pub fn with_bulk_root(mut self, candidate: Option<PathBuf>) -> Result<Self, PathError> {
        if let Some(candidate) = candidate {
            if !candidate.is_absolute()
                || candidate
                    .components()
                    .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
            {
                return Err(PathError::RelativeRoot("bulk"));
            }
            #[cfg(windows)]
            if !matches!(candidate.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
            {
                return Err(PathError::RelativeRoot("local bulk"));
            }
            for ancestor in candidate.ancestors() {
                match fs::symlink_metadata(ancestor) {
                    Ok(metadata) if is_link_or_reparse(&metadata) => {
                        return Err(PathError::ReparsePoint)
                    }
                    Ok(_) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(PathError::Io(error)),
                }
            }
            // A disconnected optional drive must not prevent C databases/chat
            // from opening. Keep its configured path; payload launch fails on
            // this unavailable authority instead of resurrecting a C copy.
            let root = match establish_root("bulk", candidate.clone()) {
                Ok(root) => Some(root),
                Err(PathError::RootUnavailable(_, error))
                    if error.kind() == io::ErrorKind::NotFound =>
                {
                    None
                }
                Err(error) => return Err(error),
            };
            let selected = root
                .as_ref()
                .map(|r| r.canonical.as_path())
                .unwrap_or(&candidate);
            let normal_selected = child_argv_path_presentation(selected)?;
            if selected.parent().is_none()
                || [&self.data_root, &self.app_root, &self.runtime_root]
                    .iter()
                    .any(|other| {
                        let normal_other = child_argv_path_presentation(&other.canonical)
                            .unwrap_or_else(|_| other.canonical.clone());
                        path_is_within(&normal_selected, &normal_other)
                            || path_is_within(&normal_other, &normal_selected)
                    })
            {
                return Err(PathError::EscapedRoot(
                    "bulk (must be separate from data and program files)",
                ));
            }
            self.configured_bulk_root = Some(selected.to_path_buf());
            self.bulk_root = root;
        }
        Ok(self)
    }

    pub fn bulk_root(&self) -> Option<&Path> {
        self.configured_bulk_root.as_deref()
    }

    pub fn validate_bulk_root(&self) -> Result<(), PathError> {
        if let Some(root) = &self.bulk_root {
            root.revalidate()?;
        } else if self.configured_bulk_root.is_some() {
            return Err(PathError::RootUnavailable(
                "bulk storage; reconnect the configured drive",
                io::Error::from(io::ErrorKind::NotFound),
            ));
        }
        Ok(())
    }

    fn service_root_for(&self, relative: &str) -> Result<&TrustedRoot, PathError> {
        validate_relative_path("managed payload", relative)?;
        let Some(namespace) = payload_namespace(relative) else {
            return Ok(&self.data_root);
        };
        self.validate_bulk_root()?;
        let Some(root) = &self.bulk_root else {
            return Ok(&self.data_root);
        };
        root.revalidate()?;
        let marker = resolve_inside(root, &format!("{namespace}/.breadboard-bulk-ready.json"))?;
        let bytes = match read_bounded(root, &marker, 4096) {
            Ok(bytes) => bytes,
            Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(&self.data_root)
            }
            Err(error) => return Err(error),
        };
        let Ok(ready) = serde_json::from_slice::<PayloadReady>(&bytes) else {
            return Ok(&self.data_root);
        };
        if ready.version != 1 || ready.relative != namespace || !canonical_iso(&ready.verified_at) {
            return Ok(&self.data_root);
        }
        let payload = resolve_inside(root, &namespace)?;
        let _directory = pin_existing_directory_inside(root, &payload, "managed bulk payload")?;
        for required in required_files(&namespace) {
            let probe = resolve_inside(root, &format!("{namespace}/{required}"))?;
            match pin_file(root, &probe) {
                Ok(_) => {}
                Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                    return Ok(&self.data_root)
                }
                Err(error) => return Err(error),
            }
        }
        Ok(root)
    }

    /// Registry-only selection for fixed service executable/probe/argv paths.
    pub fn resolve_service_data(&self, relative: &str) -> Result<ResolvedTrustedPath, PathError> {
        resolve_inside(self.service_root_for(relative)?, relative)
    }

    pub fn pin_service_data_file_for_launch(
        &self,
        relative: &str,
    ) -> Result<TrustedFilePin, PathError> {
        let root = self.service_root_for(relative)?;
        pin_file(root, &resolve_inside(root, relative)?)
    }

    pub(crate) fn pin_service_data_launch_directory(
        &self,
        relative: &str,
    ) -> Result<TrustedLaunchDirectory, PathError> {
        let root = self.service_root_for(relative)?;
        let directory = pin_existing_directory_inside(
            root,
            &resolve_inside(root, relative)?,
            "managed service directory",
        )?;
        let launch = TrustedLaunchDirectory {
            authority_root: root.clone(),
            directory,
            authority: LaunchDirectoryAuthority::ManagedBulk,
        };
        launch.revalidate()?;
        Ok(launch)
    }

    /// Environment construction may retain the safe C installation on a failed
    /// optional payload probe. Launch pins and JS probes remain authoritative.
    pub(crate) fn managed_payload_path(&self, relative: &str) -> PathBuf {
        self.resolve_service_data(relative)
            .map(|p| p.absolute)
            .unwrap_or_else(|_| {
                if payload_namespace(relative).is_some() {
                    self.bulk_root().unwrap_or(self.data_root()).join(relative)
                } else {
                    self.data_root().join(relative)
                }
            })
    }

    pub(crate) fn managed_cache_path(&self, relative: &str) -> PathBuf {
        match payload_namespace(relative).as_deref() {
            Some(
                "runtime-v2/toolchains/cache"
                | "runtime-v2/services/acestep/cache"
                | "runtime-v2/services/acestep/uv-cache",
            ) => self.bulk_root().unwrap_or(self.data_root()).join(relative),
            _ => self.data_root().join(relative),
        }
    }

    /// A retained environment is a template: setup may complete during the same
    /// Runtime generation. Refresh only named, native-produced dependency paths
    /// when minting each launch; credentials and C state are never interpreted.
    pub(crate) fn refresh_managed_environment_value(
        &self,
        name: &std::ffi::OsStr,
        value: &std::ffi::OsStr,
    ) -> std::ffi::OsString {
        if name == "SHAPER_TOOL_PATH" {
            let paths = std::env::split_paths(value)
                .map(|entry| {
                    self.refresh_managed_environment_value(
                        std::ffi::OsStr::new("SHAPER_PYTHON"),
                        entry.as_os_str(),
                    )
                })
                .collect::<Vec<_>>();
            return std::env::join_paths(paths).unwrap_or_else(|_| value.to_os_string());
        }
        let names = [
            "SHORTS_PYTHON",
            "DEEP_TUTOR_PYTHON",
            "MONEY_PRINTER_PYTHON",
            "BREADBOARD_MANAGED_PYTHON_EXECUTABLE",
            "BREADBOARD_SOLIDWORKS_PYTHON",
            "UV_PROJECT_ENVIRONMENT",
            "SHAPER_PYTHON",
            "HYPERFRAMES_CLI_ROOT",
            "OPENWORK_SERVER_RUNTIME_ROOT",
            "OPENSCIENCE_CLI_ROOT",
            "WARDROBE_RUNTIME_ROOT",
            "COMFYUI_ROOT",
            "COMFYUI_ENV_DIR",
            "PLAYWRIGHT_BROWSERS_PATH",
            "BREADBOARD_ACESTEP_SOURCE_DIR",
        ];
        if self.bulk_root().is_none()
            || !names
                .iter()
                .any(|allowed| name.eq_ignore_ascii_case(std::ffi::OsStr::new(allowed)))
        {
            return value.to_os_string();
        }
        let Ok(candidate) = child_argv_path_presentation(Path::new(value)) else {
            return value.to_os_string();
        };
        for root in [Some(self.data_root()), self.bulk_root()]
            .into_iter()
            .flatten()
        {
            let Ok(root) = child_argv_path_presentation(root) else {
                continue;
            };
            let Ok(relative) = candidate.strip_prefix(root) else {
                continue;
            };
            let relative = path_text(relative);
            if payload_namespace(&relative).is_some() {
                return self.managed_payload_path(&relative).into_os_string();
            }
        }
        value.to_os_string()
    }

    /// Upload activation is bound to this exact C data root and a verified
    /// offline database migration, not merely the presence of a D directory.
    pub(crate) fn scriberr_uploads_path(&self) -> Result<PathBuf, PathError> {
        let relative = "runtime/scriberr/uploads";
        self.validate_bulk_root()?;
        let Some(root) = &self.bulk_root else {
            return Ok(self.data_root().join(relative));
        };
        let marker = resolve_inside(root, ".breadboard-scriberr-uploads.json")?;
        let bytes = match read_bounded(root, &marker, 16_384) {
            Ok(bytes) => bytes,
            Err(PathError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(self.data_root().join(relative))
            }
            Err(error) => return Err(error),
        };
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| PathError::InvalidJobInput)?;
        let expected_source = child_argv_path_presentation(self.data_root())?;
        let expected_uploads = child_argv_path_presentation(&root.canonical.join(relative))?;
        let path_matches = |key, expected: &Path| {
            value
                .get(key)
                .and_then(|v| v.as_str())
                .is_some_and(|s| paths_equal(Path::new(s), expected))
        };
        if value["version"] != 1
            || value["kind"] != "scriberr-uploads"
            || !path_matches("sourceDataRoot", &expected_source)
            || !path_matches("uploadsRoot", &expected_uploads)
            || !value["verifiedAt"].as_str().is_some_and(canonical_iso)
            || ["files", "bytes", "rewrittenReferences"]
                .iter()
                .any(|k| value[*k].as_u64().is_none())
            || !value["manifestSha256"]
                .as_str()
                .is_some_and(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit()))
        {
            return Err(PathError::WrongAuthority("Scriberr upload activation"));
        }
        let upload = resolve_inside(root, relative)?;
        let _pin = pin_existing_directory_inside(root, &upload, "Scriberr uploads")?;
        Ok(upload.absolute)
    }

    pub(crate) fn scriberr_uploads_environment_path(&self) -> PathBuf {
        self.scriberr_uploads_path().unwrap_or_else(|_| {
            self.bulk_root()
                .unwrap_or(self.data_root())
                .join("runtime/scriberr/uploads")
        })
    }
}

fn pin_file(root: &TrustedRoot, path: &ResolvedTrustedPath) -> Result<TrustedFilePin, PathError> {
    validate_authority(root, path)?;
    root.revalidate()?;
    reject_link_components(&root.canonical, path.absolute())?;
    let file = open_read_pinned(path.absolute()).map_err(PathError::Io)?;
    verify_regular_file(root, path, &file, true)?;
    root.revalidate()?;
    Ok(TrustedFilePin {
        root: root.clone(),
        path: path.clone(),
        _file: file,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (tempfile::TempDir, RuntimePaths, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        for name in ["data", "app", "runtime", "bulk"] {
            fs::create_dir(temp.path().join(name)).unwrap();
        }
        let bulk = temp.path().join("bulk");
        let paths = RuntimePaths::new(
            temp.path().join("data"),
            temp.path().join("app"),
            temp.path().join("runtime"),
        )
        .unwrap()
        .with_bulk_root(Some(bulk.clone()))
        .unwrap();
        (temp, paths, bulk)
    }

    fn ready(bulk: &Path, namespace: &str) {
        let root = bulk.join(namespace);
        fs::create_dir_all(&root).unwrap();
        for file in required_files(namespace) {
            let target = root.join(file);
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, b"fixture executable").unwrap();
        }
        fs::write(
            root.join(".breadboard-bulk-ready.json"),
            serde_json::to_vec(
                &json!({"version":1,"relative":namespace,"verifiedAt":"2026-11-06T12:00:00.000Z"}),
            )
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn bulk_payload_markers_never_move_databases_jobs_or_service_state() {
        let (_temp, paths, bulk) = fixture();
        let namespace = "runtime-v2/services/deep-tutor/.venv";
        let executable = format!("{namespace}/{}", required_files(namespace)[0]);
        assert!(paths
            .resolve_service_data(&executable)
            .unwrap()
            .absolute()
            .starts_with(paths.data_root()));
        ready(&bulk, namespace);
        let selected = paths.resolve_service_data(&executable).unwrap();
        assert!(selected.absolute().starts_with(paths.bulk_root().unwrap()));
        paths.pin_service_data_file_for_launch(&executable).unwrap();
        assert!(
            paths.pin_data_file_for_launch(&selected).is_err(),
            "bulk cannot impersonate canonical data authority"
        );
        for path in [
            "database/brain.db",
            "runtime-v2/runtime-v2.sqlite3",
            "runtime/jobs/job_1/result.json",
            "runtime-v2/services/deep-tutor/status.json",
            "runtime-v2/toolchains/money-printer/config.toml",
            "runtime-v2/toolchains/career-ops/data/profile.json",
        ] {
            assert!(paths
                .resolve_service_data(path)
                .unwrap()
                .absolute()
                .starts_with(paths.data_root()));
            assert!(paths
                .resolve_data(path)
                .unwrap()
                .absolute()
                .starts_with(paths.data_root()));
        }
        assert_eq!(
            paths.runtime_generation_scope(),
            RuntimePaths::new(paths.data_root(), paths.app_root(), paths.runtime_root())
                .unwrap()
                .runtime_generation_scope()
        );
    }

    #[test]
    fn missing_invalid_wrong_namespace_or_incomplete_ready_marker_keeps_c_fallback() {
        let (_temp, paths, bulk) = fixture();
        let namespace = "runtime-v2/services/deep-tutor/.venv";
        ready(&bulk, namespace);
        let marker = bulk.join(namespace).join(".breadboard-bulk-ready.json");
        for content in ["{}".to_owned(), "not JSON".to_owned(), json!({"version":1,"relative":"runtime-v2/services/legal/.venv","verifiedAt":"2026-11-06T12:00:00.000Z"}).to_string(), json!({"version":1,"relative":namespace,"verifiedAt":"2026-02-30T12:00:00.000Z"}).to_string()] {
            fs::write(&marker, content).unwrap();
            assert!(paths.resolve_service_data(namespace).unwrap().absolute().starts_with(paths.data_root()));
        }
        ready(&bulk, namespace);
        fs::remove_file(bulk.join(namespace).join(required_files(namespace)[0])).unwrap();
        assert!(paths
            .resolve_service_data(namespace)
            .unwrap()
            .absolute()
            .starts_with(paths.data_root()));
        assert!(paths.resolve_service_data("../bulk/secrets").is_err());
        ready(&bulk, "runtime-v2/services/unknown/.venv");
        assert!(paths
            .resolve_service_data("runtime-v2/services/unknown/.venv")
            .unwrap()
            .absolute()
            .starts_with(paths.data_root()));
    }

    #[test]
    fn bulk_root_must_be_separate_and_direct() {
        let (temp, paths, _bulk) = fixture();
        assert!(paths
            .clone()
            .with_bulk_root(Some(paths.data_root().to_path_buf()))
            .is_err());
        assert!(paths
            .clone()
            .with_bulk_root(Some(temp.path().to_path_buf()))
            .is_err());
        assert!(paths
            .clone()
            .with_bulk_root(Some(PathBuf::from("relative")))
            .is_err());
        let disconnected = paths
            .with_bulk_root(Some(temp.path().join("missing")))
            .unwrap();
        assert!(disconnected.resolve_data("database/brain.db").is_ok());
        assert!(disconnected
            .resolve_service_data("runtime-v2/services/deep-tutor/.venv/Scripts/python.exe")
            .is_err());
        assert!(disconnected
            .managed_payload_path("runtime-v2/services/deep-tutor/.venv")
            .starts_with(temp.path().join("missing")));
        assert!(disconnected.scriberr_uploads_path().is_err());
    }

    #[test]
    fn scriberr_upload_activation_is_bound_to_current_database_authority() {
        let (_temp, paths, bulk) = fixture();
        assert!(paths
            .scriberr_uploads_path()
            .unwrap()
            .starts_with(paths.data_root()));
        let uploads = bulk.join("runtime/scriberr/uploads");
        fs::create_dir_all(&uploads).unwrap();
        let mut marker = json!({"version":1,"kind":"scriberr-uploads","sourceDataRoot":child_argv_path_presentation(paths.data_root()).unwrap(),"uploadsRoot":uploads,"verifiedAt":"2026-11-06T12:00:00.000Z","files":1,"bytes":123,"rewrittenReferences":1,"manifestSha256":"a".repeat(64)});
        let marker_file = bulk.join(".breadboard-scriberr-uploads.json");
        fs::write(&marker_file, marker.to_string()).unwrap();
        assert!(paths
            .scriberr_uploads_path()
            .unwrap()
            .starts_with(paths.bulk_root().unwrap()));
        marker["sourceDataRoot"] = json!(paths.app_root());
        fs::write(&marker_file, marker.to_string()).unwrap();
        assert!(
            paths.scriberr_uploads_path().is_err(),
            "a copied preference cannot redirect QA to production media"
        );
    }

    #[test]
    fn ready_marker_does_not_allow_redirected_payload_ancestors() {
        let (temp, paths, bulk) = fixture();
        let namespace = "runtime-v2/services/deep-tutor/.venv";
        ready(&bulk, namespace);
        let target = bulk.join(namespace);
        let outside = temp.path().join("elsewhere");
        fs::rename(&target, &outside).unwrap();
        #[cfg(windows)]
        {
            let status = std::process::Command::new("cmd")
                .args(["/D", "/C", "mklink", "/J"])
                .arg(target.to_string_lossy().replace('/', "\\"))
                .arg(outside.to_string_lossy().replace('/', "\\"))
                .output()
                .unwrap();
            assert!(
                status.status.success(),
                "{}",
                String::from_utf8_lossy(&status.stderr)
            );
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &target).unwrap();
        assert!(matches!(
            paths.resolve_service_data(namespace),
            Err(PathError::ReparsePoint)
        ));
        assert!(paths.clone().with_bulk_root(Some(target.clone())).is_err());
        fs::remove_dir(&target).unwrap();
    }
}
