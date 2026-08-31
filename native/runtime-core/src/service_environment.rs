use crate::paths::{PathError, RuntimePaths, TrustedDirectoryPin};
use breadboard_runtime_protocol::{
    RuntimeMode, ServiceLaunchProfile, TrustedServiceEnvironmentSource,
    TrustedWorkerEnvironmentSource, MAX_CONTROL_TOKEN_BYTES, MIN_CONTROL_TOKEN_BYTES,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::num::NonZeroU16;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const DESKTOP_CONFIG_FILE: &str = "desktop-config.json";
const MAX_DESKTOP_CONFIG_BYTES: usize = 64 * 1024;
const MAX_CONFIG_SECRET_BYTES: usize = MAX_CONTROL_TOKEN_BYTES;
const MAX_INVITE_CODE_BYTES: usize = 256;
const MAX_ENVIRONMENT_NAME_BYTES: usize = 128;
const MAX_ENVIRONMENT_VALUE_BYTES: usize = 16 * 1024;
// Windows CreateProcess environment blocks are limited to 32,767 UTF-16 code
// units. Counting Rust's platform encoding bytes is conservative for the
// ASCII names and ordinary Windows paths used here.
const MAX_ENVIRONMENT_BLOCK_BYTES: usize = 32 * 1024 - 1;
// Next dev recycles its server child at roughly 80% of this V8 old-space cap.
// The dashboard's large route graph repeatedly crossed the old 4 GiB cap before
// Runtime V2's outer process-tree limit, producing user-visible restarts.
const HOT_DASHBOARD_NODE_OPTIONS: &str = "--max-old-space-size=6144";

const REQUIRED_OS_ENVIRONMENT_NAME: &str = "SystemRoot";
const OPTIONAL_ELECTRON_GATED_OS_ENVIRONMENT_NAMES: [&str; 7] = [
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SystemDrive",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
];

/// Product configuration still accepted from the desktop launch environment.
/// Electron copies only this fixed vocabulary into Runtime V2; the native
/// environment builders then expose each item solely to the background or
/// gateway profile that consumes it.
const OPTIONAL_ELECTRON_GATED_PRODUCT_ENVIRONMENT_NAMES: &[&str] = &[
    "CHATMOCK_MODEL",
    "SKILLS_CATALOG_DB",
    "SKILLS_CATALOG_SYNC_INTERVAL_MINUTES",
    "BREADBOARD_CALDAV_SYNC_INTERVAL_MS",
    "BREADBOARD_EMAIL_DISABLED",
    "BREADBOARD_EMAIL_CREDENTIALS_FILE",
    "BREADBOARD_EMAIL_POLL_MS",
    "BREADBOARD_EMAIL_TURN_TIMEOUT_MS",
    "BREADBOARD_EMAIL_NEW_THREAD_MS",
    "BREADBOARD_TELEGRAM_ENABLED",
    "BREADBOARD_TELEGRAM_API_BASE",
    "BREADBOARD_TELEGRAM_TOKEN_FILE",
    "BREADBOARD_TELEGRAM_BOT_TOKEN",
    "BREADBOARD_TELEGRAM_NEW_CHAT_AFTER_MINUTES",
    "BREADBOARD_WHATSAPP_ENABLED",
    "BREADBOARD_WHATSAPP_BRIDGE_DIR",
    "BREADBOARD_WHATSAPP_SESSION_DIR",
    "BREADBOARD_WHATSAPP_BRIDGE_PORT",
    "BREADBOARD_WHATSAPP_NODE",
    "BREADBOARD_WHATSAPP_REPLY_PREFIX",
    "BREADBOARD_WHATSAPP_NEW_CHAT_AFTER_MINUTES",
    "HERMES_APP_DIR",
    "BREADBOARD_IFIXAI_MODE",
    "BREADBOARD_IFIXAI_PYTHON",
    "BREADBOARD_IFIXAI_ENDPOINT",
    "BREADBOARD_IFIXAI_SUITE",
    "BREADBOARD_IFIXAI_SUT_MODEL",
    "BREADBOARD_IFIXAI_JUDGE_MODEL",
    "BREADBOARD_IFIXAI_REPAIR_MODEL",
    "BREADBOARD_IFIXAI_SEED",
    "BREADBOARD_IFIXAI_INTERVAL_HOURS",
    "BREADBOARD_IFIXAI_STARTUP_DELAY_SECONDS",
    "BREADBOARD_IFIXAI_TIMEOUT_MINUTES",
    "BREADBOARD_IFIXAI_JUDGE_MAX_CALLS",
    "BREADBOARD_IFIXAI_MAX_ATTEMPTS",
    "BREADBOARD_IFIXAI_MINIMUM_IMPROVEMENT",
    "BREADBOARD_IFIXAI_MAXIMUM_CATEGORY_REGRESSION",
    "VLM_OCR_ENABLED",
    "VLM_OCR_BASE_URL",
    "VLM_OCR_API_KEY",
    "VLM_OCR_MODEL",
    "VLM_OCR_AUTO_START",
    "VLM_OCR_SERVER_BINARY",
    "VLM_OCR_HF_REPO",
    "VLM_OCR_MODEL_PATH",
    "VLM_OCR_MMPROJ_PATH",
    "VLM_OCR_GPU_LAYERS",
    "VLM_OCR_CONTEXT_SIZE",
    "VLM_OCR_STARTUP_TIMEOUT_MS",
    "VLM_OCR_REQUEST_TIMEOUT_MS",
    "VLM_OCR_MAX_TOKENS",
    "VLM_OCR_TEMPERATURE",
    "VLM_OCR_TOP_P",
    "VLM_OCR_TOP_K",
    "VLM_OCR_REPEAT_PENALTY",
    "VLM_OCR_PAGE_IMAGE_WIDTH",
    "VLM_OCR_MAX_PAGES",
    "VLM_OCR_CONCURRENCY",
    "BREADBOARD_EMBEDDING_BASE_URL",
    "BREADBOARD_EMBEDDING_API_KEY",
    "BREADBOARD_EMBEDDING_MODEL",
    "BREADBOARD_EMBEDDING_DIMENSIONS",
    "BREADBOARD_EMBEDDINGS",
    "BREADBOARD_AGENT_MEMORY",
    "BREADBOARD_AGENT_MEMORY_AGENTS",
    "BREADBOARD_MEM0",
    "BREADBOARD_MEM0_EXTRACTION",
    "BREADBOARD_MEM0_LLM_MODEL",
    "BREADBOARD_GRAFT_CLI",
    "BREADBOARD_GIT_BIN",
    "RUFLO_CLAUDE_MODEL",
    "RUFLO_DANGEROUSLY_SKIP_PERMISSIONS",
    "BREADBOARD_VISUAL_BROWSER_PATH",
    "BREADBOARD_SPOTIFY_BROWSER_PATH",
    "BREADBOARD_SOLIDWORKS_EXE",
    "BREADBOARD_SOLIDWORKS_VERSION",
    "AGENT_BROWSER_EXECUTABLE_PATH",
    "SF3D_DEVICE",
    "SF3D_PRETRAINED_MODEL",
    "SF3D_TIMEOUT_MS",
    "UV_PATH",
    "SUBSAI_DEVICE",
    "SUBSAI_COMPUTE_TYPE",
    "SCRIBERR_API_TOKEN",
    "SCRIBERR_REQUEST_TIMEOUT_MS",
    "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS",
    "SCRIBERR_POLL_INTERVAL_MS",
    "SCRIBERR_MODEL_FAMILY",
    "SCRIBERR_MODEL",
    "SCRIBERR_LANGUAGE",
    "SCRIBERR_DIARIZATION",
    "VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS",
    "VIDEO_TRANSCRIPTION_KEEP_MEDIA",
    "VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB",
    "VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS",
    "VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS",
    "YTDLP_DOWNLOAD_TIMEOUT_MS",
    "VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN",
    "QUARTZ_AUTO_PUBLISH",
    "QUARTZ_PUBLISH_MODE",
    "QUARTZ_BUILD_CONCURRENCY",
    "QUARTZ_BUILD_TIMEOUT_MS",
    "GET_DOC_CONTACT_EMAIL",
    "OPENALEX_MAILTO",
    "UNPAYWALL_EMAIL",
    "CORE_API_KEY",
    "HUGGINGFACE_TOKEN",
    "HF_TOKEN",
    "HUGGING_FACE_HUB_TOKEN",
    "CUDA_VISIBLE_DEVICES",
    "CUDA_PATH",
    "CUDA_HOME",
    "CUDA_INCLUDE",
    "CUDA_LIB",
    "OMP_NUM_THREADS",
    "HF_HUB_OFFLINE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "LANG",
    "LC_ALL",
    "FONTCONFIG_FILE",
    "FONTCONFIG_PATH",
    "FAL_KEY",
    "FAL_AI_API_KEY",
    "REPLICATE_API_TOKEN",
    "HIGGSFIELD_API_KEY",
    "HIGGSFIELD_API_SECRET",
    "KLING_API_KEY",
    "KLING_API_BASE_URL",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "ELEVENLABS_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "DOUBAO_SPEECH_API_KEY",
    "DOUBAO_SPEECH_VOICE_TYPE",
    "DASHSCOPE_API_KEY",
    "SUNO_API_KEY",
    "HEYGEN_API_KEY",
    "RUNWAY_API_KEY",
    "VOLC_ACCESSKEY",
    "VOLC_SECRETKEY",
    "VIDEO_GEN_LOCAL_ENABLED",
    "VIDEO_GEN_LOCAL_MODEL",
    "MODAL_LTX2_ENDPOINT_URL",
    "PEXELS_API_KEY",
    "PIXABAY_API_KEY",
    "UNSPLASH_ACCESS_KEY",
    "AZURE_SPEECH_KEY",
    "AZURE_SPEECH_REGION",
    "VIMAX_IMAGE_MODEL",
    "VOX_DIRECTOR_MUSIC_DIR",
    "SHORTS_WHISPER_DEVICE",
    "INTERACTIVE_VISUALIZER_ENABLED",
    "INTERACTIVE_VISUALIZER_BROWSER_TESTS",
    "INTERACTIVE_VISUALIZER_THREE_ENABLED",
    "INTERACTIVE_VISUALIZER_MAX_ATTEMPTS",
    "INTERACTIVE_VISUALIZER_MAX_SOURCE_BYTES",
    "INTERACTIVE_VISUALIZER_MAX_BUNDLE_BYTES",
    "INTERACTIVE_VISUALIZER_MAX_ARTIFACT_BYTES",
    "INTERACTIVE_VISUALIZER_BROWSER_TIMEOUT_MS",
    "INTERACTIVE_VISUALIZER_MAX_THREE_OBJECTS",
    "INTERACTIVE_VISUALIZER_MAX_VERTICES",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "DOCKER_CLI_PATH",
    "PODMAN_CLI_PATH",
    "DOCKER_DESKTOP_PATH",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "MANIM_DOCKER_IMAGE",
    "MANIM_TIMEOUT_MS",
    "POSTIZ_IDLE_TIMEOUT_MS",
    "POSTIZ_IDLE_CHECK_MS",
    "SOCIALS_MANAGER_READY_TIMEOUT_MS",
    "INBOX_ZERO_GOOGLE_CLIENT_ID",
    "INBOX_ZERO_GOOGLE_CLIENT_SECRET",
    "INBOX_ZERO_MICROSOFT_CLIENT_ID",
    "INBOX_ZERO_MICROSOFT_CLIENT_SECRET",
    "X_API_KEY",
    "X_API_SECRET",
    "X_URL",
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "THREADS_APP_ID",
    "THREADS_APP_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "GOOGLE_GMB_CLIENT_ID",
    "GOOGLE_GMB_CLIENT_SECRET",
    "TIKTOK_CLIENT_ID",
    "TIKTOK_CLIENT_SECRET",
    "PINTEREST_CLIENT_ID",
    "PINTEREST_CLIENT_SECRET",
    "DRIBBBLE_CLIENT_ID",
    "DRIBBBLE_CLIENT_SECRET",
    "TUMBLR_CLIENT_ID",
    "TUMBLR_CLIENT_SECRET",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN_ID",
    "SLACK_ID",
    "SLACK_SECRET",
    "SLACK_SIGNING_SECRET",
    "KICK_CLIENT_ID",
    "KICK_SECRET",
    "TWITCH_CLIENT_ID",
    "TWITCH_CLIENT_SECRET",
    "WHOP_CLIENT_ID",
    "VK_ID",
    "MEWE_APP_ID",
    "MEWE_API_KEY",
    "MEWE_HOST",
    "NEYNAR_CLIENT_ID",
    "NEYNAR_SECRET_KEY",
    "TELEGRAM_BOT_NAME",
    "TELEGRAM_TOKEN",
    "BREADBOARD_POSTIZ_POSTIZ_MEMORY_MB",
    "BREADBOARD_POSTIZ_POSTIZ_POSTGRES_MEMORY_MB",
    "BREADBOARD_POSTIZ_POSTIZ_REDIS_MEMORY_MB",
    "BREADBOARD_POSTIZ_SPOTLIGHT_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_ELASTICSEARCH_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_POSTGRESQL_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_ADMIN_TOOLS_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_UI_MEMORY_MB",
    "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
];

static ELECTRON_GATED_OS_ENVIRONMENT: OnceLock<
    Result<TrustedOsEnvironment, TrustedOsEnvironmentCaptureError>,
> = OnceLock::new();

/// The process-wide snapshot of the small OS environment vocabulary admitted
/// by the Electron bootstrap. It deliberately cannot represent PATH, arbitrary
/// developer variables, provider keys, or an environment dump.
///
/// `capture_electron_gated` initializes one process-wide snapshot. Later calls
/// return that same snapshot and never observe ambient environment changes.
pub struct TrustedOsEnvironment {
    system_root: OsString,
    optional: Vec<(&'static str, OsString)>,
    product: Vec<(&'static str, OsString)>,
}

impl TrustedOsEnvironment {
    pub fn capture_electron_gated() -> Result<&'static Self, TrustedOsEnvironmentCaptureError> {
        match ELECTRON_GATED_OS_ENVIRONMENT.get_or_init(Self::capture_now) {
            Ok(environment) => Ok(environment),
            Err(error) => Err(error.clone()),
        }
    }

    fn capture_now() -> Result<Self, TrustedOsEnvironmentCaptureError> {
        let system_root = std::env::var_os(REQUIRED_OS_ENVIRONMENT_NAME).ok_or(
            TrustedOsEnvironmentCaptureError::MissingRequiredVariable(REQUIRED_OS_ENVIRONMENT_NAME),
        )?;
        let optional = OPTIONAL_ELECTRON_GATED_OS_ENVIRONMENT_NAMES
            .into_iter()
            .filter_map(|name| std::env::var_os(name).map(|value| (name, value)))
            .collect();
        let product = OPTIONAL_ELECTRON_GATED_PRODUCT_ENVIRONMENT_NAMES
            .iter()
            .filter_map(|name| std::env::var_os(name).map(|value| (*name, value)))
            .collect();
        Self::from_captured_values(system_root, optional, product)
    }

    fn from_captured_values(
        system_root: OsString,
        optional: Vec<(&'static str, OsString)>,
        product: Vec<(&'static str, OsString)>,
    ) -> Result<Self, TrustedOsEnvironmentCaptureError> {
        validate_captured_os_value(REQUIRED_OS_ENVIRONMENT_NAME, &system_root)?;
        if !Path::new(&system_root).is_absolute() {
            return Err(TrustedOsEnvironmentCaptureError::InvalidVariable);
        }

        let mut seen = HashSet::with_capacity(optional.len() + 1);
        seen.insert(REQUIRED_OS_ENVIRONMENT_NAME.to_ascii_lowercase());
        for (name, value) in &optional {
            if !OPTIONAL_ELECTRON_GATED_OS_ENVIRONMENT_NAMES
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(name))
            {
                return Err(TrustedOsEnvironmentCaptureError::VariableOutsideElectronGate);
            }
            if !seen.insert(name.to_ascii_lowercase()) {
                return Err(TrustedOsEnvironmentCaptureError::DuplicateVariable);
            }
            validate_captured_os_value(name, value)?;
        }

        for (name, value) in &product {
            if !OPTIONAL_ELECTRON_GATED_PRODUCT_ENVIRONMENT_NAMES
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(name))
            {
                return Err(TrustedOsEnvironmentCaptureError::VariableOutsideElectronGate);
            }
            if !seen.insert(name.to_ascii_lowercase()) {
                return Err(TrustedOsEnvironmentCaptureError::DuplicateVariable);
            }
            validate_captured_product_value(name, value)?;
        }

        Ok(Self {
            system_root,
            optional,
            product,
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test(system_root: impl Into<OsString>) -> Self {
        Self::from_captured_values(system_root.into(), Vec::new(), Vec::new())
            .expect("test OS environment must satisfy the Electron gate")
    }
}

impl fmt::Debug for TrustedOsEnvironment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let optional_names: Vec<_> = self.optional.iter().map(|(name, _)| *name).collect();
        formatter
            .debug_struct("TrustedOsEnvironment")
            .field("required_names", &[REQUIRED_OS_ENVIRONMENT_NAME])
            .field("optional_names", &optional_names)
            .field(
                "product_names",
                &self
                    .product
                    .iter()
                    .map(|(name, _)| *name)
                    .collect::<Vec<_>>(),
            )
            .field("values", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum TrustedOsEnvironmentCaptureError {
    #[error("required Electron-gated OS environment variable {0} is missing")]
    MissingRequiredVariable(&'static str),
    #[error("an Electron-gated OS environment variable is invalid")]
    InvalidVariable,
    #[error("an OS environment variable was outside the Electron gate")]
    VariableOutsideElectronGate,
    #[error("the Electron-gated OS environment contained a duplicate name")]
    DuplicateVariable,
}

/// The runtime-owned loopback allocations needed by the registered service
/// graph. Zero and shared ports are rejected before any URL can be minted.
#[must_use = "validated endpoint allocations must be retained by the runtime generation"]
pub struct ServiceEndpointMap {
    ports: [NonZeroU16; TrustedServiceEnvironmentSource::COUNT],
    auxiliary_ports: [NonZeroU16; ServiceAuxiliaryEndpoint::COUNT],
}

/// Closed secondary loopback endpoints required by services whose controller
/// owns additional listeners. These allocations are Runtime-owned and remain
/// reserved alongside the primary service endpoint until the exact service
/// generation starts; neither manifests nor dashboard callers can choose a
/// port or add another endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceAuxiliaryEndpoint {
    PostizWeb,
    InboxWeb,
    InboxDatabase,
    InboxRedis,
    InboxRedisHttp,
}

impl ServiceAuxiliaryEndpoint {
    pub const ALL: [Self; 5] = [
        Self::PostizWeb,
        Self::InboxWeb,
        Self::InboxDatabase,
        Self::InboxRedis,
        Self::InboxRedisHttp,
    ];
    pub const COUNT: usize = Self::ALL.len();

    pub const fn index(self) -> usize {
        match self {
            Self::PostizWeb => 0,
            Self::InboxWeb => 1,
            Self::InboxDatabase => 2,
            Self::InboxRedis => 3,
            Self::InboxRedisHttp => 4,
        }
    }
}

impl ServiceEndpointMap {
    pub fn new(
        raw_ports: [u16; TrustedServiceEnvironmentSource::COUNT],
        raw_auxiliary_ports: [u16; ServiceAuxiliaryEndpoint::COUNT],
    ) -> Result<Self, TrustedServiceEnvironmentError> {
        let mut ports =
            [NonZeroU16::new(1).expect("one is nonzero"); TrustedServiceEnvironmentSource::COUNT];
        for source in TrustedServiceEnvironmentSource::ALL {
            ports[source.index()] = NonZeroU16::new(raw_ports[source.index()])
                .ok_or(TrustedServiceEnvironmentError::InvalidServiceEndpoints)?;
        }
        if ports
            .iter()
            .enumerate()
            .any(|(index, port)| ports[index + 1..].contains(port))
        {
            return Err(TrustedServiceEnvironmentError::InvalidServiceEndpoints);
        }
        let mut auxiliary_ports =
            [NonZeroU16::new(1).expect("one is nonzero"); ServiceAuxiliaryEndpoint::COUNT];
        for endpoint in ServiceAuxiliaryEndpoint::ALL {
            auxiliary_ports[endpoint.index()] =
                NonZeroU16::new(raw_auxiliary_ports[endpoint.index()])
                    .ok_or(TrustedServiceEnvironmentError::InvalidServiceEndpoints)?;
        }
        let mut all_ports = ports.iter().chain(auxiliary_ports.iter());
        let mut seen = HashSet::with_capacity(
            TrustedServiceEnvironmentSource::COUNT + ServiceAuxiliaryEndpoint::COUNT,
        );
        if all_ports.any(|port| !seen.insert(*port)) {
            return Err(TrustedServiceEnvironmentError::InvalidServiceEndpoints);
        }
        Ok(Self {
            ports,
            auxiliary_ports,
        })
    }

    pub fn port_for(&self, source: TrustedServiceEnvironmentSource) -> NonZeroU16 {
        self.ports[source.index()]
    }

    pub fn auxiliary_port_for(&self, endpoint: ServiceAuxiliaryEndpoint) -> NonZeroU16 {
        self.auxiliary_ports[endpoint.index()]
    }

    fn base_url(&self, source: TrustedServiceEnvironmentSource) -> String {
        format!("http://127.0.0.1:{}", self.port_for(source))
    }

    fn chatmock_v1_url(&self) -> String {
        format!(
            "{}/v1",
            self.base_url(TrustedServiceEnvironmentSource::Chatmock)
        )
    }
}

impl fmt::Debug for ServiceEndpointMap {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ServiceEndpointMap(<redacted loopback allocations>)")
    }
}

/// Per-generation capability material for the dashboard-to-runtime control
/// plane. The URL must be one canonical IPv4-loopback HTTP origin, and the
/// token follows the same bounds as the native control-plane authority.
#[must_use = "dashboard control capability material must be sealed into its environment"]
pub struct DashboardControlEnvironment {
    url: String,
    token: String,
}

impl DashboardControlEnvironment {
    pub fn new(
        url: impl Into<String>,
        token: impl Into<String>,
    ) -> Result<Self, TrustedServiceEnvironmentError> {
        let url = url.into();
        let token = token.into();
        validate_loopback_origin(&url)?;
        let token_bytes = token.as_bytes();
        if token_bytes.len() < MIN_CONTROL_TOKEN_BYTES
            || token_bytes.len() > MAX_CONTROL_TOKEN_BYTES
            || !token_bytes.iter().all(|byte| byte.is_ascii_graphic())
        {
            return Err(TrustedServiceEnvironmentError::InvalidDashboardControlToken);
        }
        Ok(Self { url, token })
    }
}

impl fmt::Debug for DashboardControlEnvironment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DashboardControlEnvironment")
            .field("url", &"<validated loopback origin>")
            .field("token", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TrustedServiceEnvironmentProfile {
    Chatmock,
    Comfyui,
    Dashboard,
    Gbrain,
    Hermes,
    TelegramGateway,
    WhatsappGateway,
    Openwork,
    Openscience,
    MoneyPrinter,
    Wardrobe,
    Penecho,
    VlmOcr,
    Recall,
    Mem0SemanticEngine,
    LocalMcpBroker,
    PostizCoordinator,
    InboxZeroStack,
    SpotifyPlayback,
    Cliproxy,
    Quartz,
    UiTars,
    Cad,
    Colpali,
    Humanizer,
    Voicebox,
    Scriberr,
    DeepResearch,
    DeerFlow,
    VibeTrading,
    StockAnalyst,
    SolidworksMcp,
}

impl TrustedServiceEnvironmentProfile {
    pub const fn service_id(self) -> &'static str {
        match self {
            Self::Chatmock => "chatmock",
            Self::Comfyui => "comfyui",
            Self::Dashboard => "dashboard",
            Self::Gbrain => "gbrain",
            Self::Hermes => "hermes",
            Self::TelegramGateway => "telegram-gateway",
            Self::WhatsappGateway => "whatsapp-gateway",
            Self::Openwork => "openwork",
            Self::Openscience => "openscience",
            Self::MoneyPrinter => "money-printer",
            Self::Wardrobe => "wardrobe",
            Self::Penecho => "penecho",
            Self::VlmOcr => "vlm-ocr",
            Self::Recall => "recall",
            Self::Mem0SemanticEngine => "mem0-semantic-engine",
            Self::LocalMcpBroker => "local-mcp-broker",
            Self::PostizCoordinator => "postiz-coordinator",
            Self::InboxZeroStack => "inbox-zero-stack",
            Self::SpotifyPlayback => "spotify-playback",
            Self::Cliproxy => "cliproxy",
            Self::Quartz => "quartz",
            Self::UiTars => "ui-tars",
            Self::Cad => "cad",
            Self::Colpali => "colpali",
            Self::Humanizer => "humanizer",
            Self::Voicebox => "voicebox",
            Self::Scriberr => "scriberr",
            Self::DeepResearch => "deep-research",
            Self::DeerFlow => "deer-flow",
            Self::VibeTrading => "vibe-trading",
            Self::StockAnalyst => "stock-analyst",
            Self::SolidworksMcp => "solidworks-mcp",
        }
    }

    pub const fn source(self) -> TrustedServiceEnvironmentSource {
        match self {
            Self::Chatmock => TrustedServiceEnvironmentSource::Chatmock,
            Self::Comfyui => TrustedServiceEnvironmentSource::Comfyui,
            Self::Dashboard => TrustedServiceEnvironmentSource::Dashboard,
            Self::Gbrain => TrustedServiceEnvironmentSource::Gbrain,
            Self::Hermes => TrustedServiceEnvironmentSource::Hermes,
            Self::TelegramGateway => TrustedServiceEnvironmentSource::TelegramGateway,
            Self::WhatsappGateway => TrustedServiceEnvironmentSource::WhatsappGateway,
            Self::Openwork => TrustedServiceEnvironmentSource::Openwork,
            Self::Openscience => TrustedServiceEnvironmentSource::Openscience,
            Self::MoneyPrinter => TrustedServiceEnvironmentSource::MoneyPrinter,
            Self::Wardrobe => TrustedServiceEnvironmentSource::Wardrobe,
            Self::Penecho => TrustedServiceEnvironmentSource::Penecho,
            Self::VlmOcr => TrustedServiceEnvironmentSource::VlmOcr,
            Self::Recall => TrustedServiceEnvironmentSource::Recall,
            Self::Mem0SemanticEngine => TrustedServiceEnvironmentSource::Mem0SemanticEngine,
            Self::LocalMcpBroker => TrustedServiceEnvironmentSource::LocalMcpBroker,
            Self::PostizCoordinator => TrustedServiceEnvironmentSource::PostizCoordinator,
            Self::InboxZeroStack => TrustedServiceEnvironmentSource::InboxZeroStack,
            Self::SpotifyPlayback => TrustedServiceEnvironmentSource::SpotifyPlayback,
            Self::Cliproxy => TrustedServiceEnvironmentSource::Cliproxy,
            Self::Quartz => TrustedServiceEnvironmentSource::Quartz,
            Self::UiTars => TrustedServiceEnvironmentSource::UiTars,
            Self::Cad => TrustedServiceEnvironmentSource::Cad,
            Self::Colpali => TrustedServiceEnvironmentSource::Colpali,
            Self::Humanizer => TrustedServiceEnvironmentSource::Humanizer,
            Self::Voicebox => TrustedServiceEnvironmentSource::Voicebox,
            Self::Scriberr => TrustedServiceEnvironmentSource::Scriberr,
            Self::DeepResearch => TrustedServiceEnvironmentSource::DeepResearch,
            Self::DeerFlow => TrustedServiceEnvironmentSource::DeerFlow,
            Self::VibeTrading => TrustedServiceEnvironmentSource::VibeTrading,
            Self::StockAnalyst => TrustedServiceEnvironmentSource::StockAnalyst,
            Self::SolidworksMcp => TrustedServiceEnvironmentSource::SolidworksMcp,
        }
    }

    fn from_service_id(service_id: &str) -> Option<Self> {
        match service_id {
            "chatmock" => Some(Self::Chatmock),
            "comfyui" => Some(Self::Comfyui),
            "dashboard" => Some(Self::Dashboard),
            "gbrain" => Some(Self::Gbrain),
            "hermes" => Some(Self::Hermes),
            "telegram-gateway" => Some(Self::TelegramGateway),
            "whatsapp-gateway" => Some(Self::WhatsappGateway),
            "openwork" => Some(Self::Openwork),
            "openscience" => Some(Self::Openscience),
            "money-printer" => Some(Self::MoneyPrinter),
            "wardrobe" => Some(Self::Wardrobe),
            "penecho" => Some(Self::Penecho),
            "vlm-ocr" => Some(Self::VlmOcr),
            "recall" => Some(Self::Recall),
            "mem0-semantic-engine" => Some(Self::Mem0SemanticEngine),
            "local-mcp-broker" => Some(Self::LocalMcpBroker),
            "postiz-coordinator" => Some(Self::PostizCoordinator),
            "inbox-zero-stack" => Some(Self::InboxZeroStack),
            "spotify-playback" => Some(Self::SpotifyPlayback),
            "cliproxy" => Some(Self::Cliproxy),
            "quartz" => Some(Self::Quartz),
            "ui-tars" => Some(Self::UiTars),
            "cad" => Some(Self::Cad),
            "colpali" => Some(Self::Colpali),
            "humanizer" => Some(Self::Humanizer),
            "voicebox" => Some(Self::Voicebox),
            "scriberr" => Some(Self::Scriberr),
            "deep-research" => Some(Self::DeepResearch),
            "deer-flow" => Some(Self::DeerFlow),
            "vibe-trading" => Some(Self::VibeTrading),
            "stock-analyst" => Some(Self::StockAnalyst),
            "solidworks-mcp" => Some(Self::SolidworksMcp),
            _ => None,
        }
    }
}

/// One closed, service-specific environment. It is intentionally non-Clone so
/// the authority cannot be copied into an unrelated process launch. Values are
/// never exposed by Debug.
#[must_use = "trusted service environment authority must be retained by its service controller"]
pub struct TrustedServiceEnvironment {
    mode: RuntimeMode,
    profile: TrustedServiceEnvironmentProfile,
    source: TrustedServiceEnvironmentSource,
    pairs: Vec<(OsString, OsString)>,
}

impl TrustedServiceEnvironment {
    pub const fn mode(&self) -> RuntimeMode {
        self.mode
    }

    pub const fn profile(&self) -> TrustedServiceEnvironmentProfile {
        self.profile
    }

    pub const fn source(&self) -> TrustedServiceEnvironmentSource {
        self.source
    }

    /// Only the native process-owner path may inspect the sealed block. Other
    /// crates receive this type only as opaque launch authority.
    pub(crate) fn pairs(&self) -> impl Iterator<Item = (&OsStr, &OsStr)> {
        self.pairs
            .iter()
            .map(|(name, value)| (name.as_os_str(), value.as_os_str()))
    }

    pub(crate) fn value(&self, name: &str) -> Option<&OsStr> {
        self.pairs
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(OsStr::new(name)))
            .map(|(_, value)| value.as_os_str())
    }

    fn mint_for_launch(&self) -> Self {
        Self {
            mode: self.mode,
            profile: self.profile,
            source: self.source,
            pairs: self.pairs.clone(),
        }
    }
}

impl fmt::Debug for TrustedServiceEnvironment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedServiceEnvironment")
            .field("mode", &self.mode)
            .field("profile", &self.profile)
            .field("source", &self.source)
            .field("entry_count", &self.pairs.len())
            .field("values", &"<redacted>")
            .finish()
    }
}

/// The generation-retained source for the closed environment profiles admitted
/// by Runtime V2. It can mint a fresh non-Clone
/// environment for each durable StartTree while keeping the source immutable
/// across idle and failure restarts.
#[must_use = "trusted service environment sources must be retained for the runtime generation"]
pub struct TrustedServiceEnvironmentSet {
    mode: RuntimeMode,
    _shared_temporary: TrustedDirectoryPin,
    chatmock: TrustedServiceEnvironment,
    comfyui: TrustedServiceEnvironment,
    dashboard: TrustedServiceEnvironment,
    gbrain: TrustedServiceEnvironment,
    hermes: TrustedServiceEnvironment,
    telegram_gateway: TrustedServiceEnvironment,
    whatsapp_gateway: TrustedServiceEnvironment,
    openwork: TrustedServiceEnvironment,
    openscience: TrustedServiceEnvironment,
    money_printer: TrustedServiceEnvironment,
    wardrobe: TrustedServiceEnvironment,
    penecho: TrustedServiceEnvironment,
    vlm_ocr: TrustedServiceEnvironment,
    recall: TrustedServiceEnvironment,
    mem0_semantic_engine: TrustedServiceEnvironment,
    local_mcp_broker: TrustedServiceEnvironment,
    postiz_coordinator: TrustedServiceEnvironment,
    inbox_zero_stack: TrustedServiceEnvironment,
    spotify_playback: TrustedServiceEnvironment,
    cliproxy: TrustedServiceEnvironment,
    quartz: TrustedServiceEnvironment,
    ui_tars: TrustedServiceEnvironment,
    cad: TrustedServiceEnvironment,
    colpali: TrustedServiceEnvironment,
    humanizer: TrustedServiceEnvironment,
    voicebox: TrustedServiceEnvironment,
    scriberr: TrustedServiceEnvironment,
    deep_research: TrustedServiceEnvironment,
    deer_flow: TrustedServiceEnvironment,
    vibe_trading: TrustedServiceEnvironment,
    stock_analyst: TrustedServiceEnvironment,
    solidworks_mcp: TrustedServiceEnvironment,
    managed_vlm_ocr: bool,
    managed_scriberr: bool,
}

impl TrustedServiceEnvironmentSet {
    pub fn load(
        mode: RuntimeMode,
        paths: &RuntimePaths,
        config_root: &TrustedDirectoryPin,
        endpoints: &ServiceEndpointMap,
        dashboard_control: DashboardControlEnvironment,
        os_environment: &TrustedOsEnvironment,
    ) -> Result<Self, TrustedServiceEnvironmentError> {
        // Every closed service environment points TEMP/TMP at this exact
        // Runtime-owned directory. Create and retain its handle before any
        // child can launch so compilers and native libraries never receive a
        // nonexistent parent or a replaceable junction.
        let shared_temporary = paths.prepare_data_directory("runtime-v2/temp")?;
        let config = load_required_desktop_config(config_root)?;
        write_runtime_endpoint_receipt(paths, endpoints, &config)?;
        write_hermes_runtime_config(mode, paths, endpoints, os_environment)?;
        let comfyui = build_comfyui_environment(mode, paths, endpoints, os_environment)?;
        let telegram_gateway_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/telegram-gateway/v1",
        );
        let whatsapp_gateway_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/whatsapp-gateway/v1",
        );
        let openwork_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/openwork/v1",
        );
        let openscience_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/openscience/v1",
        );
        let money_printer_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/money-printer/v1",
        );
        let wardrobe_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/wardrobe/v1",
        );
        let penecho_api_key = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/penecho-chatmock/v1",
        );
        let mem0_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/mem0-semantic-engine/v1",
        );
        let local_mcp_broker_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/local-mcp-broker/v1",
        );
        let postiz_coordinator_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/postiz-coordinator/v1",
        );
        let inbox_zero_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/inbox-zero-stack/v1",
        );
        let spotify_playback_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/spotify-playback/v1",
        );
        let solidworks_mcp_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/solidworks-mcp/v1",
        );
        let ui_tars_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/ui-tars/v1",
        );
        let cad_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/cad/v1",
        );
        let colpali_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/colpali/v1",
        );
        let humanizer_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/humanizer/v1",
        );
        let deep_research_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/deep-research/v1",
        );
        let vibe_trading_token = derive_gateway_token(
            dashboard_control.token.as_bytes(),
            b"breadboard-runtime-v2/vibe-trading/v1",
        );
        let cliproxy_api_key = read_or_create_private_service_secret(
            paths,
            "cliproxy/api-key",
            b"breadboard-runtime-v2/cliproxy-api/v1",
            dashboard_control.token.as_bytes(),
        )?;
        let cliproxy_management_key = read_or_create_private_service_secret(
            paths,
            "cliproxy/management-key",
            b"breadboard-runtime-v2/cliproxy-management/v1",
            dashboard_control.token.as_bytes(),
        )?;
        write_cliproxy_runtime_config(
            paths,
            endpoints,
            &cliproxy_api_key,
            &cliproxy_management_key,
        )?;
        let chatmock = build_chatmock_environment(
            mode,
            paths,
            endpoints,
            &cliproxy_api_key,
            &config,
            os_environment,
        )?;
        let vlm_mode = resolve_vlm_ocr_mode(endpoints, os_environment)?;
        let recall_api_key = read_or_create_recall_api_key(paths)?;
        let dashboard = build_dashboard_environment(DashboardEnvironmentInputs {
            mode,
            paths,
            endpoints,
            control: &dashboard_control,
            telegram_gateway_token: &telegram_gateway_token,
            whatsapp_gateway_token: &whatsapp_gateway_token,
            openwork_token: &openwork_token,
            openscience_token: &openscience_token,
            money_printer_token: &money_printer_token,
            wardrobe_token: &wardrobe_token,
            mem0_token: &mem0_token,
            local_mcp_broker_token: &local_mcp_broker_token,
            postiz_coordinator_token: &postiz_coordinator_token,
            inbox_zero_token: &inbox_zero_token,
            spotify_playback_token: &spotify_playback_token,
            solidworks_mcp_token: &solidworks_mcp_token,
            ui_tars_token: &ui_tars_token,
            cad_token: &cad_token,
            colpali_token: &colpali_token,
            humanizer_token: &humanizer_token,
            deep_research_token: &deep_research_token,
            vibe_trading_token: &vibe_trading_token,
            cliproxy_api_key: &cliproxy_api_key,
            cliproxy_management_key: &cliproxy_management_key,
            recall_api_key: &recall_api_key,
            vlm_mode: &vlm_mode,
            os_environment,
            config: &config,
        })?;
        let gbrain = build_gbrain_environment(mode, paths, endpoints, os_environment, &config)?;
        let hermes = build_hermes_environment(mode, paths, endpoints, os_environment, &config)?;
        let telegram_gateway = build_gateway_environment(
            mode,
            TrustedServiceEnvironmentProfile::TelegramGateway,
            &dashboard,
            "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
            &telegram_gateway_token,
        )?;
        let whatsapp_gateway = build_gateway_environment(
            mode,
            TrustedServiceEnvironmentProfile::WhatsappGateway,
            &dashboard,
            "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
            &whatsapp_gateway_token,
        )?;
        let openwork = build_openwork_environment(mode, paths, &openwork_token, os_environment)?;
        let openscience =
            build_openscience_environment(mode, paths, &openscience_token, os_environment)?;
        let money_printer =
            build_money_printer_environment(mode, paths, &money_printer_token, os_environment)?;
        let wardrobe =
            build_wardrobe_environment(mode, paths, endpoints, &wardrobe_token, os_environment)?;
        let penecho =
            build_penecho_environment(mode, paths, endpoints, &penecho_api_key, os_environment)?;
        let vlm_ocr = build_vlm_ocr_environment(mode, paths, endpoints, os_environment, &vlm_mode)?;
        let recall = build_recall_environment(mode, paths, &recall_api_key, os_environment)?;
        let mem0_semantic_engine = build_mem0_semantic_engine_environment(
            mode,
            paths,
            endpoints,
            &mem0_token,
            os_environment,
        )?;
        let local_mcp_broker = build_local_mcp_broker_environment(
            mode,
            paths,
            &local_mcp_broker_token,
            os_environment,
        )?;
        let postiz_coordinator = build_postiz_coordinator_environment(
            mode,
            paths,
            endpoints,
            &dashboard_control,
            &postiz_coordinator_token,
            os_environment,
        )?;
        let inbox_zero_stack = build_inbox_zero_stack_environment(
            mode,
            paths,
            endpoints,
            &dashboard_control,
            &inbox_zero_token,
            os_environment,
        )?;
        let spotify_playback = build_spotify_playback_environment(
            mode,
            paths,
            endpoints,
            &spotify_playback_token,
            os_environment,
        )?;
        let cliproxy = build_cliproxy_environment(
            mode,
            paths,
            endpoints,
            &cliproxy_api_key,
            &cliproxy_management_key,
            os_environment,
            &config,
        )?;
        let quartz = build_quartz_environment(mode, paths, endpoints, os_environment)?;
        let ui_tars = build_ui_tars_environment(
            mode,
            paths,
            endpoints,
            &ui_tars_token,
            os_environment,
            &config,
        )?;
        let cad =
            build_cad_environment(mode, paths, endpoints, &cad_token, os_environment, &config)?;
        let colpali = build_colpali_environment(
            mode,
            paths,
            endpoints,
            &colpali_token,
            os_environment,
            &config,
        )?;
        let humanizer = build_humanizer_environment(
            mode,
            paths,
            endpoints,
            &humanizer_token,
            os_environment,
            &config,
        )?;
        let voicebox = build_voicebox_environment(mode, paths, endpoints, os_environment)?;
        let scriberr = build_scriberr_environment(mode, paths, endpoints, os_environment, &config)?;
        let deep_research = build_deep_research_environment(
            mode,
            paths,
            endpoints,
            &deep_research_token,
            os_environment,
        )?;
        let deer_flow = build_deer_flow_environment(mode, paths, endpoints, os_environment)?;
        let vibe_trading = build_vibe_trading_environment(
            mode,
            paths,
            endpoints,
            &vibe_trading_token,
            os_environment,
        )?;
        let stock_analyst =
            build_stock_analyst_environment(mode, paths, endpoints, os_environment)?;
        let solidworks_mcp = build_solidworks_mcp_environment(
            mode,
            paths,
            endpoints,
            &solidworks_mcp_token,
            os_environment,
        )?;

        Ok(Self {
            mode,
            _shared_temporary: shared_temporary,
            chatmock,
            comfyui,
            dashboard,
            gbrain,
            hermes,
            telegram_gateway,
            whatsapp_gateway,
            openwork,
            openscience,
            money_printer,
            wardrobe,
            penecho,
            vlm_ocr,
            recall,
            mem0_semantic_engine,
            local_mcp_broker,
            postiz_coordinator,
            inbox_zero_stack,
            spotify_playback,
            cliproxy,
            quartz,
            ui_tars,
            cad,
            colpali,
            humanizer,
            voicebox,
            scriberr,
            deep_research,
            deer_flow,
            vibe_trading,
            stock_analyst,
            solidworks_mcp,
            managed_vlm_ocr: vlm_mode.managed,
            managed_scriberr: config.scriberr_enabled && config.scriberr_base_url.is_none(),
        })
    }

    /// Binds an environment to both the service identity and the manifest's
    /// closed environment selector. Each successful call mints one fresh,
    /// opaque launch block; this retained source never hands out its template.
    pub fn prepare_for_launch_profile(
        &self,
        service_id: &str,
        launch_profile: &ServiceLaunchProfile,
    ) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
        let profile =
            TrustedServiceEnvironmentProfile::from_service_id(service_id).ok_or_else(|| {
                TrustedServiceEnvironmentError::UnknownServiceProfile {
                    service_id: service_id.to_string(),
                }
            })?;
        if launch_profile.environment_source != profile.source() {
            return Err(TrustedServiceEnvironmentError::EnvironmentSourceMismatch {
                profile,
                expected: profile.source(),
                actual: launch_profile.environment_source,
            });
        }
        if !launch_profile.modes.contains(&self.mode) {
            return Err(TrustedServiceEnvironmentError::EnvironmentModeMismatch {
                profile,
                mode: self.mode,
            });
        }

        let environment = match profile {
            TrustedServiceEnvironmentProfile::Chatmock => &self.chatmock,
            TrustedServiceEnvironmentProfile::Comfyui => &self.comfyui,
            TrustedServiceEnvironmentProfile::Dashboard => &self.dashboard,
            TrustedServiceEnvironmentProfile::Gbrain => &self.gbrain,
            TrustedServiceEnvironmentProfile::Hermes => &self.hermes,
            TrustedServiceEnvironmentProfile::TelegramGateway => &self.telegram_gateway,
            TrustedServiceEnvironmentProfile::WhatsappGateway => &self.whatsapp_gateway,
            TrustedServiceEnvironmentProfile::Openwork => &self.openwork,
            TrustedServiceEnvironmentProfile::Openscience => &self.openscience,
            TrustedServiceEnvironmentProfile::MoneyPrinter => &self.money_printer,
            TrustedServiceEnvironmentProfile::Wardrobe => &self.wardrobe,
            TrustedServiceEnvironmentProfile::Penecho => &self.penecho,
            TrustedServiceEnvironmentProfile::VlmOcr => &self.vlm_ocr,
            TrustedServiceEnvironmentProfile::Recall => &self.recall,
            TrustedServiceEnvironmentProfile::Mem0SemanticEngine => &self.mem0_semantic_engine,
            TrustedServiceEnvironmentProfile::LocalMcpBroker => &self.local_mcp_broker,
            TrustedServiceEnvironmentProfile::PostizCoordinator => &self.postiz_coordinator,
            TrustedServiceEnvironmentProfile::InboxZeroStack => &self.inbox_zero_stack,
            TrustedServiceEnvironmentProfile::SpotifyPlayback => &self.spotify_playback,
            TrustedServiceEnvironmentProfile::Cliproxy => &self.cliproxy,
            TrustedServiceEnvironmentProfile::Quartz => &self.quartz,
            TrustedServiceEnvironmentProfile::UiTars => &self.ui_tars,
            TrustedServiceEnvironmentProfile::Cad => &self.cad,
            TrustedServiceEnvironmentProfile::Colpali => &self.colpali,
            TrustedServiceEnvironmentProfile::Humanizer => &self.humanizer,
            TrustedServiceEnvironmentProfile::Voicebox => &self.voicebox,
            TrustedServiceEnvironmentProfile::Scriberr => &self.scriberr,
            TrustedServiceEnvironmentProfile::DeepResearch => &self.deep_research,
            TrustedServiceEnvironmentProfile::DeerFlow => &self.deer_flow,
            TrustedServiceEnvironmentProfile::VibeTrading => &self.vibe_trading,
            TrustedServiceEnvironmentProfile::StockAnalyst => &self.stock_analyst,
            TrustedServiceEnvironmentProfile::SolidworksMcp => &self.solidworks_mcp,
        };
        Ok(environment.mint_for_launch())
    }

    /// Performs the dynamic installation checks that cannot be represented by
    /// a caller-independent manifest probe. This remains a closed per-profile
    /// check and is used only before the durable service StartTree transition.
    pub fn validate_service_installation(
        &self,
        service_id: &str,
        paths: &RuntimePaths,
    ) -> Result<(), TrustedServiceEnvironmentError> {
        if service_id != TrustedServiceEnvironmentProfile::VlmOcr.service_id() {
            return Ok(());
        }
        let value = |name: &str| {
            self.vlm_ocr
                .pairs
                .iter()
                .find(|(candidate, _)| candidate.eq_ignore_ascii_case(OsStr::new(name)))
                .map(|(_, value)| value.as_os_str())
        };
        let configured_binary = value("VLM_OCR_SERVER_BINARY")
            .and_then(OsStr::to_str)
            .unwrap_or("llama-server");
        let configured_path = PathBuf::from(configured_binary);
        let binary = if configured_path.is_absolute() {
            configured_path
        } else if configured_path.components().count() == 1 {
            let mut file_name = configured_path.into_os_string();
            if Path::new(&file_name).extension().is_none() {
                file_name.push(".exe");
            }
            paths.runtime_root().join("bin").join(file_name)
        } else {
            return Err(TrustedServiceEnvironmentError::VlmOcrInstallationUnavailable);
        };
        if !binary.is_file() {
            return Err(TrustedServiceEnvironmentError::VlmOcrInstallationUnavailable);
        }
        let model = value("VLM_OCR_MODEL_PATH").map(PathBuf::from);
        let mmproj = value("VLM_OCR_MMPROJ_PATH").map(PathBuf::from);
        match (model, mmproj) {
            (None, None) => {}
            (Some(model), Some(mmproj))
                if model.is_absolute()
                    && mmproj.is_absolute()
                    && model.is_file()
                    && mmproj.is_file() => {}
            _ => return Err(TrustedServiceEnvironmentError::VlmOcrInstallationUnavailable),
        }
        Ok(())
    }
}

impl fmt::Debug for TrustedServiceEnvironmentSet {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedServiceEnvironmentSet")
            .field("mode", &self.mode)
            .field(
                "profiles",
                &[
                    "chatmock",
                    "comfyui",
                    "dashboard",
                    "gbrain",
                    "hermes",
                    "telegram-gateway",
                    "whatsapp-gateway",
                    "openwork",
                    "openscience",
                    "money-printer",
                    "wardrobe",
                    "penecho",
                    "vlm-ocr",
                    "recall",
                    "mem0-semantic-engine",
                    "local-mcp-broker",
                    "postiz-coordinator",
                    "inbox-zero-stack",
                    "spotify-playback",
                ],
            )
            .field("values", &"<redacted>")
            .finish()
    }
}

/// One sealed environment profile for a finite disposable worker. Runtime
/// selects the source from the validated worker manifest; dashboard/job input
/// data can never add process environment entries.
#[must_use = "trusted worker environment authority must be retained by the worker dispatcher"]
pub struct TrustedWorkerEnvironment {
    mode: RuntimeMode,
    source: TrustedWorkerEnvironmentSource,
    pairs: Vec<(OsString, OsString)>,
}

impl TrustedWorkerEnvironment {
    pub const fn mode(&self) -> RuntimeMode {
        self.mode
    }

    pub const fn source(&self) -> TrustedWorkerEnvironmentSource {
        self.source
    }

    pub(crate) fn pairs(&self) -> impl Iterator<Item = (&OsStr, &OsStr)> {
        self.pairs
            .iter()
            .map(|(name, value)| (name.as_os_str(), value.as_os_str()))
    }

    fn mint_for_launch(&self) -> Self {
        Self {
            mode: self.mode,
            source: self.source,
            pairs: self.pairs.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn minimal_for_test() -> Self {
        Self {
            mode: RuntimeMode::Lean,
            source: TrustedWorkerEnvironmentSource::Minimal,
            pairs: vec![(OsString::from("SystemRoot"), OsString::from(r"C:\Windows"))],
        }
    }
}

impl fmt::Debug for TrustedWorkerEnvironment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedWorkerEnvironment")
            .field("mode", &self.mode)
            .field("source", &self.source)
            .field("entry_count", &self.pairs.len())
            .field("values", &"<redacted>")
            .finish()
    }
}

#[must_use = "trusted worker environment sources must be retained for the runtime generation"]
pub struct TrustedWorkerEnvironmentSet {
    mode: RuntimeMode,
    minimal: TrustedWorkerEnvironment,
    background: TrustedWorkerEnvironment,
    document_ingestion: TrustedWorkerEnvironment,
    audio_analyzer: TrustedWorkerEnvironment,
    image_search_google: TrustedWorkerEnvironment,
    interactive_visualizer: TrustedWorkerEnvironment,
    quartz_publish: TrustedWorkerEnvironment,
    managed_setup: TrustedWorkerEnvironment,
    terminal: TrustedWorkerEnvironment,
    code_index: TrustedWorkerEnvironment,
    agent_edits: TrustedWorkerEnvironment,
    outer_opencode: TrustedWorkerEnvironment,
    trading_agent: TrustedWorkerEnvironment,
    outer_career_ops: TrustedWorkerEnvironment,
    outer_openexecutive: TrustedWorkerEnvironment,
    system_location: TrustedWorkerEnvironment,
    chatmock: TrustedWorkerEnvironment,
    vimax: TrustedWorkerEnvironment,
    vox_director: TrustedWorkerEnvironment,
    outer_shorts: TrustedWorkerEnvironment,
    outer_open_gym: TrustedWorkerEnvironment,
    agent_reach_setup: TrustedWorkerEnvironment,
    gbrain_sync: TrustedWorkerEnvironment,
    outer_agent_reach: TrustedWorkerEnvironment,
    agent_browser_profile: TrustedWorkerEnvironment,
    agent_tars: TrustedWorkerEnvironment,
    outer_legal: TrustedWorkerEnvironment,
    sf3d: TrustedWorkerEnvironment,
    outer_codex: TrustedWorkerEnvironment,
    outer_ruflo: TrustedWorkerEnvironment,
    outer_deep_tutor: TrustedWorkerEnvironment,
    deep_tutor_maintenance: TrustedWorkerEnvironment,
    outer_openplanter: TrustedWorkerEnvironment,
    manim: TrustedWorkerEnvironment,
    premortem: TrustedWorkerEnvironment,
    agent_loop: TrustedWorkerEnvironment,
    omh: TrustedWorkerEnvironment,
    factcheck: TrustedWorkerEnvironment,
    watch_media: TrustedWorkerEnvironment,
    loopx: TrustedWorkerEnvironment,
    resource2skill: TrustedWorkerEnvironment,
    outer_matraix: TrustedWorkerEnvironment,
    formsmith: TrustedWorkerEnvironment,
    hyperframes: TrustedWorkerEnvironment,
    openmontage: TrustedWorkerEnvironment,
    outer_bolt_slides: TrustedWorkerEnvironment,
    subsai: TrustedWorkerEnvironment,
    speech_media: TrustedWorkerEnvironment,
    generated_visual_browser: TrustedWorkerEnvironment,
    scriberr_garden: TrustedWorkerEnvironment,
    watermark: TrustedWorkerEnvironment,
    outer_hardware_blueprint: TrustedWorkerEnvironment,
    get_doc: TrustedWorkerEnvironment,
    get_doc_download: TrustedWorkerEnvironment,
    meeting_notes: TrustedWorkerEnvironment,
    outer_inbox_zero: TrustedWorkerEnvironment,
    outer_socials_manager: TrustedWorkerEnvironment,
    outer_max_research: TrustedWorkerEnvironment,
    outer_wardrobe: TrustedWorkerEnvironment,
    outer_parametric_cad: TrustedWorkerEnvironment,
    outer_stock_analyst: TrustedWorkerEnvironment,
    outer_vibe_trading: TrustedWorkerEnvironment,
    outer_deer_flow: TrustedWorkerEnvironment,
    outer_money_printer: TrustedWorkerEnvironment,
    outer_video_use: TrustedWorkerEnvironment,
    outer_deep_research: TrustedWorkerEnvironment,
    outer_openscience: TrustedWorkerEnvironment,
    outer_openwork: TrustedWorkerEnvironment,
    managed_vlm_ocr: bool,
    managed_scriberr: bool,
}

impl TrustedWorkerEnvironmentSet {
    pub fn from_service_environments(
        mode: RuntimeMode,
        services: &TrustedServiceEnvironmentSet,
        paths: &RuntimePaths,
        os_environment: &TrustedOsEnvironment,
    ) -> Self {
        let minimal = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Minimal,
            pairs: vec![(
                OsString::from(REQUIRED_OS_ENVIRONMENT_NAME),
                os_environment.system_root.clone(),
            )],
        };
        let excluded = [
            "PORT",
            "HOSTNAME",
            "BREADBOARD_DASHBOARD_BUNDLER",
            "BREADBOARD_SUPERVISOR_CONTROL_URL",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "BREADBOARD_TELEGRAM_GATEWAY_URL",
            "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
            "BREADBOARD_WHATSAPP_GATEWAY_URL",
            "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
            "BREADBOARD_OPENWORK_SERVICE_URL",
            "BREADBOARD_OPENWORK_SERVICE_TOKEN",
            "BREADBOARD_OPENSCIENCE_SERVICE_URL",
            "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
            "BREADBOARD_MONEY_PRINTER_SERVICE_URL",
            "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
            "BREADBOARD_WARDROBE_SERVICE_URL",
            "BREADBOARD_WARDROBE_SERVICE_TOKEN",
            "BREADBOARD_MEM0_SERVICE_URL",
            "BREADBOARD_MEM0_SERVICE_TOKEN",
            "BREADBOARD_LOCAL_MCP_BROKER_URL",
            "BREADBOARD_LOCAL_MCP_BROKER_TOKEN",
            "BREADBOARD_LOCAL_MCP_REGISTRY_ROOT",
            "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL",
            "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN",
            "BREADBOARD_INBOX_ZERO_SERVICE_URL",
            "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN",
            "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_URL",
            "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN",
            "BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED",
            "BREADBOARD_SOLIDWORKS_SERVICE_URL",
            "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN",
            "BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED",
            "BREADBOARD_SOLIDWORKS_HOME",
            "BREADBOARD_SOLIDWORKS_WORKSPACE",
            "BREADBOARD_SOLIDWORKS_MCP_PATH",
            "BREADBOARD_SOLIDWORKS_PYTHON",
            "BREADBOARD_UV_PATH",
            "BREADBOARD_SOLIDWORKS_EXE",
            "BREADBOARD_SOLIDWORKS_VERSION",
            "WARDROBE_ROOT",
            "WARDROBE_RUNTIME_ROOT",
            "WARDROBE_DATA_DIR",
            "WARDROBE_MODEL_REFERENCE",
            "PENECHO_URL",
            "PENECHO_PORT",
            "BREADBOARD_PENECHO_RUNTIME_MANAGED",
        ];
        let background = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Background,
            pairs: services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    !name.to_string_lossy().starts_with("VLM_OCR_")
                        && !name.to_string_lossy().starts_with("RECALL_")
                        && !excluded
                            .iter()
                            .any(|excluded| name.eq_ignore_ascii_case(OsStr::new(excluded)))
                })
                .cloned()
                .collect(),
        };
        let document_ingestion_names = [
            "VLM_OCR_ENABLED",
            "VLM_OCR_BASE_URL",
            "VLM_OCR_API_KEY",
            "VLM_OCR_MODEL",
            "VLM_OCR_AUTO_START",
            "VLM_OCR_RUNTIME_MANAGED",
            "VLM_OCR_REQUEST_TIMEOUT_MS",
            "VLM_OCR_MAX_TOKENS",
            "VLM_OCR_TEMPERATURE",
            "VLM_OCR_TOP_P",
            "VLM_OCR_TOP_K",
            "VLM_OCR_REPEAT_PENALTY",
            "VLM_OCR_PAGE_IMAGE_WIDTH",
            "VLM_OCR_MAX_PAGES",
            "VLM_OCR_CONCURRENCY",
        ];
        let mut document_ingestion_pairs = minimal.pairs.clone();
        document_ingestion_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    document_ingestion_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        let document_ingestion = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::DocumentIngestion,
            pairs: document_ingestion_pairs,
        };
        let mut audio_analyzer_pairs = minimal.pairs.clone();
        audio_analyzer_pairs.push((
            OsString::from("BREADBOARD_AUDIO_ANALYZER_SERVER"),
            paths
                .data_root()
                .join("runtime-v2")
                .join("audio-analyzer")
                .join("bin")
                .join("mcp-server.exe")
                .into_os_string(),
        ));
        audio_analyzer_pairs.push((
            OsString::from("BREADBOARD_AUDIO_ANALYZER_TIMEOUT_MS"),
            OsString::from("600000"),
        ));
        let audio_analyzer = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::AudioAnalyzer,
            pairs: audio_analyzer_pairs,
        };
        let mut image_search_pairs = minimal.pairs.clone();
        image_search_pairs.push((
            OsString::from("BREADBOARD_DATA_DIR"),
            paths.data_root().as_os_str().to_os_string(),
        ));
        let image_search_google = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::ImageSearchGoogle,
            pairs: image_search_pairs,
        };
        let mut interactive_visualizer_pairs = minimal.pairs.clone();
        for name in [
            "BREADBOARD_VISUAL_BROWSER_PATH",
            "INTERACTIVE_VISUALIZER_ENABLED",
            "INTERACTIVE_VISUALIZER_BROWSER_TESTS",
            "INTERACTIVE_VISUALIZER_THREE_ENABLED",
            "INTERACTIVE_VISUALIZER_MAX_ATTEMPTS",
            "INTERACTIVE_VISUALIZER_MAX_SOURCE_BYTES",
            "INTERACTIVE_VISUALIZER_MAX_BUNDLE_BYTES",
            "INTERACTIVE_VISUALIZER_MAX_ARTIFACT_BYTES",
            "INTERACTIVE_VISUALIZER_BROWSER_TIMEOUT_MS",
            "INTERACTIVE_VISUALIZER_MAX_THREE_OBJECTS",
            "INTERACTIVE_VISUALIZER_MAX_VERTICES",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                interactive_visualizer_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let interactive_visualizer = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::InteractiveVisualizer,
            pairs: interactive_visualizer_pairs,
        };
        let mut generated_visual_browser_pairs = minimal.pairs.clone();
        if let Some(value) =
            product_environment_value(os_environment, "BREADBOARD_VISUAL_BROWSER_PATH")
        {
            generated_visual_browser_pairs.push((
                OsString::from("BREADBOARD_VISUAL_BROWSER_PATH"),
                value.to_os_string(),
            ));
        }
        let generated_visual_browser = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::GeneratedVisualBrowser,
            pairs: generated_visual_browser_pairs,
        };
        let mut scriberr_garden_pairs = minimal.pairs.clone();
        let scriberr_source_root = match mode {
            RuntimeMode::Packaged => paths
                .app_root()
                .join("dashboard-standalone")
                .join("dashboard")
                .join("worker-src"),
            RuntimeMode::Lean | RuntimeMode::Hot => paths.app_root().join("dashboard").join("src"),
        };
        let quartz_source_root = match mode {
            RuntimeMode::Packaged => paths.app_root().join("quartz-template"),
            RuntimeMode::Lean | RuntimeMode::Hot => paths.app_root().to_path_buf(),
        };
        for (name, value) in [
            ("BREADBOARD_DATA_DIR", paths.data_root().to_path_buf()),
            ("BREADBOARD_REPO_ROOT", quartz_source_root),
            ("BREADBOARD_SCRIBERR_SOURCE_ROOT", scriberr_source_root),
            (
                "YTDLP_PATH",
                paths.runtime_root().join("bin").join("yt-dlp.exe"),
            ),
            (
                "FFMPEG_PATH",
                paths.runtime_root().join("bin").join("ffmpeg.exe"),
            ),
            (
                "FFPROBE_PATH",
                paths.runtime_root().join("bin").join("ffprobe.exe"),
            ),
        ] {
            scriberr_garden_pairs.push((OsString::from(name), value.into_os_string()));
        }
        let dashboard_scriberr_names = [
            "VIDEO_TRANSCRIPTION_ENABLED",
            "NODE_ENV",
            "SCRIBERR_BASE_URL",
            "SCRIBERR_USERNAME",
            "SCRIBERR_PASSWORD",
            "CHATMOCK_BASE_URL",
            "CHATMOCK_MODEL",
            "BREADBOARD_DASHBOARD_URL",
            "CI",
            "DASHBOARD_URL",
            "NEXT_PUBLIC_DASHBOARD_URL",
            "NEXT_PUBLIC_PENECHO_URL",
            "NEXT_PUBLIC_QUARTZ_URL",
            "PENECHO_URL",
            "QUARTZ_BASE_URL",
            "QUARTZ_CUSTOM_OG_IMAGES",
            "SECOND_BRAIN_ASSET_VERSION",
            "SHOW_LEGACY_SUBTOPIC_PAGES",
            "TERM",
            "QUARTZ_AUTO_PUBLISH",
            "QUARTZ_PUBLISH_MODE",
            "QUARTZ_BUILD_CONCURRENCY",
            "QUARTZ_BUILD_TIMEOUT_MS",
        ];
        scriberr_garden_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    dashboard_scriberr_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        scriberr_garden_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "SCRIBERR_REQUEST_TIMEOUT_MS",
            "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS",
            "SCRIBERR_POLL_INTERVAL_MS",
            "SCRIBERR_MODEL_FAMILY",
            "SCRIBERR_MODEL",
            "SCRIBERR_LANGUAGE",
            "SCRIBERR_DIARIZATION",
            "VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS",
            "VIDEO_TRANSCRIPTION_KEEP_MEDIA",
            "VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB",
            "VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS",
            "VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS",
            "YTDLP_DOWNLOAD_TIMEOUT_MS",
            "VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                scriberr_garden_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        if !services.managed_scriberr {
            if let Some(value) = product_environment_value(os_environment, "SCRIBERR_API_TOKEN") {
                scriberr_garden_pairs
                    .push((OsString::from("SCRIBERR_API_TOKEN"), value.to_os_string()));
            }
        }
        let scriberr_garden = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::ScriberrGarden,
            pairs: scriberr_garden_pairs,
        };
        let watermark = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Watermark,
            pairs: vec![
                (
                    OsString::from(REQUIRED_OS_ENVIRONMENT_NAME),
                    os_environment.system_root.clone(),
                ),
                (
                    OsString::from("BREADBOARD_WATERMARKS_PYTHON"),
                    paths
                        .runtime_root()
                        .join("runtimes")
                        .join("python")
                        .join("python.exe")
                        .into_os_string(),
                ),
                (
                    OsString::from("BREADBOARD_WATERMARKS_SCRIPTS_ROOT"),
                    paths
                        .app_root()
                        .join("watermarks-remover")
                        .join("skills")
                        .join("remove-ai-marks")
                        .join("scripts")
                        .into_os_string(),
                ),
            ],
        };
        let mut quartz_publish_pairs = minimal.pairs.clone();
        quartz_publish_pairs.push((
            OsString::from("BREADBOARD_QUARTZ_SOURCE_ROOT"),
            match mode {
                RuntimeMode::Packaged => paths.app_root().join("quartz-template"),
                RuntimeMode::Lean | RuntimeMode::Hot => paths.app_root().join("quartz"),
            }
            .into_os_string(),
        ));
        let quartz_publish = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::QuartzPublish,
            pairs: quartz_publish_pairs,
        };
        let tool_names = [
            "SystemRoot",
            "PATH",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "PROGRAMDATA",
            "SystemDrive",
            "PROGRAMFILES",
            "PROGRAMFILES(X86)",
            "ComSpec",
            "PATHEXT",
        ];
        let tool_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                tool_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        let terminal = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Terminal,
            pairs: tool_pairs.clone(),
        };
        let system_location_names = [
            "SystemRoot",
            "SystemDrive",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "PROGRAMDATA",
            "ComSpec",
            "PATHEXT",
        ];
        let mut system_location_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                system_location_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        system_location_pairs.push((
            OsString::from("BREADBOARD_WINDOWS_POWERSHELL_BIN"),
            PathBuf::from(&os_environment.system_root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe")
                .into_os_string(),
        ));
        system_location_pairs.push((
            OsString::from("BREADBOARD_RUNTIME_V2_FIXED_TOOLS"),
            OsString::from("1"),
        ));
        let system_location = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::SystemLocation,
            pairs: system_location_pairs,
        };
        let mut code_index_pairs = tool_pairs.clone();
        code_index_pairs.push((
            OsString::from("BREADBOARD_GRAFT_CLI"),
            graft_cli_path(mode, paths, os_environment).into_os_string(),
        ));
        let code_index = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::CodeIndex,
            pairs: code_index_pairs,
        };
        let mut agent_edits_pairs = tool_pairs.clone();
        agent_edits_pairs.push((
            OsString::from("BREADBOARD_GIT_BIN"),
            git_binary_path(mode, paths, os_environment).into_os_string(),
        ));
        agent_edits_pairs.push((
            OsString::from("BREADBOARD_RUNTIME_V2_FIXED_TOOLS"),
            OsString::from("1"),
        ));
        let agent_edits = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::AgentEdits,
            pairs: agent_edits_pairs,
        };
        let mut outer_opencode_pairs = tool_pairs.clone();
        for (name, value) in [
            ("OPENCODE_BIN", opencode_binary_path(mode, paths)),
            ("OPENCODE_ROOT", paths.app_root().join("opencode")),
            (
                "BREADBOARD_OPENCODE_CONFIG",
                paths
                    .app_root()
                    .join("opencode-config")
                    .join("opencode.json"),
            ),
            (
                "BREADBOARD_GRAFT_CLI",
                graft_cli_path(mode, paths, os_environment),
            ),
            (
                "BREADBOARD_GRAFT_HOME",
                paths.data_root().join("runtime-v2").join("graft"),
            ),
            (
                "BREADBOARD_GIT_BIN",
                git_binary_path(mode, paths, os_environment),
            ),
        ] {
            outer_opencode_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_opencode_pairs.push((
            OsString::from("BREADBOARD_RUNTIME_V2_FIXED_TOOLS"),
            OsString::from("1"),
        ));
        outer_opencode_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        let outer_opencode = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterOpencode,
            pairs: outer_opencode_pairs,
        };
        let mut trading_agent_pairs = tool_pairs.clone();
        for (name, value) in [
            ("BREADBOARD_DATA_DIR", paths.data_root().to_path_buf()),
            ("BREADBOARD_REPO_ROOT", paths.app_root().to_path_buf()),
            ("TRADINGAGENTS_ROOT", paths.app_root().join("tradingagents")),
            (
                "TRADINGAGENTS_CREDENTIALS_FILE",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("services")
                    .join("tradingagents")
                    .join("credentials.json"),
            ),
        ] {
            trading_agent_pairs.push((OsString::from(name), value.into_os_string()));
        }
        trading_agent_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                trading_agent_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let trading_agent = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::TradingAgent,
            pairs: trading_agent_pairs,
        };
        let mut outer_career_ops_pairs = tool_pairs.clone();
        for (name, value) in [
            ("BREADBOARD_DATA_DIR", paths.data_root().to_path_buf()),
            ("BREADBOARD_REPO_ROOT", paths.app_root().to_path_buf()),
            ("CAREER_OPS_ROOT", paths.app_root().join("career-ops")),
            (
                "PLAYWRIGHT_BROWSERS_PATH",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("toolchains")
                    .join("career-ops-browsers"),
            ),
        ] {
            outer_career_ops_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_career_ops_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_career_ops_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_career_ops = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterCareerOps,
            pairs: outer_career_ops_pairs,
        };
        let mut outer_openexecutive_pairs = tool_pairs.clone();
        for (name, value) in [
            ("BREADBOARD_DATA_DIR", paths.data_root().to_path_buf()),
            ("BREADBOARD_REPO_ROOT", paths.app_root().to_path_buf()),
            ("OPENEXECUTIVE_ROOT", paths.app_root().join("OpenExecutive")),
        ] {
            outer_openexecutive_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_openexecutive_pairs
            .push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_openexecutive_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_openexecutive = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterOpenExecutive,
            pairs: outer_openexecutive_pairs,
        };
        let mut chatmock_pairs = tool_pairs.clone();
        chatmock_pairs.push((
            OsString::from("CODEX_HOME"),
            codex_home(mode, paths).into_os_string(),
        ));
        let chatmock = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Chatmock,
            pairs: chatmock_pairs,
        };
        let mut vimax_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "BREADBOARD_RUNTIME_V2_APP_ROOT",
                paths.app_root().to_path_buf(),
            ),
            (
                "BREADBOARD_RUNTIME_V2_VIMAX_FFMPEG_PATH",
                paths.runtime_root().join("bin").join("ffmpeg.exe"),
            ),
        ] {
            vimax_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [("CHATMOCK_API_KEY", "local"), ("OPENAI_API_KEY", "local")] {
            vimax_pairs.push((OsString::from(name), OsString::from(value)));
        }
        if let Some(value) = product_environment_value(os_environment, "VIMAX_IMAGE_MODEL") {
            vimax_pairs.push((OsString::from("VIMAX_IMAGE_MODEL"), value.to_os_string()));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                vimax_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let vimax = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Vimax,
            pairs: vimax_pairs,
        };
        let mut vox_director_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "BREADBOARD_RUNTIME_V2_APP_ROOT",
                paths.app_root().to_path_buf(),
            ),
            (
                "BREADBOARD_RUNTIME_V2_VOX_ROOT",
                paths.app_root().join("vox-director"),
            ),
            (
                "BREADBOARD_RUNTIME_V2_VOX_PYTHON_PATH",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join("python.exe"),
            ),
            (
                "BREADBOARD_RUNTIME_V2_VOX_FFMPEG_PATH",
                paths.runtime_root().join("bin").join("ffmpeg.exe"),
            ),
            (
                "BREADBOARD_RUNTIME_V2_VOX_FFPROBE_PATH",
                paths.runtime_root().join("bin").join("ffprobe.exe"),
            ),
        ] {
            vox_director_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [("CHATMOCK_API_KEY", "local"), ("OPENAI_API_KEY", "local")] {
            vox_director_pairs.push((OsString::from(name), OsString::from(value)));
        }
        if let Some(value) = product_environment_value(os_environment, "VOX_DIRECTOR_MUSIC_DIR") {
            vox_director_pairs.push((
                OsString::from("BREADBOARD_RUNTIME_V2_VOX_MUSIC_DIR"),
                value.to_os_string(),
            ));
        }
        let vox_runtime_names = [
            "BREADBOARD_RUNTIME_V2_ACTIVE",
            "BREADBOARD_SUPERVISOR_CONTROL_URL",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "COMFYUI_ENABLED",
            "COMFYUI_MANAGED",
            "COMFYUI_PORT",
            "COMFYUI_URL",
            "COMFYUI_ROOT",
            "COMFYUI_ENV_DIR",
            "COMFYUI_RUNTIME_DIR",
            "COMFYUI_START_TIMEOUT_MS",
            "COMFYUI_GENERATE_TIMEOUT_MS",
            "VOICEBOX_BASE_URL",
            "VOICEBOX_STATUS_PATH",
        ];
        vox_director_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    vox_runtime_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                vox_director_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let vox_director = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::VoxDirector,
            pairs: vox_director_pairs,
        };
        let mut outer_shorts_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "SHORTS_ROOT",
                paths.app_root().join("AI-Youtube-Shorts-Generator"),
            ),
            (
                "SHORTS_PYTHON",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("services")
                    .join("shorts")
                    .join(".venv")
                    .join("Scripts")
                    .join("python.exe"),
            ),
            (
                "BREADBOARD_RUNTIME_V2_VIMAX_FFMPEG_PATH",
                paths.runtime_root().join("bin").join("ffmpeg.exe"),
            ),
        ] {
            outer_shorts_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_shorts_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        if let Some(value) = product_environment_value(os_environment, "SHORTS_WHISPER_DEVICE") {
            outer_shorts_pairs.push((
                OsString::from("SHORTS_WHISPER_DEVICE"),
                value.to_os_string(),
            ));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_shorts_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_shorts = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterShorts,
            pairs: outer_shorts_pairs,
        };
        let mut outer_open_gym_pairs = tool_pairs.clone();
        for (name, value) in [
            ("OPEN_GYM_ROOT", paths.app_root().join("openGym")),
            (
                "OPEN_GYM_AGENT_DATA_DIR",
                paths.data_root().join("open-gym-agent").join("state"),
            ),
            (
                "OPEN_GYM_MEDIA_CACHE_DIR",
                paths
                    .data_root()
                    .join("open-gym-agent")
                    .join("media")
                    .join("gif"),
            ),
        ] {
            outer_open_gym_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_open_gym_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_open_gym_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_open_gym = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterOpenGym,
            pairs: outer_open_gym_pairs,
        };
        let mut agent_reach_setup_pairs = tool_pairs.clone();
        if let Some(browser_home) = agent_reach_setup_pairs
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new("USERPROFILE")))
            .map(|(_, value)| value.clone())
        {
            agent_reach_setup_pairs.push((
                OsString::from("BREADBOARD_AGENT_REACH_BROWSER_HOME"),
                browser_home,
            ));
        }
        if let Some(value) = product_environment_value(os_environment, "DOCKER_CLI_PATH") {
            agent_reach_setup_pairs.push((OsString::from("DOCKER_CLI_PATH"), value.to_os_string()));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                agent_reach_setup_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let agent_reach_setup = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::AgentReachSetup,
            pairs: agent_reach_setup_pairs,
        };
        let gbrain_sync_names = [
            "GBRAIN_MODE",
            "GBRAIN_ADAPTER_URL",
            "GBRAIN_ADAPTER_SECRET",
            "OPENAI_BASE_URL",
            "OPENAI_API_KEY",
        ];
        let mut gbrain_sync_pairs = minimal.pairs.clone();
        gbrain_sync_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    gbrain_sync_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        gbrain_sync_pairs.push((
            OsString::from("GBRAIN_QUERY_TIMEOUT_MS"),
            OsString::from("1500000"),
        ));
        let gbrain_sync = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::GbrainSync,
            pairs: gbrain_sync_pairs,
        };
        let system_root = PathBuf::from(&os_environment.system_root);
        let mut outer_agent_reach_pairs = tool_pairs.clone();
        let agent_reach_path = join_closed_windows_path(&[
            paths
                .data_root()
                .join("runtime-v2/services/agent-reach/.venv/Scripts")
                .as_path(),
            paths
                .data_root()
                .join("runtime-v2/toolchains/agent-reach/tools/bin")
                .as_path(),
            paths
                .data_root()
                .join("runtime-v2/toolchains/agent-reach/npm")
                .as_path(),
            paths.runtime_root().join("bin").as_path(),
            paths.runtime_root().join("runtimes/node").as_path(),
            paths.runtime_root().join("runtimes/python").as_path(),
            system_root.join("System32").as_path(),
            system_root
                .join("System32/WindowsPowerShell/v1.0")
                .as_path(),
            system_root.as_path(),
        ])
        .expect("validated Runtime paths produce a closed Agent Reach PATH");
        if let Some((_, value)) = outer_agent_reach_pairs
            .iter_mut()
            .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new("PATH")))
        {
            *value = agent_reach_path;
        }
        outer_agent_reach_pairs.push((
            OsString::from("BREADBOARD_DATA_DIR"),
            paths.data_root().as_os_str().to_os_string(),
        ));
        outer_agent_reach_pairs.push((
            OsString::from("AGENT_BROWSER_EXECUTABLE_PATH"),
            agent_browser_executable_path(paths, os_environment).into_os_string(),
        ));
        outer_agent_reach_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_agent_reach_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_agent_reach = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterAgentReach,
            pairs: outer_agent_reach_pairs,
        };
        let mut agent_browser_profile_pairs = tool_pairs.clone();
        agent_browser_profile_pairs.push((
            OsString::from("BREADBOARD_AGENT_BROWSER_PROFILE_BROWSER_PATH"),
            agent_browser_executable_path(paths, os_environment).into_os_string(),
        ));
        let agent_reach_npm = paths
            .data_root()
            .join("runtime-v2/toolchains/agent-reach/npm");
        let opencli_path = if cfg!(windows) {
            agent_reach_npm.join("opencli.cmd")
        } else {
            agent_reach_npm.join("bin/opencli")
        };
        agent_browser_profile_pairs.push((
            OsString::from("BREADBOARD_AGENT_BROWSER_PROFILE_OPENCLI_PATH"),
            opencli_path.into_os_string(),
        ));
        let profile_tool_path = join_closed_windows_path(&[
            agent_reach_npm.as_path(),
            paths.runtime_root().join("runtimes/node").as_path(),
        ])
        .expect("validated Runtime paths produce a closed browser-profile tool PATH");
        agent_browser_profile_pairs.push((
            OsString::from("BREADBOARD_AGENT_BROWSER_PROFILE_TOOL_PATH"),
            profile_tool_path,
        ));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                agent_browser_profile_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let agent_browser_profile = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::AgentBrowserProfile,
            pairs: agent_browser_profile_pairs,
        };
        let mut agent_tars_pairs = minimal.pairs.clone();
        for (source_name, target_name) in [
            ("UI_TARS_ADAPTER_URL", "BREADBOARD_UI_TARS_SERVICE_URL"),
            ("UI_TARS_ADAPTER_SECRET", "BREADBOARD_UI_TARS_SERVICE_TOKEN"),
        ] {
            if let Some((_, value)) = services
                .dashboard
                .pairs
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new(source_name)))
            {
                agent_tars_pairs.push((OsString::from(target_name), value.to_os_string()));
            }
        }
        let agent_tars = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::AgentTars,
            pairs: agent_tars_pairs,
        };
        let mut outer_legal_pairs = tool_pairs.clone();
        outer_legal_pairs.push((
            OsString::from("HARVEY_LABS_ROOT"),
            paths.app_root().join("harvey-labs").into_os_string(),
        ));
        if let Some(bash) = git_bash_path(os_environment) {
            outer_legal_pairs.push((OsString::from("LEGAL_AGENT_BASH"), bash.into_os_string()));
        }
        outer_legal_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        if let Some((_, user_profile)) = outer_legal_pairs
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new("USERPROFILE")))
            .cloned()
        {
            outer_legal_pairs.push((OsString::from("HOME"), user_profile));
        }
        outer_legal_pairs.push((OsString::from("WINDIR"), os_environment.system_root.clone()));
        outer_legal_pairs.push((OsString::from("LANG"), OsString::from("C.UTF-8")));
        outer_legal_pairs.push((OsString::from("LC_ALL"), OsString::from("C.UTF-8")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_legal_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_legal = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterLegal,
            pairs: outer_legal_pairs,
        };
        let sf3d_state = paths
            .data_root()
            .join("runtime-v2")
            .join("services")
            .join("sf3d");
        let mut sf3d_pairs = tool_pairs.clone();
        for (name, value) in [
            ("SF3D_ROOT", paths.app_root().join("stable-fast-3d")),
            (
                "SF3D_PYTHON",
                sf3d_state.join(".venv").join(if cfg!(windows) {
                    "Scripts/python.exe"
                } else {
                    "bin/python"
                }),
            ),
            ("HF_HOME", sf3d_state.join("huggingface")),
            ("TORCH_HOME", sf3d_state.join("torch")),
            ("XDG_CACHE_HOME", sf3d_state.join("cache")),
        ] {
            sf3d_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [
            ("PYTHONNOUSERSITE", "1"),
            ("PYTHONUTF8", "1"),
            ("PYTHONIOENCODING", "utf-8"),
        ] {
            sf3d_pairs.push((OsString::from(name), OsString::from(value)));
        }
        for name in ["SF3D_DEVICE", "SF3D_PRETRAINED_MODEL"] {
            if let Some(value) = product_environment_value(os_environment, name) {
                sf3d_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        if let Some(timeout) = product_environment_value(os_environment, "SF3D_TIMEOUT_MS")
            .and_then(|value| value.to_str())
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (30_000..=600_000).contains(value))
        {
            sf3d_pairs.push((
                OsString::from("SF3D_TIMEOUT_MS"),
                OsString::from(timeout.to_string()),
            ));
        }
        if let Some(token) = ["HUGGINGFACE_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"]
            .into_iter()
            .find_map(|name| product_environment_value(os_environment, name))
        {
            sf3d_pairs.push((OsString::from("HUGGINGFACE_TOKEN"), token.to_os_string()));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "CUDA_VISIBLE_DEVICES",
            "CUDA_PATH",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                sf3d_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let sf3d = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Sf3d,
            pairs: sf3d_pairs,
        };
        let mut outer_codex_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "CODEX_BIN",
                paths.runtime_root().join("bin").join("codex.exe"),
            ),
            ("CODEX_HOME", codex_home(mode, paths)),
            (
                "BREADBOARD_GRAFT_CLI",
                graft_cli_path(mode, paths, os_environment),
            ),
            (
                "BREADBOARD_GRAFT_HOME",
                paths.data_root().join("runtime-v2").join("graft"),
            ),
            (
                "BREADBOARD_GIT_BIN",
                git_binary_path(mode, paths, os_environment),
            ),
        ] {
            outer_codex_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [
            ("BREADBOARD_RUNTIME_V2_FIXED_TOOLS", "1"),
            ("CHATMOCK_API_KEY", "local"),
        ] {
            outer_codex_pairs.push((OsString::from(name), OsString::from(value)));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_codex_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_codex = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterCodex,
            pairs: outer_codex_pairs,
        };
        let mut outer_ruflo_pairs = tool_pairs.clone();
        for (name, value) in [
            ("RUFLO_ROOT", paths.app_root().join("ruflo")),
            (
                "RUFLO_BIN",
                paths.app_root().join("ruflo").join("bin").join("cli.js"),
            ),
            (
                "RUFLO_CLAUDE_BIN",
                paths.runtime_root().join("bin").join("claude.exe"),
            ),
            (
                "BREADBOARD_GRAFT_CLI",
                graft_cli_path(mode, paths, os_environment),
            ),
            (
                "BREADBOARD_GRAFT_HOME",
                paths.data_root().join("runtime-v2").join("graft"),
            ),
            (
                "BREADBOARD_GIT_BIN",
                git_binary_path(mode, paths, os_environment),
            ),
        ] {
            outer_ruflo_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_ruflo_pairs.push((
            OsString::from("BREADBOARD_RUNTIME_V2_FIXED_TOOLS"),
            OsString::from("1"),
        ));
        if let Some((_, user_profile)) = outer_ruflo_pairs
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new("USERPROFILE")))
            .cloned()
        {
            outer_ruflo_pairs.push((OsString::from("HOME"), user_profile));
        }
        if let Some(model) = product_environment_value(os_environment, "RUFLO_CLAUDE_MODEL") {
            outer_ruflo_pairs.push((OsString::from("RUFLO_CLAUDE_MODEL"), model.to_os_string()));
        }
        if product_environment_value(os_environment, "RUFLO_DANGEROUSLY_SKIP_PERMISSIONS")
            == Some(OsStr::new("1"))
        {
            outer_ruflo_pairs.push((
                OsString::from("RUFLO_DANGEROUSLY_SKIP_PERMISSIONS"),
                OsString::from("1"),
            ));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_ruflo_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_ruflo = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterRuflo,
            pairs: outer_ruflo_pairs,
        };
        let mut outer_deep_tutor_pairs = tool_pairs.clone();
        for (name, value) in [
            ("DEEP_TUTOR_ROOT", paths.app_root().join("DeepTutor")),
            (
                "DEEP_TUTOR_HOME_ROOT",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("services")
                    .join("deep-tutor")
                    .join("home"),
            ),
            (
                "DEEP_TUTOR_NODE",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("node")
                    .join("node.exe"),
            ),
        ] {
            outer_deep_tutor_pairs.push((OsString::from(name), value.into_os_string()));
        }
        outer_deep_tutor_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_deep_tutor_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_deep_tutor = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterDeepTutor,
            pairs: outer_deep_tutor_pairs,
        };
        let mut deep_tutor_maintenance_pairs = tool_pairs.clone();
        for (name, value) in [
            ("DEEP_TUTOR_ROOT", paths.app_root().join("DeepTutor")),
            (
                "DEEP_TUTOR_PYTHON",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("services")
                    .join("deep-tutor")
                    .join(".venv")
                    .join(if cfg!(windows) {
                        "Scripts/python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "DEEP_TUTOR_HOME_ROOT",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("services")
                    .join("deep-tutor")
                    .join("home"),
            ),
            (
                "DEEP_TUTOR_INDEX_SCRIPT",
                paths.app_root().join("scripts").join("deeptutor-index.py"),
            ),
        ] {
            deep_tutor_maintenance_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                deep_tutor_maintenance_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let deep_tutor_maintenance = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::DeepTutorMaintenance,
            pairs: deep_tutor_maintenance_pairs,
        };
        let mut outer_openplanter_pairs = tool_pairs.clone();
        for (name, value) in [
            ("OPENPLANTER_ROOT", paths.app_root().join("OpenPlanter")),
            (
                "OPENPLANTER_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
        ] {
            outer_openplanter_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [
            ("CHATMOCK_API_KEY", "local"),
            ("LANG", "C.UTF-8"),
            ("LC_ALL", "C.UTF-8"),
        ] {
            outer_openplanter_pairs.push((OsString::from(name), OsString::from(value)));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_openplanter_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_openplanter = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterOpenPlanter,
            pairs: outer_openplanter_pairs,
        };
        let mut manim_pairs = tool_pairs.clone();
        manim_pairs.push((
            OsString::from("MANIM_DOCKER_BIN"),
            docker_cli_path(os_environment).into_os_string(),
        ));
        let manim_image = product_environment_value(os_environment, "MANIM_DOCKER_IMAGE")
            .and_then(|value| value.to_str())
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 512
                    && value.bytes().enumerate().all(|(index, byte)| {
                        byte.is_ascii_alphanumeric()
                            || (index > 0
                                && matches!(byte, b'.' | b'_' | b'/' | b'@' | b':' | b'-'))
                    })
            })
            .unwrap_or("manimcommunity/manim:v0.20.1");
        manim_pairs.push((
            OsString::from("MANIM_DOCKER_IMAGE"),
            OsString::from(manim_image),
        ));
        let manim_timeout = product_environment_value(os_environment, "MANIM_TIMEOUT_MS")
            .and_then(|value| value.to_str())
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| (30_000..=360_000).contains(value))
            .unwrap_or(300_000);
        manim_pairs.push((
            OsString::from("MANIM_TIMEOUT_MS"),
            OsString::from(manim_timeout.to_string()),
        ));
        for name in [
            "DOCKER_HOST",
            "DOCKER_CONTEXT",
            "DOCKER_CONFIG",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                manim_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let manim = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Manim,
            pairs: manim_pairs,
        };
        let mut premortem_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                system_location_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        for (name, value) in [
            (
                "BREADBOARD_PREMORTEM_ROOT",
                paths.app_root().join("premortem-runtime").join("source"),
            ),
            (
                "BREADBOARD_PREMORTEM_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "BREADBOARD_PREMORTEM_SITE_PACKAGES",
                paths
                    .app_root()
                    .join("premortem-runtime")
                    .join("site-packages"),
            ),
            ("HERMES_ROOT", hermes_home(mode, paths)),
        ] {
            premortem_pairs.push((OsString::from(name), value.into_os_string()));
        }
        let premortem = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Premortem,
            pairs: premortem_pairs,
        };
        let mut agent_loop_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                system_location_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        for (name, value) in [
            (
                "BREADBOARD_AGENT_LOOP_ROOT",
                paths.app_root().join("agent-loop-runtime").join("source"),
            ),
            (
                "BREADBOARD_AGENT_LOOP_PYTHON",
                paths
                    .app_root()
                    .join("agent-loop-runtime")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "BREADBOARD_AGENT_LOOP_SITE_PACKAGES",
                paths
                    .app_root()
                    .join("agent-loop-runtime")
                    .join("site-packages"),
            ),
            ("HERMES_ROOT", hermes_home(mode, paths)),
        ] {
            agent_loop_pairs.push((OsString::from(name), value.into_os_string()));
        }
        let agent_loop = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::AgentLoop,
            pairs: agent_loop_pairs,
        };
        let mut omh_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                system_location_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        for (name, value) in [
            ("BREADBOARD_OMH_ROOT", paths.app_root().join("oh-my-hermes")),
            (
                "BREADBOARD_OMH_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            ("HERMES_ROOT", hermes_home(mode, paths)),
        ] {
            omh_pairs.push((OsString::from(name), value.into_os_string()));
        }
        let omh = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Omh,
            pairs: omh_pairs,
        };
        let factcheck_os_names = ["SystemRoot", "SystemDrive", "ComSpec", "PATHEXT"];
        let mut factcheck_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                factcheck_os_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        factcheck_pairs.push((OsString::from("WINDIR"), os_environment.system_root.clone()));
        for (name, value) in [
            (
                "BREADBOARD_BULLSHIT_DETECTOR_ROOT",
                paths.app_root().join("bullshit-detector"),
            ),
            (
                "BREADBOARD_FACTCHECK_UV",
                paths
                    .runtime_root()
                    .join("bin")
                    .join(if cfg!(windows) { "uv.exe" } else { "uv" }),
            ),
            (
                "BREADBOARD_FACTCHECK_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "HERMES_ROOT",
                paths.data_root().join("runtime").join("hermes-workspaces"),
            ),
            (
                "UV_CACHE_DIR",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("toolchains")
                    .join("cache")
                    .join("uv"),
            ),
        ] {
            factcheck_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for name in ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE"] {
            if let Some(value) = product_environment_value(os_environment, name) {
                factcheck_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let factcheck = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Factcheck,
            pairs: factcheck_pairs,
        };
        let mut watch_media_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "BREADBOARD_WATCH_ROOT",
                paths
                    .app_root()
                    .join("hermes-skills")
                    .join("prebuilt")
                    .join("watch"),
            ),
            (
                "BREADBOARD_WATCH_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "FFMPEG_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "ffmpeg.exe"
                } else {
                    "ffmpeg"
                }),
            ),
            (
                "FFPROBE_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "ffprobe.exe"
                } else {
                    "ffprobe"
                }),
            ),
            (
                "YTDLP_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "yt-dlp.exe"
                } else {
                    "yt-dlp"
                }),
            ),
        ] {
            watch_media_pairs.push((OsString::from(name), value.into_os_string()));
        }
        if let Some((_, user_profile)) = tool_pairs
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new("USERPROFILE")))
        {
            watch_media_pairs.push((
                OsString::from("BREADBOARD_WATCH_CONFIG_DIR"),
                PathBuf::from(user_profile)
                    .join(".config")
                    .join("watch")
                    .into_os_string(),
            ));
        }
        for name in ["CHATMOCK_BASE_URL", "CHATMOCK_MODEL"] {
            if let Some((_, value)) = services
                .dashboard
                .pairs
                .iter()
                .find(|(candidate, _)| candidate.eq_ignore_ascii_case(OsStr::new(name)))
            {
                watch_media_pairs.push((OsString::from(name), value.clone()));
            }
        }
        watch_media_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                watch_media_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let watch_media = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::WatchMedia,
            pairs: watch_media_pairs,
        };
        let mut loopx_pairs = services
            .dashboard
            .pairs
            .iter()
            .filter(|(name, _)| {
                system_location_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
            })
            .cloned()
            .collect::<Vec<_>>();
        for (name, value) in [
            ("BREADBOARD_LOOPX_ROOT", paths.app_root().join("LoopX")),
            (
                "BREADBOARD_LOOPX_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "BREADBOARD_LOOPX_HOME",
                paths.data_root().join("loopx-goals"),
            ),
        ] {
            loopx_pairs.push((OsString::from(name), value.into_os_string()));
        }
        loopx_pairs.push((OsString::from("ENABLE_LOOPX"), OsString::from("1")));
        let loopx = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Loopx,
            pairs: loopx_pairs,
        };
        let mut resource2skill_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "RESOURCE2SKILL_ROOT",
                paths.app_root().join("Resource2Skill"),
            ),
            (
                "RESOURCE2SKILL_WORKSPACE_ROOT",
                paths.data_root().join("resource2skill-runs"),
            ),
            (
                "PLAYWRIGHT_BROWSERS_PATH",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("services")
                    .join("resource2skill")
                    .join("browsers"),
            ),
        ] {
            resource2skill_pairs.push((OsString::from(name), value.into_os_string()));
        }
        resource2skill_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "VWS_REAPER_SOUNDFONT",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                resource2skill_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let resource2skill = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Resource2Skill,
            pairs: resource2skill_pairs,
        };
        let mut outer_matraix_pairs = tool_pairs.clone();
        outer_matraix_pairs.push((
            OsString::from("MATRAIX_ROOT"),
            paths.app_root().join("MatrAIx-Persona-8B").into_os_string(),
        ));
        outer_matraix_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_matraix_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_matraix = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterMatraix,
            pairs: outer_matraix_pairs,
        };
        let formsmith_python = runtime_v2_service_python(paths, "formsmith");
        let formsmith_python_parent = formsmith_python
            .parent()
            .expect("the fixed Formsmith Python path always has a parent");
        let system_root = PathBuf::from(&os_environment.system_root);
        let system32 = system_root.join("System32");
        let runtime_bin = paths.runtime_root().join("bin");
        let runtime_python = paths.runtime_root().join("runtimes").join("python");
        let mut formsmith_pairs = tool_pairs.clone();
        for (name, value) in [
            ("SHAPER_ROOT", paths.app_root().join("ShapeR")),
            (
                "SHAPER_BRIDGE",
                paths
                    .app_root()
                    .join("dashboard")
                    .join("scripts")
                    .join("shaper-bridge.py"),
            ),
            (
                "SHAPER_STATE_ROOT",
                runtime_v2_service_root(paths, "formsmith"),
            ),
            ("SHAPER_PYTHON", formsmith_python.clone()),
        ] {
            formsmith_pairs.push((OsString::from(name), value.into_os_string()));
        }
        formsmith_pairs.push((
            OsString::from("SHAPER_TOOL_PATH"),
            join_closed_windows_path(&[
                formsmith_python_parent,
                runtime_bin.as_path(),
                runtime_python.as_path(),
                system32.as_path(),
                system_root.as_path(),
            ])
            .expect("fixed Formsmith tool paths are valid"),
        ));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "CUDA_HOME",
            "CUDA_PATH",
            "CUDA_INCLUDE",
            "CUDA_LIB",
            "CUDA_VISIBLE_DEVICES",
            "OMP_NUM_THREADS",
            "HF_HUB_OFFLINE",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                formsmith_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let formsmith = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Formsmith,
            pairs: formsmith_pairs,
        };
        let mut hyperframes_pairs = tool_pairs.clone();
        for (name, value) in [
            ("HYPERFRAMES_ROOT", paths.app_root().join("hyperframes")),
            (
                "HYPERFRAMES_CLI_ROOT",
                paths.data_root().join("hyperframes-cli"),
            ),
            (
                "HYPERFRAMES_WORKSPACE_ROOT",
                paths.data_root().join("hyperframes-runs"),
            ),
            (
                "HYPERFRAMES_FFMPEG_PATH",
                paths.runtime_root().join("bin").join("ffmpeg.exe"),
            ),
            (
                "HYPERFRAMES_FFPROBE_PATH",
                paths.runtime_root().join("bin").join("ffprobe.exe"),
            ),
            (
                "HYPERFRAMES_BROWSER_PATH",
                agent_browser_executable_path(paths, os_environment),
            ),
            (
                "CODEX_BIN",
                paths.runtime_root().join("bin").join("codex.exe"),
            ),
        ] {
            hyperframes_pairs.push((OsString::from(name), value.into_os_string()));
        }
        hyperframes_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "FONTCONFIG_FILE",
            "FONTCONFIG_PATH",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                hyperframes_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let hyperframes = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Hyperframes,
            pairs: hyperframes_pairs,
        };
        let mut openmontage_pairs = tool_pairs.clone();
        for (name, value) in [
            (
                "CODEX_BIN",
                paths.runtime_root().join("bin").join("codex.exe"),
            ),
            ("OPENMONTAGE_FFMPEG_PATH", paths.runtime_root().join("bin")),
        ] {
            openmontage_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [
            (
                "OPENMONTAGE_SOURCE_COMMIT",
                "4eab34c5cfcccaa4f1970554928feccce73ee930",
            ),
            ("CHATMOCK_API_KEY", "local"),
        ] {
            openmontage_pairs.push((OsString::from(name), OsString::from(value)));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "FONTCONFIG_FILE",
            "FONTCONFIG_PATH",
            "LANG",
            "LC_ALL",
            "FAL_KEY",
            "FAL_AI_API_KEY",
            "REPLICATE_API_TOKEN",
            "HIGGSFIELD_API_KEY",
            "HIGGSFIELD_API_SECRET",
            "KLING_API_KEY",
            "KLING_API_BASE_URL",
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "ELEVENLABS_API_KEY",
            "OPENAI_API_KEY",
            "XAI_API_KEY",
            "DOUBAO_SPEECH_API_KEY",
            "DOUBAO_SPEECH_VOICE_TYPE",
            "DASHSCOPE_API_KEY",
            "SUNO_API_KEY",
            "HEYGEN_API_KEY",
            "RUNWAY_API_KEY",
            "VOLC_ACCESSKEY",
            "VOLC_SECRETKEY",
            "VIDEO_GEN_LOCAL_ENABLED",
            "VIDEO_GEN_LOCAL_MODEL",
            "MODAL_LTX2_ENDPOINT_URL",
            "PEXELS_API_KEY",
            "PIXABAY_API_KEY",
            "UNSPLASH_ACCESS_KEY",
            "HF_TOKEN",
            "AZURE_SPEECH_KEY",
            "AZURE_SPEECH_REGION",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                openmontage_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let openmontage = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OpenMontage,
            pairs: openmontage_pairs,
        };
        let mut outer_bolt_slides_pairs = tool_pairs.clone();
        outer_bolt_slides_pairs.push((
            OsString::from("BOLT_SLIDES_ROOT"),
            paths.app_root().join("bolt-slides").into_os_string(),
        ));
        outer_bolt_slides_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "FONTCONFIG_FILE",
            "FONTCONFIG_PATH",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_bolt_slides_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_bolt_slides = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterBoltSlides,
            pairs: outer_bolt_slides_pairs,
        };
        let mut outer_hardware_blueprint_pairs = tool_pairs.clone();
        let hardware_runtime_names = [
            "BREADBOARD_SUPERVISOR_CONTROL_URL",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "CAD_SERVICE_URL",
            "CAD_SERVICE_SECRET",
            "BREADBOARD_SOLIDWORKS_SERVICE_URL",
            "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN",
        ];
        outer_hardware_blueprint_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    hardware_runtime_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        for (name, value) in [
            (
                "BREADBOARD_SOLIDWORKS_MCP_PATH",
                paths.app_root().join("SolidworksMCP-python"),
            ),
            (
                "BREADBOARD_SOLIDWORKS_PYTHON",
                solidworks_python(mode, paths),
            ),
            (
                "BREADBOARD_SOLIDWORKS_HOME",
                paths.data_root().join("solidworks"),
            ),
            (
                "BREADBOARD_SOLIDWORKS_WORKSPACE",
                paths.data_root().join("solidworks").join("workspaces"),
            ),
        ] {
            outer_hardware_blueprint_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [
            ("BREADBOARD_RUNTIME_V2_ACTIVE", "true"),
            ("BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED", "1"),
            ("CHATMOCK_API_KEY", "local"),
        ] {
            outer_hardware_blueprint_pairs.push((OsString::from(name), OsString::from(value)));
        }
        if mode == RuntimeMode::Packaged {
            outer_hardware_blueprint_pairs.push((
                OsString::from("BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME"),
                OsString::from("1"),
            ));
        } else {
            outer_hardware_blueprint_pairs.push((
                OsString::from("BREADBOARD_UV_PATH"),
                paths
                    .runtime_root()
                    .join("bin")
                    .join("uv.exe")
                    .into_os_string(),
            ));
        }
        for name in [
            "BREADBOARD_SOLIDWORKS_EXE",
            "BREADBOARD_SOLIDWORKS_VERSION",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_hardware_blueprint_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_hardware_blueprint = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterHardwareBlueprint,
            pairs: outer_hardware_blueprint_pairs,
        };
        let mut get_doc_pairs = tool_pairs.clone();
        get_doc_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "GET_DOC_CONTACT_EMAIL",
            "OPENALEX_MAILTO",
            "UNPAYWALL_EMAIL",
            "CORE_API_KEY",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                get_doc_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let get_doc = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::GetDoc,
            pairs: get_doc_pairs,
        };
        let get_doc_download = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::GetDocDownload,
            pairs: tool_pairs.clone(),
        };
        let mut meeting_notes_pairs = tool_pairs.clone();
        meeting_notes_pairs.push((
            OsString::from("BREADBOARD_RUNTIME_V2_MEDIA_BIN"),
            paths.runtime_root().join("bin").into_os_string(),
        ));
        meeting_notes_pairs.push((OsString::from("WINDIR"), os_environment.system_root.clone()));
        meeting_notes_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        let meeting_service_names = [
            "NODE_ENV",
            "VOICEBOX_BASE_URL",
            "SCRIBERR_BASE_URL",
            "SCRIBERR_USERNAME",
            "SCRIBERR_PASSWORD",
        ];
        meeting_notes_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    meeting_service_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        for name in [
            "SCRIBERR_REQUEST_TIMEOUT_MS",
            "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS",
            "SCRIBERR_POLL_INTERVAL_MS",
            "SCRIBERR_MODEL_FAMILY",
            "SCRIBERR_MODEL",
            "SCRIBERR_LANGUAGE",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                meeting_notes_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        if !services.managed_scriberr {
            if let Some(value) = product_environment_value(os_environment, "SCRIBERR_API_TOKEN") {
                meeting_notes_pairs
                    .push((OsString::from("SCRIBERR_API_TOKEN"), value.to_os_string()));
            }
        }
        let meeting_notes = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::MeetingNotes,
            pairs: meeting_notes_pairs,
        };
        let mut outer_inbox_zero_pairs = minimal.pairs.clone();
        let inbox_worker_names = [
            "BREADBOARD_INBOX_ZERO_SERVICE_URL",
            "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN",
        ];
        outer_inbox_zero_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    inbox_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        outer_inbox_zero_pairs.push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        let outer_inbox_zero = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterInboxZero,
            pairs: outer_inbox_zero_pairs,
        };
        let mut outer_socials_manager_pairs = minimal.pairs.clone();
        let socials_worker_names = [
            "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL",
            "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN",
            "SOCIALS_MANAGER_MODE",
            "SOCIALS_MANAGER_URL",
            "SOCIALS_MANAGER_READY_TIMEOUT_MS",
        ];
        outer_socials_manager_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    socials_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        for (canonical, legacy) in [
            ("SOCIALS_MANAGER_MODE", "POSTIZ_MODE"),
            ("SOCIALS_MANAGER_URL", "POSTIZ_URL"),
            (
                "SOCIALS_MANAGER_READY_TIMEOUT_MS",
                "POSTIZ_READY_TIMEOUT_MS",
            ),
        ] {
            if let Some((_, value)) = services
                .dashboard
                .pairs
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(OsStr::new(canonical)))
            {
                outer_socials_manager_pairs.push((OsString::from(legacy), value.to_os_string()));
            }
        }
        outer_socials_manager_pairs
            .push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_socials_manager_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_socials_manager = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterSocialsManager,
            pairs: outer_socials_manager_pairs,
        };
        let mut outer_max_research_pairs = tool_pairs.clone();
        let max_research_dashboard_names = [
            "BREADBOARD_SUPERVISOR_CONTROL_URL",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "DEEP_RESEARCH_URL",
            "DEEP_RESEARCH_SECRET",
            "BREADBOARD_OPENSCIENCE_SERVICE_URL",
            "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
            "BREADBOARD_MEM0_SERVICE_URL",
            "BREADBOARD_MEM0_SERVICE_TOKEN",
            "BREADBOARD_MEM0_LLM_MODEL",
            "BREADBOARD_EMBEDDING_MODEL",
            "BREADBOARD_EMBEDDING_BASE_URL",
            "BREADBOARD_EMBEDDING_API_KEY",
            "BREADBOARD_EMBEDDING_DIMENSIONS",
            "OPENAI_BASE_URL",
            "OPENAI_API_KEY",
        ];
        outer_max_research_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    max_research_dashboard_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        for (name, value) in [
            ("BREADBOARD_RUNTIME_V2_ACTIVE", "true"),
            ("DEEP_RESEARCH_MODE", "optional"),
            ("CHATMOCK_API_KEY", "local"),
        ] {
            outer_max_research_pairs.push((OsString::from(name), OsString::from(value)));
        }
        for name in [
            "GET_DOC_CONTACT_EMAIL",
            "OPENALEX_MAILTO",
            "UNPAYWALL_EMAIL",
            "CORE_API_KEY",
            "BREADBOARD_AGENT_MEMORY",
            "BREADBOARD_AGENT_MEMORY_AGENTS",
            "BREADBOARD_MEM0",
            "BREADBOARD_MEM0_EXTRACTION",
            "BREADBOARD_EMBEDDINGS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_max_research_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_max_research = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterMaxResearch,
            pairs: outer_max_research_pairs,
        };
        let mut outer_wardrobe_pairs = minimal.pairs.clone();
        let wardrobe_worker_names = [
            "BREADBOARD_WARDROBE_SERVICE_URL",
            "BREADBOARD_WARDROBE_SERVICE_TOKEN",
        ];
        outer_wardrobe_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    wardrobe_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        let outer_wardrobe = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterWardrobe,
            pairs: outer_wardrobe_pairs,
        };
        let mut outer_parametric_cad_pairs = minimal.pairs.clone();
        let parametric_cad_dashboard_names = [
            "BREADBOARD_SUPERVISOR_CONTROL_URL",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "CAD_SERVICE_URL",
            "CAD_SERVICE_SECRET",
        ];
        outer_parametric_cad_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    parametric_cad_dashboard_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        outer_parametric_cad_pairs.extend([
            (
                OsString::from("BREADBOARD_RUNTIME_V2_ACTIVE"),
                OsString::from("true"),
            ),
            (OsString::from("CHATMOCK_API_KEY"), OsString::from("local")),
        ]);
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_parametric_cad_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let outer_parametric_cad = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterParametricCad,
            pairs: outer_parametric_cad_pairs,
        };
        let mut outer_stock_analyst_pairs = minimal.pairs.clone();
        outer_stock_analyst_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    name.eq_ignore_ascii_case(OsStr::new("STOCK_ANALYST_SERVICE_URL"))
                })
                .cloned(),
        );
        let outer_stock_analyst = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterStockAnalyst,
            pairs: outer_stock_analyst_pairs,
        };
        let mut outer_vibe_trading_pairs = minimal.pairs.clone();
        let vibe_worker_names = ["VIBE_TRADING_SERVICE_URL", "VIBE_TRADING_SERVICE_API_KEY"];
        outer_vibe_trading_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    vibe_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        let outer_vibe_trading = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterVibeTrading,
            pairs: outer_vibe_trading_pairs,
        };
        let mut outer_deer_flow_pairs = minimal.pairs.clone();
        outer_deer_flow_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| name.eq_ignore_ascii_case(OsStr::new("DEER_FLOW_SERVICE_URL")))
                .cloned(),
        );
        let outer_deer_flow = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterDeerFlow,
            pairs: outer_deer_flow_pairs,
        };
        let mut outer_money_printer_pairs = minimal.pairs.clone();
        let money_printer_worker_names = [
            "BREADBOARD_MONEY_PRINTER_SERVICE_URL",
            "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
        ];
        outer_money_printer_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    money_printer_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        outer_money_printer_pairs
            .push((OsString::from("CHATMOCK_API_KEY"), OsString::from("local")));
        let outer_money_printer = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterMoneyPrinter,
            pairs: outer_money_printer_pairs,
        };
        let mut outer_video_use_pairs = tool_pairs.clone();
        let video_use_dashboard_names = [
            "BREADBOARD_SUPERVISOR_CONTROL_URL",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "VIDEO_TRANSCRIPTION_ENABLED",
            "SCRIBERR_BASE_URL",
            "SCRIBERR_USERNAME",
            "SCRIBERR_PASSWORD",
        ];
        outer_video_use_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    video_use_dashboard_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        for (name, value) in [
            ("VIDEO_USE_ROOT", paths.app_root().join("video-use")),
            ("SUBSAI_ROOT", paths.app_root().join("subsai")),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "ffmpeg.exe"
                } else {
                    "ffmpeg"
                }),
            ),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "ffprobe.exe"
                } else {
                    "ffprobe"
                }),
            ),
        ] {
            outer_video_use_pairs.push((OsString::from(name), value.into_os_string()));
        }
        for (name, value) in [
            ("BREADBOARD_RUNTIME_V2_ACTIVE", "true"),
            (
                "VIDEO_USE_SOURCE_COMMIT",
                "8e94eb04d22c5de30bd0febd2cd06fb4103949dd",
            ),
            ("CHATMOCK_API_KEY", "local"),
        ] {
            outer_video_use_pairs.push((OsString::from(name), OsString::from(value)));
        }
        for name in [
            "SCRIBERR_REQUEST_TIMEOUT_MS",
            "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS",
            "SCRIBERR_POLL_INTERVAL_MS",
            "SCRIBERR_MODEL_FAMILY",
            "SCRIBERR_MODEL",
            "SCRIBERR_LANGUAGE",
            "SCRIBERR_DIARIZATION",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                outer_video_use_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        if !services.managed_scriberr {
            if let Some(value) = product_environment_value(os_environment, "SCRIBERR_API_TOKEN") {
                outer_video_use_pairs
                    .push((OsString::from("SCRIBERR_API_TOKEN"), value.to_os_string()));
            }
        }
        let outer_video_use = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterVideoUse,
            pairs: outer_video_use_pairs,
        };
        let mut outer_deep_research_pairs = minimal.pairs.clone();
        let deep_research_worker_names = ["DEEP_RESEARCH_URL", "DEEP_RESEARCH_SECRET"];
        outer_deep_research_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    deep_research_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        let outer_deep_research = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterDeepResearch,
            pairs: outer_deep_research_pairs,
        };
        let mut outer_openscience_pairs = minimal.pairs.clone();
        let openscience_worker_names = [
            "BREADBOARD_OPENSCIENCE_SERVICE_URL",
            "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
        ];
        outer_openscience_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    openscience_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        let outer_openscience = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterOpenscience,
            pairs: outer_openscience_pairs,
        };
        let mut outer_openwork_pairs = minimal.pairs.clone();
        let openwork_worker_names = [
            "BREADBOARD_OPENWORK_SERVICE_URL",
            "BREADBOARD_OPENWORK_SERVICE_TOKEN",
        ];
        outer_openwork_pairs.extend(
            services
                .dashboard
                .pairs
                .iter()
                .filter(|(name, _)| {
                    openwork_worker_names
                        .iter()
                        .any(|allowed| name.eq_ignore_ascii_case(OsStr::new(allowed)))
                })
                .cloned(),
        );
        let outer_openwork = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::OuterOpenwork,
            pairs: outer_openwork_pairs,
        };
        let mut subsai_pairs = tool_pairs.clone();
        for (name, value) in [
            ("SUBSAI_ROOT", paths.app_root().join("subsai")),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_BIN",
                paths.runtime_root().join("bin"),
            ),
            (
                "UV_PATH",
                paths
                    .runtime_root()
                    .join("bin")
                    .join(if cfg!(windows) { "uv.exe" } else { "uv" }),
            ),
        ] {
            subsai_pairs.push((OsString::from(name), value.into_os_string()));
        }
        subsai_pairs.push((
            OsString::from("SUBSAI_SOURCE_COMMIT"),
            OsString::from("5ed78a85d2b868a907c811404f7cd9179db39968"),
        ));
        for name in [
            "UV_PATH",
            "SUBSAI_DEVICE",
            "SUBSAI_COMPUTE_TYPE",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                subsai_pairs
                    .retain(|(candidate, _)| !candidate.eq_ignore_ascii_case(OsStr::new(name)));
                subsai_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let subsai = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::Subsai,
            pairs: subsai_pairs,
        };
        let mut speech_media_pairs = minimal.pairs.clone();
        for (name, value) in [
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "ffmpeg.exe"
                } else {
                    "ffmpeg"
                }),
            ),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "ffprobe.exe"
                } else {
                    "ffprobe"
                }),
            ),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_YTDLP_PATH",
                paths.runtime_root().join("bin").join(if cfg!(windows) {
                    "yt-dlp.exe"
                } else {
                    "yt-dlp"
                }),
            ),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join(if cfg!(windows) {
                        "python.exe"
                    } else {
                        "bin/python"
                    }),
            ),
            (
                "BREADBOARD_RUNTIME_V2_MEDIA_VIDEO_USE_ROOT",
                paths.app_root().join("video-use"),
            ),
        ] {
            speech_media_pairs.push((OsString::from(name), value.into_os_string()));
        }
        let speech_media = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::SpeechMedia,
            pairs: speech_media_pairs,
        };
        let mut managed_setup_pairs = tool_pairs;
        for (name, relative) in [
            ("CARGO_HOME", "runtime-v2/toolchains/cache/cargo-home"),
            ("RUSTUP_HOME", "runtime-v2/toolchains/cache/rustup-home"),
            ("UV_CACHE_DIR", "runtime-v2/toolchains/cache/uv"),
            ("PIP_CACHE_DIR", "runtime-v2/toolchains/cache/pip"),
            ("npm_config_cache", "runtime-v2/toolchains/cache/npm"),
        ] {
            managed_setup_pairs.push((
                OsString::from(name),
                paths.data_root().join(relative).into_os_string(),
            ));
        }
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "NODE_EXTRA_CA_CERTS",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                managed_setup_pairs.push((OsString::from(name), value.to_os_string()));
            }
        }
        let managed_setup = TrustedWorkerEnvironment {
            mode,
            source: TrustedWorkerEnvironmentSource::ManagedSetup,
            pairs: managed_setup_pairs,
        };
        Self {
            mode,
            minimal,
            background,
            document_ingestion,
            audio_analyzer,
            image_search_google,
            interactive_visualizer,
            quartz_publish,
            managed_setup,
            terminal,
            code_index,
            agent_edits,
            outer_opencode,
            trading_agent,
            outer_career_ops,
            outer_openexecutive,
            system_location,
            chatmock,
            vimax,
            vox_director,
            outer_shorts,
            outer_open_gym,
            agent_reach_setup,
            gbrain_sync,
            outer_agent_reach,
            agent_browser_profile,
            agent_tars,
            outer_legal,
            sf3d,
            outer_codex,
            outer_ruflo,
            outer_deep_tutor,
            deep_tutor_maintenance,
            outer_openplanter,
            manim,
            premortem,
            agent_loop,
            omh,
            factcheck,
            watch_media,
            loopx,
            resource2skill,
            outer_matraix,
            formsmith,
            hyperframes,
            openmontage,
            outer_bolt_slides,
            subsai,
            speech_media,
            generated_visual_browser,
            scriberr_garden,
            watermark,
            outer_hardware_blueprint,
            get_doc,
            get_doc_download,
            meeting_notes,
            outer_inbox_zero,
            outer_socials_manager,
            outer_max_research,
            outer_wardrobe,
            outer_parametric_cad,
            outer_stock_analyst,
            outer_vibe_trading,
            outer_deer_flow,
            outer_money_printer,
            outer_video_use,
            outer_deep_research,
            outer_openscience,
            outer_openwork,
            managed_vlm_ocr: services.managed_vlm_ocr,
            managed_scriberr: services.managed_scriberr,
        }
    }

    pub fn prepare_for_source(
        &self,
        source: TrustedWorkerEnvironmentSource,
    ) -> TrustedWorkerEnvironment {
        match source {
            TrustedWorkerEnvironmentSource::Minimal => self.minimal.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Background => self.background.mint_for_launch(),
            TrustedWorkerEnvironmentSource::DocumentIngestion => {
                self.document_ingestion.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::AudioAnalyzer => self.audio_analyzer.mint_for_launch(),
            TrustedWorkerEnvironmentSource::ImageSearchGoogle => {
                self.image_search_google.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::InteractiveVisualizer => {
                self.interactive_visualizer.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::QuartzPublish => self.quartz_publish.mint_for_launch(),
            TrustedWorkerEnvironmentSource::ManagedSetup => self.managed_setup.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Terminal => self.terminal.mint_for_launch(),
            TrustedWorkerEnvironmentSource::CodeIndex => self.code_index.mint_for_launch(),
            TrustedWorkerEnvironmentSource::AgentEdits => self.agent_edits.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterOpencode => self.outer_opencode.mint_for_launch(),
            TrustedWorkerEnvironmentSource::TradingAgent => self.trading_agent.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterCareerOps => {
                self.outer_career_ops.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterOpenExecutive => {
                self.outer_openexecutive.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::SystemLocation => {
                self.system_location.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::Chatmock => self.chatmock.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Vimax => self.vimax.mint_for_launch(),
            TrustedWorkerEnvironmentSource::VoxDirector => self.vox_director.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterShorts => self.outer_shorts.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterOpenGym => self.outer_open_gym.mint_for_launch(),
            TrustedWorkerEnvironmentSource::AgentReachSetup => {
                self.agent_reach_setup.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::GbrainSync => self.gbrain_sync.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterAgentReach => {
                self.outer_agent_reach.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::AgentBrowserProfile => {
                self.agent_browser_profile.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::AgentTars => self.agent_tars.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterLegal => self.outer_legal.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Sf3d => self.sf3d.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterCodex => self.outer_codex.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterRuflo => self.outer_ruflo.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterDeepTutor => {
                self.outer_deep_tutor.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::DeepTutorMaintenance => {
                self.deep_tutor_maintenance.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterOpenPlanter => {
                self.outer_openplanter.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::Manim => self.manim.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Premortem => self.premortem.mint_for_launch(),
            TrustedWorkerEnvironmentSource::AgentLoop => self.agent_loop.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Omh => self.omh.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Factcheck => self.factcheck.mint_for_launch(),
            TrustedWorkerEnvironmentSource::WatchMedia => self.watch_media.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Loopx => self.loopx.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Resource2Skill => self.resource2skill.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterMatraix => self.outer_matraix.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Formsmith => self.formsmith.mint_for_launch(),
            TrustedWorkerEnvironmentSource::Hyperframes => self.hyperframes.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OpenMontage => self.openmontage.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterBoltSlides => {
                self.outer_bolt_slides.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::Subsai => self.subsai.mint_for_launch(),
            TrustedWorkerEnvironmentSource::SpeechMedia => self.speech_media.mint_for_launch(),
            TrustedWorkerEnvironmentSource::GeneratedVisualBrowser => {
                self.generated_visual_browser.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::ScriberrGarden => {
                self.scriberr_garden.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::Watermark => self.watermark.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterHardwareBlueprint => {
                self.outer_hardware_blueprint.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::GetDoc => self.get_doc.mint_for_launch(),
            TrustedWorkerEnvironmentSource::GetDocDownload => {
                self.get_doc_download.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::MeetingNotes => self.meeting_notes.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterInboxZero => {
                self.outer_inbox_zero.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterSocialsManager => {
                self.outer_socials_manager.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterMaxResearch => {
                self.outer_max_research.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterWardrobe => self.outer_wardrobe.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterParametricCad => {
                self.outer_parametric_cad.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterStockAnalyst => {
                self.outer_stock_analyst.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterVibeTrading => {
                self.outer_vibe_trading.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterDeerFlow => self.outer_deer_flow.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterMoneyPrinter => {
                self.outer_money_printer.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterVideoUse => self.outer_video_use.mint_for_launch(),
            TrustedWorkerEnvironmentSource::OuterDeepResearch => {
                self.outer_deep_research.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterOpenscience => {
                self.outer_openscience.mint_for_launch()
            }
            TrustedWorkerEnvironmentSource::OuterOpenwork => self.outer_openwork.mint_for_launch(),
        }
    }

    pub fn should_acquire_service_dependency(&self, service_id: &str) -> bool {
        match service_id {
            "vlm-ocr" => self.managed_vlm_ocr,
            "scriberr" => self.managed_scriberr,
            _ => true,
        }
    }

    pub const fn mode(&self) -> RuntimeMode {
        self.mode
    }
}

impl fmt::Debug for TrustedWorkerEnvironmentSet {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedWorkerEnvironmentSet")
            .field("mode", &self.mode)
            .field(
                "profiles",
                &[
                    "minimal",
                    "background",
                    "document-ingestion",
                    "audio-analyzer",
                    "image-search-google",
                    "interactive-visualizer",
                    "quartz-publish",
                    "managed-setup",
                    "terminal",
                    "code-index",
                    "agent-edits",
                    "outer-opencode",
                    "trading-agent",
                    "outer-career-ops",
                    "outer-openexecutive",
                    "system-location",
                    "chatmock",
                    "vimax",
                    "vox-director",
                    "outer-shorts",
                    "outer-open-gym",
                    "agent-reach-setup",
                    "gbrain-sync",
                    "outer-agent-reach",
                    "agent-browser-profile",
                    "agent-tars",
                    "outer-legal",
                    "sf3d",
                    "outer-codex",
                    "outer-ruflo",
                    "outer-deep-tutor",
                    "deep-tutor-maintenance",
                    "outer-openplanter",
                    "manim",
                    "premortem",
                    "agent-loop",
                    "omh",
                    "factcheck",
                    "watch-media",
                    "loopx",
                    "resource2skill",
                    "outer-matraix",
                    "formsmith",
                    "hyperframes",
                    "openmontage",
                    "outer-bolt-slides",
                    "subsai",
                    "speech-media",
                    "generated-visual-browser",
                    "scriberr-garden",
                    "watermark",
                    "outer-hardware-blueprint",
                    "get-doc",
                    "get-doc-download",
                    "meeting-notes",
                    "outer-inbox-zero",
                    "outer-socials-manager",
                    "outer-max-research",
                    "outer-wardrobe",
                    "outer-parametric-cad",
                    "outer-stock-analyst",
                    "outer-vibe-trading",
                    "outer-deer-flow",
                    "outer-money-printer",
                    "outer-video-use",
                    "outer-deep-research",
                    "outer-openscience",
                ],
            )
            .field("values", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Error)]
pub enum TrustedServiceEnvironmentError {
    #[error("service loopback endpoint allocations must be distinct and nonzero")]
    InvalidServiceEndpoints,
    #[error("dashboard control URL must be a canonical nonzero IPv4-loopback HTTP origin")]
    InvalidDashboardControlUrl,
    #[error("dashboard control token is invalid")]
    InvalidDashboardControlToken,
    #[error("the explicit VLM OCR base URL is invalid")]
    InvalidVlmOcrBaseUrl,
    #[error("the managed VLM OCR binary or configured model files are unavailable")]
    VlmOcrInstallationUnavailable,
    #[error("the Runtime-owned Recall API key is unavailable")]
    RecallApiKeyUnavailable,
    #[error("desktop-config.json is not valid configuration JSON")]
    InvalidDesktopConfig(#[source] serde_json::Error),
    #[error("desktop-config.json must use schema version 2")]
    UnsupportedDesktopConfigVersion,
    #[error("desktop-config.json field {field} is invalid")]
    InvalidDesktopConfigField { field: &'static str },
    #[error("the derived {field} path cannot be represented in the closed environment")]
    InvalidDerivedPath { field: &'static str },
    #[error("environment name {name} is invalid for {profile:?}")]
    InvalidEnvironmentName {
        profile: TrustedServiceEnvironmentProfile,
        name: String,
    },
    #[error("environment name {name} is duplicated for {profile:?}")]
    DuplicateEnvironmentName {
        profile: TrustedServiceEnvironmentProfile,
        name: &'static str,
    },
    #[error("environment value for {name} is invalid for {profile:?}")]
    InvalidEnvironmentValue {
        profile: TrustedServiceEnvironmentProfile,
        name: &'static str,
    },
    #[error("environment block is too large for {profile:?}")]
    EnvironmentBlockTooLarge {
        profile: TrustedServiceEnvironmentProfile,
    },
    #[error("service {service_id} has no trusted environment profile")]
    UnknownServiceProfile { service_id: String },
    #[error(
        "{profile:?} requires environment source {expected:?}, not manifest source {actual:?}"
    )]
    EnvironmentSourceMismatch {
        profile: TrustedServiceEnvironmentProfile,
        expected: TrustedServiceEnvironmentSource,
        actual: TrustedServiceEnvironmentSource,
    },
    #[error("{profile:?} environment does not cover runtime mode {mode:?}")]
    EnvironmentModeMismatch {
        profile: TrustedServiceEnvironmentProfile,
        mode: RuntimeMode,
    },
    #[error(transparent)]
    Path(#[from] PathError),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequiredDesktopConfigV2 {
    version: u32,
    next_auth_secret: String,
    gbrain_mode: String,
    gbrain_adapter_secret: String,
    hermes_session_token: String,
    hermes_tool_secret: String,
    hermes_capability_secret: String,
    initial_invite_code: String,
    #[serde(default = "default_comfy_ui_mode")]
    comfy_ui_mode: String,
    #[serde(default)]
    comfy_ui_external_url: Option<String>,
    #[serde(default = "default_optional_mode")]
    ui_tars_mode: String,
    #[serde(default = "default_optional_mode")]
    cad_mode: String,
    #[serde(default = "default_optional_mode")]
    colpali_mode: String,
    #[serde(default = "default_local_mode")]
    humanizer_mode: String,
    #[serde(default = "default_humanizer_device")]
    humanizer_device: String,
    #[serde(default = "default_optional_mode")]
    cliproxy_mode: String,
    #[serde(default)]
    scriberr_enabled: bool,
    #[serde(default)]
    scriberr_base_url: Option<String>,
    #[serde(default = "default_scriberr_username")]
    scriberr_username: String,
    #[serde(default)]
    scriberr_password: String,
}

fn default_comfy_ui_mode() -> String {
    "managed".to_string()
}

fn default_optional_mode() -> String {
    "optional".to_string()
}

fn default_local_mode() -> String {
    "local".to_string()
}

fn default_humanizer_device() -> String {
    "auto".to_string()
}

fn default_scriberr_username() -> String {
    "breadboard".to_string()
}

struct EnvironmentBuilder {
    mode: RuntimeMode,
    profile: TrustedServiceEnvironmentProfile,
    source: TrustedServiceEnvironmentSource,
    pairs: Vec<(OsString, OsString)>,
    folded_names: HashSet<String>,
    encoded_bytes: usize,
}

impl EnvironmentBuilder {
    fn new(mode: RuntimeMode, profile: TrustedServiceEnvironmentProfile) -> Self {
        Self {
            mode,
            profile,
            source: profile.source(),
            pairs: Vec::new(),
            folded_names: HashSet::new(),
            // Account for the final environment-block terminator.
            encoded_bytes: 1,
        }
    }

    fn insert(
        &mut self,
        name: &'static str,
        value: impl Into<OsString>,
    ) -> Result<(), TrustedServiceEnvironmentError> {
        if name.is_empty()
            || name.len() > MAX_ENVIRONMENT_NAME_BYTES
            || !name.is_ascii()
            || name
                .bytes()
                .any(|byte| byte.is_ascii_control() || byte == b'=')
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'(' | b')'))
        {
            return Err(TrustedServiceEnvironmentError::InvalidEnvironmentName {
                profile: self.profile,
                name: name.to_string(),
            });
        }
        if !self.folded_names.insert(name.to_ascii_lowercase()) {
            return Err(TrustedServiceEnvironmentError::DuplicateEnvironmentName {
                profile: self.profile,
                name,
            });
        }

        let value = value.into();
        let value_bytes = value.as_encoded_bytes();
        if value_bytes.len() > MAX_ENVIRONMENT_VALUE_BYTES
            || value.to_string_lossy().chars().any(char::is_control)
        {
            return Err(TrustedServiceEnvironmentError::InvalidEnvironmentValue {
                profile: self.profile,
                name,
            });
        }
        self.encoded_bytes = self
            .encoded_bytes
            .saturating_add(name.len())
            .saturating_add(1)
            .saturating_add(value_bytes.len())
            .saturating_add(1);
        if self.encoded_bytes > MAX_ENVIRONMENT_BLOCK_BYTES {
            return Err(TrustedServiceEnvironmentError::EnvironmentBlockTooLarge {
                profile: self.profile,
            });
        }
        self.pairs.push((OsString::from(name), value));
        Ok(())
    }

    fn finish(mut self) -> TrustedServiceEnvironment {
        self.pairs.sort_by(|(left, _), (right, _)| {
            left.to_string_lossy()
                .to_ascii_lowercase()
                .cmp(&right.to_string_lossy().to_ascii_lowercase())
        });
        TrustedServiceEnvironment {
            mode: self.mode,
            profile: self.profile,
            source: self.source,
            pairs: self.pairs,
        }
    }
}

fn load_required_desktop_config(
    config_root: &TrustedDirectoryPin,
) -> Result<RequiredDesktopConfigV2, TrustedServiceEnvironmentError> {
    let bytes = config_root.read_bounded_file(DESKTOP_CONFIG_FILE, MAX_DESKTOP_CONFIG_BYTES)?;
    let config: RequiredDesktopConfigV2 = serde_json::from_slice(&bytes)
        .map_err(TrustedServiceEnvironmentError::InvalidDesktopConfig)?;
    if config.version != 2 {
        return Err(TrustedServiceEnvironmentError::UnsupportedDesktopConfigVersion);
    }
    validate_config_secret("nextAuthSecret", &config.next_auth_secret)?;
    if !matches!(
        config.gbrain_mode.as_str(),
        "disabled" | "preferred" | "required"
    ) {
        return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
            field: "gbrainMode",
        });
    }
    validate_config_secret("gbrainAdapterSecret", &config.gbrain_adapter_secret)?;
    validate_config_secret("hermesSessionToken", &config.hermes_session_token)?;
    validate_config_secret("hermesToolSecret", &config.hermes_tool_secret)?;
    validate_config_secret("hermesCapabilitySecret", &config.hermes_capability_secret)?;
    validate_invite_code(&config.initial_invite_code)?;
    if !matches!(
        config.comfy_ui_mode.as_str(),
        "disabled" | "managed" | "external"
    ) {
        return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
            field: "comfyUiMode",
        });
    }
    match (
        &*config.comfy_ui_mode,
        config.comfy_ui_external_url.as_deref(),
    ) {
        ("external", Some(url)) => validate_external_comfy_ui_url(url)?,
        ("external", None) => {
            return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
                field: "comfyUiExternalUrl",
            });
        }
        (_, Some(url)) => validate_external_comfy_ui_url(url)?,
        (_, None) => {}
    }
    for (field, value, allowed) in [
        (
            "uiTarsMode",
            config.ui_tars_mode.as_str(),
            &["disabled", "optional", "required"][..],
        ),
        (
            "cadMode",
            config.cad_mode.as_str(),
            &["disabled", "optional"][..],
        ),
        (
            "colpaliMode",
            config.colpali_mode.as_str(),
            &["disabled", "optional"][..],
        ),
        (
            "humanizerMode",
            config.humanizer_mode.as_str(),
            &["disabled", "local"][..],
        ),
        (
            "humanizerDevice",
            config.humanizer_device.as_str(),
            &["auto", "cuda", "cpu"][..],
        ),
        (
            "cliproxyMode",
            config.cliproxy_mode.as_str(),
            &["disabled", "optional", "required"][..],
        ),
    ] {
        if !allowed.contains(&value) {
            return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField { field });
        }
    }
    if config.scriberr_enabled && config.scriberr_base_url.is_none() {
        if config.scriberr_username.len() < 3
            || config.scriberr_username.len() > 256
            || config.scriberr_username.chars().any(char::is_control)
        {
            return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
                field: "scriberrUsername",
            });
        }
        validate_config_secret("scriberrPassword", &config.scriberr_password)?;
    }
    Ok(config)
}

fn validate_external_comfy_ui_url(value: &str) -> Result<(), TrustedServiceEnvironmentError> {
    if value.is_empty()
        || value.len() > 2_048
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
        || value.contains(['@', '#', '?'])
        || value.ends_with('/')
    {
        return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
            field: "comfyUiExternalUrl",
        });
    }
    let authority = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
        .and_then(|suffix| suffix.split('/').next())
        .filter(|authority| !authority.is_empty());
    if authority.is_none() {
        return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
            field: "comfyUiExternalUrl",
        });
    }
    Ok(())
}

fn validate_config_secret(
    field: &'static str,
    value: &str,
) -> Result<(), TrustedServiceEnvironmentError> {
    let bytes = value.as_bytes();
    if bytes.len() < MIN_CONTROL_TOKEN_BYTES
        || bytes.len() > MAX_CONFIG_SECRET_BYTES
        || !bytes.iter().all(|byte| byte.is_ascii_graphic())
    {
        return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField { field });
    }
    Ok(())
}

fn validate_invite_code(value: &str) -> Result<(), TrustedServiceEnvironmentError> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > MAX_INVITE_CODE_BYTES
        || !bytes.iter().all(|byte| byte.is_ascii_graphic())
    {
        return Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
            field: "initialInviteCode",
        });
    }
    Ok(())
}

fn validate_captured_os_value(
    _name: &'static str,
    value: &OsStr,
) -> Result<(), TrustedOsEnvironmentCaptureError> {
    if value.is_empty()
        || value.as_encoded_bytes().len() > MAX_ENVIRONMENT_VALUE_BYTES
        || value.to_string_lossy().chars().any(char::is_control)
    {
        return Err(TrustedOsEnvironmentCaptureError::InvalidVariable);
    }
    Ok(())
}

fn validate_captured_product_value(
    name: &'static str,
    value: &OsStr,
) -> Result<(), TrustedOsEnvironmentCaptureError> {
    validate_captured_os_value(name, value)?;
    let text = value
        .to_str()
        .ok_or(TrustedOsEnvironmentCaptureError::InvalidVariable)?;
    let valid = match name {
        "SCRIBERR_API_TOKEN" => text.len() <= 8 * 1024,
        "SCRIBERR_REQUEST_TIMEOUT_MS" => bounded_u64(text, 1_000, 600_000),
        "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS" => bounded_u64(text, 60_000, 21_600_000),
        "SCRIBERR_POLL_INTERVAL_MS" => bounded_u64(text, 500, 60_000),
        "SCRIBERR_MODEL_FAMILY" | "SCRIBERR_MODEL" => text.len() <= 128,
        "SCRIBERR_LANGUAGE" => text.len() <= 64,
        "SCRIBERR_DIARIZATION"
        | "VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS"
        | "VIDEO_TRANSCRIPTION_KEEP_MEDIA" => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "0" | "1" | "true" | "false" | "yes" | "no" | "on" | "off"
        ),
        "VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB" => bounded_u64(text, 1, 2_048),
        "VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS" => bounded_u64(text, 1, 21_600),
        "VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS" => bounded_u64(text, 1, 720),
        "YTDLP_DOWNLOAD_TIMEOUT_MS" => bounded_u64(text, 10_000, 1_800_000),
        "VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN" => bounded_u64(text, 1, 100),
        "QUARTZ_AUTO_PUBLISH" => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "0" | "1" | "true" | "false" | "yes" | "no" | "on" | "off" | "disabled"
        ),
        "QUARTZ_PUBLISH_MODE" => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "await" | "background"
        ),
        "QUARTZ_BUILD_CONCURRENCY" => bounded_u64(text, 1, 16),
        "QUARTZ_BUILD_TIMEOUT_MS" => bounded_u64(text, 10_000, 3_600_000),
        "GET_DOC_CONTACT_EMAIL" | "OPENALEX_MAILTO" | "UNPAYWALL_EMAIL" => {
            !text.trim().is_empty() && text.len() <= 320
        }
        "CORE_API_KEY" => !text.trim().is_empty() && text.len() <= 8 * 1024,
        _ => true,
    };
    if valid {
        Ok(())
    } else {
        Err(TrustedOsEnvironmentCaptureError::InvalidVariable)
    }
}

fn bounded_u64(value: &str, minimum: u64, maximum: u64) -> bool {
    value
        .trim()
        .parse::<u64>()
        .is_ok_and(|parsed| (minimum..=maximum).contains(&parsed))
}

fn validate_loopback_origin(url: &str) -> Result<(), TrustedServiceEnvironmentError> {
    let port_text = url
        .strip_prefix("http://127.0.0.1:")
        .ok_or(TrustedServiceEnvironmentError::InvalidDashboardControlUrl)?;
    let port: u16 = port_text
        .parse()
        .map_err(|_| TrustedServiceEnvironmentError::InvalidDashboardControlUrl)?;
    let port =
        NonZeroU16::new(port).ok_or(TrustedServiceEnvironmentError::InvalidDashboardControlUrl)?;
    if url != format!("http://127.0.0.1:{port}") {
        return Err(TrustedServiceEnvironmentError::InvalidDashboardControlUrl);
    }
    Ok(())
}

fn build_common_environment(
    mode: RuntimeMode,
    profile: TrustedServiceEnvironmentProfile,
    paths: &RuntimePaths,
    os_environment: &TrustedOsEnvironment,
) -> Result<EnvironmentBuilder, TrustedServiceEnvironmentError> {
    let mut builder = EnvironmentBuilder::new(mode, profile);
    builder.insert("SystemRoot", os_environment.system_root.clone())?;
    for (name, value) in &os_environment.optional {
        builder.insert(name, value.clone())?;
    }

    let system_root = PathBuf::from(&os_environment.system_root);
    let system32 = system_root.join("System32");
    let runtime_bin = paths.runtime_root().join("bin");
    let runtime_node = paths.runtime_root().join("runtimes").join("node");
    let runtime_bun = paths.runtime_root().join("runtimes").join("bun");
    let runtime_python = paths.runtime_root().join("runtimes").join("python");
    builder.insert(
        "PATH",
        join_closed_windows_path(&[
            runtime_bin.as_path(),
            runtime_node.as_path(),
            runtime_bun.as_path(),
            runtime_python.as_path(),
            system32.as_path(),
            &system_root,
        ])?,
    )?;
    builder.insert("ComSpec", system32.join("cmd.exe").into_os_string())?;
    builder.insert("PATHEXT", ".COM;.EXE;.BAT;.CMD")?;

    let temporary = paths.data_root().join("runtime-v2").join("temp");
    builder.insert("TEMP", temporary.as_os_str())?;
    builder.insert("TMP", temporary.as_os_str())?;
    Ok(builder)
}

fn product_environment_value<'a>(
    environment: &'a TrustedOsEnvironment,
    name: &str,
) -> Option<&'a OsStr> {
    environment
        .product
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_os_str())
}

fn insert_product_environment(
    builder: &mut EnvironmentBuilder,
    environment: &TrustedOsEnvironment,
) -> Result<(), TrustedServiceEnvironmentError> {
    for (name, value) in &environment.product {
        if *name == "SOCIALS_MANAGER_READY_TIMEOUT_MS" && builder.mode == RuntimeMode::Packaged {
            continue;
        }
        if matches!(
            *name,
            "CHATMOCK_MODEL" | "BREADBOARD_IFIXAI_MODE" | "VLM_OCR_BASE_URL" | "VLM_OCR_AUTO_START"
        ) || service_only_product_environment_name(name)
        {
            continue;
        }
        builder.insert(name, value.clone())?;
    }
    Ok(())
}

fn service_only_product_environment_name(name: &str) -> bool {
    matches!(
        name,
        "BREADBOARD_EMBEDDING_API_KEY"
            | "BREADBOARD_VISUAL_BROWSER_PATH"
            | "BREADBOARD_SPOTIFY_BROWSER_PATH"
            | "AGENT_BROWSER_EXECUTABLE_PATH"
            | "SF3D_DEVICE"
            | "SF3D_PRETRAINED_MODEL"
            | "SF3D_TIMEOUT_MS"
            | "UV_PATH"
            | "SUBSAI_DEVICE"
            | "SUBSAI_COMPUTE_TYPE"
            | "SCRIBERR_API_TOKEN"
            | "SCRIBERR_REQUEST_TIMEOUT_MS"
            | "SCRIBERR_TRANSCRIPTION_TIMEOUT_MS"
            | "SCRIBERR_POLL_INTERVAL_MS"
            | "SCRIBERR_MODEL_FAMILY"
            | "SCRIBERR_MODEL"
            | "SCRIBERR_LANGUAGE"
            | "SCRIBERR_DIARIZATION"
            | "VIDEO_TRANSCRIPTION_DELETE_SCRIBERR_JOBS"
            | "VIDEO_TRANSCRIPTION_KEEP_MEDIA"
            | "VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB"
            | "VIDEO_TRANSCRIPTION_MAX_DURATION_SECONDS"
            | "VIDEO_TRANSCRIPTION_TEMP_RETENTION_HOURS"
            | "YTDLP_DOWNLOAD_TIMEOUT_MS"
            | "VIDEO_TRANSCRIPTION_MAX_QUEUED_PER_GARDEN"
            | "GET_DOC_CONTACT_EMAIL"
            | "OPENALEX_MAILTO"
            | "UNPAYWALL_EMAIL"
            | "CORE_API_KEY"
            | "HUGGINGFACE_TOKEN"
            | "HF_TOKEN"
            | "HUGGING_FACE_HUB_TOKEN"
            | "CUDA_VISIBLE_DEVICES"
            | "CUDA_PATH"
            | "CUDA_HOME"
            | "CUDA_INCLUDE"
            | "CUDA_LIB"
            | "OMP_NUM_THREADS"
            | "HF_HUB_OFFLINE"
            | "REQUESTS_CA_BUNDLE"
            | "CURL_CA_BUNDLE"
            | "LANG"
            | "LC_ALL"
            | "FONTCONFIG_FILE"
            | "FONTCONFIG_PATH"
            | "FAL_KEY"
            | "FAL_AI_API_KEY"
            | "REPLICATE_API_TOKEN"
            | "HIGGSFIELD_API_KEY"
            | "HIGGSFIELD_API_SECRET"
            | "KLING_API_KEY"
            | "KLING_API_BASE_URL"
            | "GOOGLE_API_KEY"
            | "GOOGLE_APPLICATION_CREDENTIALS"
            | "GOOGLE_CLOUD_PROJECT"
            | "GOOGLE_CLOUD_LOCATION"
            | "ELEVENLABS_API_KEY"
            | "OPENAI_API_KEY"
            | "XAI_API_KEY"
            | "DOUBAO_SPEECH_API_KEY"
            | "DOUBAO_SPEECH_VOICE_TYPE"
            | "DASHSCOPE_API_KEY"
            | "SUNO_API_KEY"
            | "HEYGEN_API_KEY"
            | "RUNWAY_API_KEY"
            | "VOLC_ACCESSKEY"
            | "VOLC_SECRETKEY"
            | "VIDEO_GEN_LOCAL_ENABLED"
            | "VIDEO_GEN_LOCAL_MODEL"
            | "MODAL_LTX2_ENDPOINT_URL"
            | "PEXELS_API_KEY"
            | "PIXABAY_API_KEY"
            | "UNSPLASH_ACCESS_KEY"
            | "AZURE_SPEECH_KEY"
            | "AZURE_SPEECH_REGION"
            | "HTTP_PROXY"
            | "HTTPS_PROXY"
            | "ALL_PROXY"
            | "NO_PROXY"
            | "SSL_CERT_FILE"
            | "SSL_CERT_DIR"
            | "NODE_EXTRA_CA_CERTS"
            | "DOCKER_CLI_PATH"
            | "PODMAN_CLI_PATH"
            | "DOCKER_DESKTOP_PATH"
            | "DOCKER_HOST"
            | "DOCKER_CONTEXT"
            | "DOCKER_CONFIG"
            | "MANIM_DOCKER_IMAGE"
            | "MANIM_TIMEOUT_MS"
            | "POSTIZ_IDLE_TIMEOUT_MS"
            | "POSTIZ_IDLE_CHECK_MS"
            | "INBOX_ZERO_GOOGLE_CLIENT_ID"
            | "INBOX_ZERO_GOOGLE_CLIENT_SECRET"
            | "INBOX_ZERO_MICROSOFT_CLIENT_ID"
            | "INBOX_ZERO_MICROSOFT_CLIENT_SECRET"
            | "X_API_KEY"
            | "X_API_SECRET"
            | "X_URL"
            | "LINKEDIN_CLIENT_ID"
            | "LINKEDIN_CLIENT_SECRET"
            | "REDDIT_CLIENT_ID"
            | "REDDIT_CLIENT_SECRET"
            | "GITHUB_CLIENT_ID"
            | "GITHUB_CLIENT_SECRET"
            | "THREADS_APP_ID"
            | "THREADS_APP_SECRET"
            | "FACEBOOK_APP_ID"
            | "FACEBOOK_APP_SECRET"
            | "INSTAGRAM_APP_ID"
            | "INSTAGRAM_APP_SECRET"
            | "YOUTUBE_CLIENT_ID"
            | "YOUTUBE_CLIENT_SECRET"
            | "GOOGLE_GMB_CLIENT_ID"
            | "GOOGLE_GMB_CLIENT_SECRET"
            | "TIKTOK_CLIENT_ID"
            | "TIKTOK_CLIENT_SECRET"
            | "PINTEREST_CLIENT_ID"
            | "PINTEREST_CLIENT_SECRET"
            | "DRIBBBLE_CLIENT_ID"
            | "DRIBBBLE_CLIENT_SECRET"
            | "TUMBLR_CLIENT_ID"
            | "TUMBLR_CLIENT_SECRET"
            | "DISCORD_CLIENT_ID"
            | "DISCORD_CLIENT_SECRET"
            | "DISCORD_BOT_TOKEN_ID"
            | "SLACK_ID"
            | "SLACK_SECRET"
            | "SLACK_SIGNING_SECRET"
            | "KICK_CLIENT_ID"
            | "KICK_SECRET"
            | "TWITCH_CLIENT_ID"
            | "TWITCH_CLIENT_SECRET"
            | "WHOP_CLIENT_ID"
            | "VK_ID"
            | "MEWE_APP_ID"
            | "MEWE_API_KEY"
            | "MEWE_HOST"
            | "NEYNAR_CLIENT_ID"
            | "NEYNAR_SECRET_KEY"
            | "TELEGRAM_BOT_NAME"
            | "TELEGRAM_TOKEN"
            | "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN"
    ) || name.starts_with("BREADBOARD_POSTIZ_") && name.ends_with("_MEMORY_MB")
}

fn packaged_service_evidence_token(
    mode: RuntimeMode,
    environment: &TrustedOsEnvironment,
) -> Result<Option<&OsStr>, TrustedServiceEnvironmentError> {
    let Some(value) = product_environment_value(environment, "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN")
    else {
        return Ok(None);
    };
    if mode != RuntimeMode::Packaged {
        return Ok(None);
    }
    let Some(token) = value.to_str() else {
        return Err(TrustedServiceEnvironmentError::InvalidEnvironmentValue {
            profile: TrustedServiceEnvironmentProfile::Dashboard,
            name: "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
        });
    };
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(TrustedServiceEnvironmentError::InvalidEnvironmentValue {
            profile: TrustedServiceEnvironmentProfile::Dashboard,
            name: "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
        });
    }
    Ok(Some(value))
}

fn derive_gateway_token(control_token: &[u8], domain: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain);
    digest.update([0]);
    digest.update(control_token);
    format!("{:x}", digest.finalize())
}

struct VlmOcrMode {
    managed: bool,
    base_url: String,
}

fn product_bool(environment: &TrustedOsEnvironment, name: &str, fallback: bool) -> bool {
    let Some(value) = product_environment_value(environment, name).and_then(OsStr::to_str) else {
        return fallback;
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => fallback,
    }
}

fn normalize_external_vlm_url(value: &OsStr) -> Result<String, TrustedServiceEnvironmentError> {
    let value = value
        .to_str()
        .ok_or(TrustedServiceEnvironmentError::InvalidVlmOcrBaseUrl)?
        .trim();
    if value.is_empty()
        || value.len() > 2_048
        || value.chars().any(char::is_control)
        || value.chars().any(char::is_whitespace)
        || value.contains(['@', '?', '#'])
    {
        return Err(TrustedServiceEnvironmentError::InvalidVlmOcrBaseUrl);
    }
    let candidate = if value.starts_with("http://") || value.starts_with("https://") {
        value.to_owned()
    } else {
        format!("http://{value}")
    };
    let (_, authority_and_path) = candidate
        .split_once("://")
        .ok_or(TrustedServiceEnvironmentError::InvalidVlmOcrBaseUrl)?;
    let authority = authority_and_path.split('/').next().unwrap_or_default();
    if authority.is_empty() {
        return Err(TrustedServiceEnvironmentError::InvalidVlmOcrBaseUrl);
    }
    let trimmed = candidate.trim_end_matches('/');
    let path = authority_and_path
        .strip_prefix(authority)
        .unwrap_or_default()
        .trim_end_matches('/');
    if path.rsplit('/').next().is_some_and(|part| {
        part.len() >= 2
            && part.starts_with('v')
            && part[1..].bytes().all(|byte| byte.is_ascii_digit())
    }) {
        Ok(trimmed.to_owned())
    } else {
        Ok(format!("{trimmed}/v1"))
    }
}

fn resolve_vlm_ocr_mode(
    endpoints: &ServiceEndpointMap,
    environment: &TrustedOsEnvironment,
) -> Result<VlmOcrMode, TrustedServiceEnvironmentError> {
    let enabled = product_bool(environment, "VLM_OCR_ENABLED", true);
    let auto_start = product_bool(environment, "VLM_OCR_AUTO_START", true);
    let explicit = product_environment_value(environment, "VLM_OCR_BASE_URL");
    let managed = enabled && auto_start && explicit.is_none();
    let base_url = if managed {
        format!(
            "{}/v1",
            endpoints.base_url(TrustedServiceEnvironmentSource::VlmOcr)
        )
    } else if let Some(value) = explicit {
        normalize_external_vlm_url(value)?
    } else {
        "http://127.0.0.1:8077/v1".to_owned()
    };
    Ok(VlmOcrMode { managed, base_url })
}

fn build_agent_service_environment(
    mode: RuntimeMode,
    profile: TrustedServiceEnvironmentProfile,
    paths: &RuntimePaths,
    token_name: &'static str,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<EnvironmentBuilder, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(mode, profile, paths, os_environment)?;
    builder.insert(
        "NODE_ENV",
        if mode == RuntimeMode::Hot {
            "development"
        } else {
            "production"
        },
    )?;
    builder.insert("NODE_OPTIONS", "")?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_REPO_ROOT", paths.app_root().as_os_str())?;
    builder.insert(
        "BREADBOARD_AGENT_SERVICE_STATE_ROOT",
        paths
            .data_root()
            .join("runtime-v2")
            .join("agent-services")
            .into_os_string(),
    )?;
    builder.insert(
        "HOME",
        paths
            .data_root()
            .join("runtime-v2")
            .join("home")
            .into_os_string(),
    )?;
    builder.insert(token_name, token)?;
    Ok(builder)
}

fn build_openwork_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_agent_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::Openwork,
        paths,
        "BREADBOARD_OPENWORK_SERVICE_TOKEN",
        token,
        os_environment,
    )?;
    builder.insert(
        "OPENWORK_ROOT",
        paths.app_root().join("openwork").into_os_string(),
    )?;
    builder.insert(
        "OPENWORK_BUN_PATH",
        paths
            .runtime_root()
            .join("runtimes")
            .join("bun")
            .join("bun.exe")
            .into_os_string(),
    )?;
    builder.insert(
        "OPENWORK_SERVER_RUNTIME_ROOT",
        match mode {
            RuntimeMode::Packaged => paths.app_root().join("openwork-runtime"),
            RuntimeMode::Lean | RuntimeMode::Hot => paths.data_root().join("openwork-runtime"),
        }
        .into_os_string(),
    )?;
    builder.insert(
        "OPENCODE_BIN",
        opencode_binary_path(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "OPENWORK_WORKSPACE_ROOT",
        paths
            .data_root()
            .join("openwork-workspace")
            .into_os_string(),
    )?;
    builder.insert(
        "OPENWORK_SERVER_STATE_ROOT",
        paths.data_root().join("openwork-state").into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_openscience_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_agent_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::Openscience,
        paths,
        "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
        token,
        os_environment,
    )?;
    builder.insert(
        "OPENSCIENCE_ROOT",
        paths.app_root().join("openscience").into_os_string(),
    )?;
    builder.insert(
        "OPENSCIENCE_CLI_ROOT",
        match mode {
            RuntimeMode::Packaged => paths.app_root().join("openscience-cli"),
            RuntimeMode::Lean | RuntimeMode::Hot => paths.data_root().join("openscience-cli"),
        }
        .into_os_string(),
    )?;
    builder.insert(
        "OPENSCIENCE_WORKSPACE_ROOT",
        paths
            .data_root()
            .join("openscience-workspace")
            .into_os_string(),
    )?;
    builder.insert(
        "OPENSCIENCE_STATE_ROOT",
        paths.data_root().join("openscience-state").into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_money_printer_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_agent_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::MoneyPrinter,
        paths,
        "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
        token,
        os_environment,
    )?;
    builder.insert(
        "MONEY_PRINTER_ROOT",
        paths
            .data_root()
            .join("runtime-v2")
            .join("toolchains")
            .join("money-printer")
            .into_os_string(),
    )?;
    builder.insert(
        "MONEY_PRINTER_CREDENTIALS_FILE",
        paths
            .data_root()
            .join("credentials")
            .join("money-printer.json")
            .into_os_string(),
    )?;
    builder.insert(
        "MONEY_PRINTER_FFMPEG_PATH",
        paths
            .runtime_root()
            .join("bin")
            .join("ffmpeg.exe")
            .into_os_string(),
    )?;
    builder.insert(
        "MONEY_PRINTER_PYTHON",
        paths
            .data_root()
            .join("runtime-v2")
            .join("services")
            .join("money-printer")
            .join(".venv")
            .join("Scripts")
            .join("python.exe")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_wardrobe_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_agent_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::Wardrobe,
        paths,
        "BREADBOARD_WARDROBE_SERVICE_TOKEN",
        token,
        os_environment,
    )?;
    let root = match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => paths.app_root().join("wardrobe"),
        RuntimeMode::Packaged => paths.app_root().join("wardrobe-runtime"),
    };
    let runtime_root = match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => paths
            .data_root()
            .join("runtime-v2")
            .join("toolchains")
            .join("wardrobe"),
        RuntimeMode::Packaged => paths.app_root().join("wardrobe-runtime"),
    };
    builder.insert("WARDROBE_ROOT", root.as_os_str())?;
    builder.insert("WARDROBE_RUNTIME_ROOT", runtime_root.into_os_string())?;
    let data_root = paths.data_root().join("wardrobe").join("data");
    builder.insert("WARDROBE_DATA_DIR", data_root.as_os_str())?;
    builder.insert(
        "WARDROBE_MODEL_REFERENCE",
        data_root.join("model-reference.png").into_os_string(),
    )?;
    builder.insert("OPENAI_API_KEY", "local")?;
    builder.insert("OPENAI_BASE_URL", endpoints.chatmock_v1_url())?;
    Ok(builder.finish())
}

fn build_penecho_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    api_key: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Penecho,
        paths,
        os_environment,
    )?;
    builder.insert("HOST", "127.0.0.1")?;
    builder.insert(
        "PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Penecho)
            .to_string(),
    )?;
    builder.insert("AI_PROVIDER", "api")?;
    builder.insert("AI_API_FORMAT", "openai")?;
    builder.insert("AI_API_URL", endpoints.chatmock_v1_url())?;
    builder.insert("AI_API_KEY", api_key)?;
    builder.insert(
        "AI_API_MODEL",
        product_environment_value(os_environment, "CHATMOCK_MODEL")
            .unwrap_or_else(|| OsStr::new("default")),
    )?;
    // Preserve the former dashboard launcher's behavior exactly: PenEcho can
    // emit WebP only when `require("sharp")` resolves from PenEcho's own
    // package root. A Sharp copy in the dashboard's unrelated dependency tree
    // is not reachable by the PenEcho process and must not select WebP.
    let sharp_present = paths
        .app_root()
        .join("penecho")
        .join("node_modules")
        .join("sharp")
        .exists();
    builder.insert(
        "PENECHO_AI_IMAGE_FORMAT",
        if sharp_present { "webp" } else { "png" },
    )?;
    builder.insert(
        "PENECHO_FRAME_ANCESTORS",
        format!(
            "{} http://127.0.0.1:8081 http://localhost:8081",
            endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard)
        ),
    )?;
    builder.insert(
        "PENECHO_STATE_DIR",
        paths.data_root().join("penecho").into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_vlm_ocr_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
    vlm_mode: &VlmOcrMode,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::VlmOcr,
        paths,
        os_environment,
    )?;
    builder.insert(
        "VLM_OCR_BASE_URL",
        format!(
            "{}/v1",
            endpoints.base_url(TrustedServiceEnvironmentSource::VlmOcr)
        ),
    )?;
    builder.insert(
        "VLM_OCR_RUNTIME_MANAGED",
        if vlm_mode.managed { "1" } else { "0" },
    )?;
    if mode == RuntimeMode::Packaged {
        let vlm_root = paths.runtime_root().join("bin").join("vlm-ocr");
        builder.insert(
            "VLM_OCR_SERVER_BINARY",
            vlm_root
                .join("runtime")
                .join("llama-server.exe")
                .into_os_string(),
        )?;
        builder.insert(
            "VLM_OCR_MODEL_PATH",
            vlm_root
                .join("models")
                .join("HunyuanOCR-Q8_0.gguf")
                .into_os_string(),
        )?;
        builder.insert(
            "VLM_OCR_MMPROJ_PATH",
            vlm_root
                .join("models")
                .join("mmproj-HunyuanOCR-Q8_0.gguf")
                .into_os_string(),
        )?;
    } else {
        for name in [
            "VLM_OCR_SERVER_BINARY",
            "VLM_OCR_HF_REPO",
            "VLM_OCR_MODEL_PATH",
            "VLM_OCR_MMPROJ_PATH",
        ] {
            if let Some(value) = product_environment_value(os_environment, name) {
                builder.insert(name, value.to_os_string())?;
            }
        }
    }
    for name in [
        "VLM_OCR_GPU_LAYERS",
        "VLM_OCR_CONTEXT_SIZE",
        "VLM_OCR_STARTUP_TIMEOUT_MS",
        "VLM_OCR_MAX_TOKENS",
    ] {
        if let Some(value) = product_environment_value(os_environment, name) {
            builder.insert(name, value.to_os_string())?;
        }
    }
    Ok(builder.finish())
}

const MAX_RECALL_API_KEY_FILE_BYTES: usize = 160;

fn valid_recall_api_key(value: &str) -> bool {
    value.len() == 35
        && value.starts_with("sp-")
        && value[3..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Reads the one Runtime-owned Recall key or atomically mints its legacy-
/// compatible `sp-<32 lowercase hex>` replacement. No caller supplies this
/// value and neither the path nor the key crosses a control response.
fn read_or_create_recall_api_key(
    paths: &RuntimePaths,
) -> Result<String, TrustedServiceEnvironmentError> {
    let resolved = paths.resolve_data("recall/api-key")?;
    match paths.read_bounded_data_file_with_pin(&resolved, MAX_RECALL_API_KEY_FILE_BYTES) {
        Ok((bytes, _pin)) => {
            if let Ok(value) = std::str::from_utf8(&bytes) {
                let value = value.trim();
                if valid_recall_api_key(value) {
                    return Ok(value.to_owned());
                }
            }
        }
        Err(PathError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let mut random = [0_u8; 16];
    getrandom::getrandom(&mut random)
        .map_err(|_| TrustedServiceEnvironmentError::RecallApiKeyUnavailable)?;
    let mut key = String::with_capacity(35);
    key.push_str("sp-");
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in random {
        key.push(char::from(HEX[usize::from(byte >> 4)]));
        key.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    random.fill(0);
    let mut encoded = key.as_bytes().to_vec();
    encoded.push(b'\n');
    drop(paths.atomic_replace_data_file(
        "recall/api-key",
        &encoded,
        MAX_RECALL_API_KEY_FILE_BYTES,
    )?);
    Ok(key)
}

const MAX_PRIVATE_SERVICE_SECRET_FILE_BYTES: usize = MAX_CONTROL_TOKEN_BYTES + 2;

/// Reads one stable per-install loopback credential or atomically creates it
/// from Runtime's private lifecycle seed. The value never appears in a
/// manifest, argv, status response, or diagnostic string.
fn read_or_create_private_service_secret(
    paths: &RuntimePaths,
    relative_path: &str,
    domain: &[u8],
    seed: &[u8],
) -> Result<String, TrustedServiceEnvironmentError> {
    let resolved = paths.resolve_data(relative_path)?;
    match paths.read_bounded_data_file_with_pin(&resolved, MAX_PRIVATE_SERVICE_SECRET_FILE_BYTES) {
        Ok((bytes, _pin)) => {
            if let Ok(value) = std::str::from_utf8(&bytes) {
                let value = value.trim();
                if value.len() >= MIN_CONTROL_TOKEN_BYTES
                    && value.len() <= MAX_CONTROL_TOKEN_BYTES
                    && value.bytes().all(|byte| byte.is_ascii_graphic())
                {
                    return Ok(value.to_owned());
                }
            }
        }
        Err(PathError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let value = derive_gateway_token(seed, domain);
    let mut encoded = value.as_bytes().to_vec();
    encoded.push(b'\n');
    drop(paths.atomic_replace_data_file(
        relative_path,
        &encoded,
        MAX_PRIVATE_SERVICE_SECRET_FILE_BYTES,
    )?);
    Ok(value)
}

fn write_cliproxy_runtime_config(
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    api_key: &str,
    management_key: &str,
) -> Result<(), TrustedServiceEnvironmentError> {
    drop(paths.prepare_data_directory("cliproxy/auth")?);
    let home = paths.data_root().join("cliproxy");
    let auth = serde_json::to_string(&home.join("auth").to_string_lossy().replace('\\', "/"))
        .map_err(TrustedServiceEnvironmentError::InvalidDesktopConfig)?;
    let api_key = serde_json::to_string(api_key)
        .map_err(TrustedServiceEnvironmentError::InvalidDesktopConfig)?;
    let management_key = serde_json::to_string(management_key)
        .map_err(TrustedServiceEnvironmentError::InvalidDesktopConfig)?;
    let config = format!(
        "# Generated by Breadboard Runtime V2. Edits are overwritten.\n\
host: \"127.0.0.1\"\n\
port: {}\n\
auth-dir: {auth}\n\
api-keys:\n  - {api_key}\n\
debug: false\n\
usage-statistics-enabled: false\n\
logging-to-file: false\n\
request-retry: 0\n\
max-retry-interval: 30\n\n\
remote-management:\n\
  allow-remote: false\n\
  secret-key: {management_key}\n\
  disable-control-panel: true\n\n\
quota-exceeded:\n\
  switch-project: true\n\
  switch-preview-model: false\n\n\
routing:\n\
  strategy: \"round-robin\"\n",
        endpoints.port_for(TrustedServiceEnvironmentSource::Cliproxy),
    );
    drop(paths.atomic_replace_data_file("cliproxy/config.yaml", config.as_bytes(), 16 * 1024)?);
    Ok(())
}

fn build_recall_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    api_key: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Recall,
        paths,
        os_environment,
    )?;
    builder.insert("SCREENPIPE_API_KEY", api_key)?;
    Ok(builder.finish())
}

fn build_node_service_environment(
    mode: RuntimeMode,
    profile: TrustedServiceEnvironmentProfile,
    paths: &RuntimePaths,
    os_environment: &TrustedOsEnvironment,
) -> Result<EnvironmentBuilder, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(mode, profile, paths, os_environment)?;
    builder.insert(
        "NODE_ENV",
        if mode == RuntimeMode::Hot {
            "development"
        } else {
            "production"
        },
    )?;
    builder.insert("NODE_OPTIONS", "")?;
    Ok(builder)
}

fn copy_selected_product_environment(
    builder: &mut EnvironmentBuilder,
    environment: &TrustedOsEnvironment,
    names: &[&'static str],
) -> Result<(), TrustedServiceEnvironmentError> {
    for &name in names {
        if let Some(value) = product_environment_value(environment, name) {
            builder.insert(name, value.to_os_string())?;
        }
    }
    Ok(())
}

fn bounded_product_u64(
    environment: &TrustedOsEnvironment,
    profile: TrustedServiceEnvironmentProfile,
    name: &'static str,
    minimum: u64,
    maximum: u64,
    fallback: u64,
) -> Result<u64, TrustedServiceEnvironmentError> {
    let Some(raw) = product_environment_value(environment, name) else {
        return Ok(fallback);
    };
    let value = raw
        .to_str()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .filter(|value| (minimum..=maximum).contains(value))
        .ok_or(TrustedServiceEnvironmentError::InvalidEnvironmentValue { profile, name })?;
    Ok(value)
}

fn build_mem0_semantic_engine_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::Mem0SemanticEngine,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_MEM0_SERVICE_TOKEN", token)?;
    builder.insert("OPENAI_BASE_URL", endpoints.chatmock_v1_url())?;
    builder.insert("OPENAI_LOCAL_BASE_URL", endpoints.chatmock_v1_url())?;
    builder.insert("OPENAI_API_KEY", "local")?;
    builder.insert("CHATMOCK_API_KEY", "local")?;
    copy_selected_product_environment(
        &mut builder,
        os_environment,
        &[
            "BREADBOARD_EMBEDDING_BASE_URL",
            "BREADBOARD_EMBEDDING_API_KEY",
            "BREADBOARD_EMBEDDING_MODEL",
            "BREADBOARD_EMBEDDING_DIMENSIONS",
            "BREADBOARD_MEM0_LLM_MODEL",
        ],
    )?;
    Ok(builder.finish())
}

fn build_local_mcp_broker_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::LocalMcpBroker,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_LOCAL_MCP_BROKER_TOKEN", token)?;
    builder.insert(
        "BREADBOARD_LOCAL_MCP_REGISTRY_ROOT",
        paths
            .data_root()
            .join("runtime-v2")
            .join("local-mcp-definitions")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_spotify_playback_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::SpotifyPlayback,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN", token)?;
    builder.insert("BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED", "1")?;
    builder.insert(
        "BREADBOARD_SPOTIFY_DASHBOARD_ORIGIN",
        endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard),
    )?;
    copy_selected_product_environment(
        &mut builder,
        os_environment,
        &["BREADBOARD_SPOTIFY_BROWSER_PATH"],
    )?;
    Ok(builder.finish())
}

fn runtime_v2_service_root(paths: &RuntimePaths, service_id: &str) -> PathBuf {
    paths
        .data_root()
        .join("runtime-v2")
        .join("services")
        .join(service_id)
}

fn runtime_v2_service_python(paths: &RuntimePaths, service_id: &str) -> PathBuf {
    let environment = runtime_v2_service_root(paths, service_id).join(".venv");
    if cfg!(windows) {
        environment.join("Scripts").join("python.exe")
    } else {
        environment.join("bin").join("python")
    }
}

fn solidworks_python(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => runtime_v2_service_python(paths, "solidworks-mcp"),
        RuntimeMode::Packaged => paths
            .runtime_root()
            .join("runtimes")
            .join("solidworks-python")
            .join(if cfg!(windows) {
                "python.exe"
            } else {
                "bin/python"
            }),
    }
}

fn build_cliproxy_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    api_key: &str,
    management_key: &str,
    os_environment: &TrustedOsEnvironment,
    _config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Cliproxy,
        paths,
        os_environment,
    )?;
    let home = paths.data_root().join("cliproxy");
    builder.insert("WRITABLE_PATH", home.as_os_str())?;
    builder.insert("CLIPROXY_HOME", home.as_os_str())?;
    builder.insert(
        "CLIPROXY_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Cliproxy)
            .to_string(),
    )?;
    builder.insert("CLIPROXY_API_KEY", api_key)?;
    builder.insert("CLIPROXY_MANAGEMENT_KEY", management_key)?;
    Ok(builder.finish())
}

fn build_quartz_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::Quartz,
        paths,
        os_environment,
    )?;
    builder.insert(
        "BREADBOARD_DASHBOARD_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard),
    )?;
    builder.insert(
        "BREADBOARD_QUARTZ_PUBLIC_ROOT",
        paths
            .data_root()
            .join("quartz")
            .join("public")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_ui_tars_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
    _config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::UiTars,
        paths,
        os_environment,
    )?;
    builder.insert("UI_TARS_ADAPTER_HOST", "127.0.0.1")?;
    builder.insert(
        "UI_TARS_ADAPTER_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::UiTars)
            .to_string(),
    )?;
    builder.insert("UI_TARS_ADAPTER_SECRET", token)?;
    builder.insert(
        "UI_TARS_DATA_DIR",
        paths.data_root().join("ui-tars").into_os_string(),
    )?;
    builder.insert("UI_TARS_RUNTIME", "agent-tars")?;
    builder.insert("UI_TARS_MAX_CONCURRENT_RUNS", "3")?;
    builder.insert("UI_TARS_SCREENSHOT_RETENTION_MS", "0")?;
    Ok(builder.finish())
}

fn build_cad_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
    _config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Cad,
        paths,
        os_environment,
    )?;
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("BREADBOARD_CAD_SECRET", token)?;
    builder.insert("BREADBOARD_CAD_HOST", "127.0.0.1")?;
    builder.insert(
        "BREADBOARD_CAD_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Cad)
            .to_string(),
    )?;
    builder.insert(
        "BREADBOARD_CAD_WORKSPACE",
        paths
            .data_root()
            .join("runtime")
            .join("cad-workspaces")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_colpali_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
    _config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Colpali,
        paths,
        os_environment,
    )?;
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("BREADBOARD_COLPALI_SECRET", token)?;
    builder.insert(
        "BREADBOARD_COLPALI_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Colpali)
            .to_string(),
    )?;
    builder.insert(
        "BREADBOARD_COLPALI_HOME",
        paths
            .data_root()
            .join("runtime")
            .join("colpali")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_humanizer_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
    config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Humanizer,
        paths,
        os_environment,
    )?;
    let home = paths.data_root().join("runtime").join("humanizer");
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("BREADBOARD_HUMANIZER_SECRET", token)?;
    builder.insert(
        "BREADBOARD_HUMANIZER_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Humanizer)
            .to_string(),
    )?;
    builder.insert("BREADBOARD_HUMANIZER_HOME", home.as_os_str())?;
    builder.insert(
        "BREADBOARD_HUMANIZER_DEVICE",
        config.humanizer_device.as_str(),
    )?;
    builder.insert("HF_HOME", home.join("models").into_os_string())?;
    builder.insert("HF_HUB_DISABLE_TELEMETRY", "1")?;
    builder.insert("DISABLE_TELEMETRY", "1")?;
    builder.insert("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")?;
    Ok(builder.finish())
}

fn build_voicebox_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Voicebox,
        paths,
        os_environment,
    )?;
    let data = paths.data_root().join("runtime").join("voicebox");
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("VOICEBOX_AUTOINSTALL", "true")?;
    builder.insert(
        "VOICEBOX_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Voicebox)
            .to_string(),
    )?;
    builder.insert("VOICEBOX_DATA_DIR", data.as_os_str())?;
    builder.insert("VOICEBOX_MODELS_DIR", data.join("models").into_os_string())?;
    builder.insert(
        "VOICEBOX_STATUS_PATH",
        data.join("startup-status.json").into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_scriberr_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
    _config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Scriberr,
        paths,
        os_environment,
    )?;
    let data = paths.data_root().join("runtime").join("scriberr");
    builder.insert("HOST", "127.0.0.1")?;
    builder.insert(
        "PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Scriberr)
            .to_string(),
    )?;
    builder.insert("APP_ENV", "production")?;
    builder.insert("SCRIBERR_LAZY_MODEL_INIT", "true")?;
    builder.insert("SECURE_COOKIES", "false")?;
    builder.insert(
        "ALLOWED_ORIGINS",
        endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard),
    )?;
    for (name, suffix) in [
        ("DATABASE_PATH", "scriberr.db"),
        ("JWT_SECRET_FILE", "jwt_secret"),
        ("UPLOAD_DIR", "uploads"),
        ("TRANSCRIPTS_DIR", "transcripts"),
        ("TEMP_DIR", "temp"),
        ("WHISPERX_ENV", "models"),
    ] {
        builder.insert(name, data.join(suffix).into_os_string())?;
    }
    builder.insert(
        "FFMPEG_PATH",
        paths
            .runtime_root()
            .join("bin")
            .join("ffmpeg.exe")
            .into_os_string(),
    )?;
    builder.insert(
        "FFPROBE_PATH",
        paths
            .runtime_root()
            .join("bin")
            .join("ffprobe.exe")
            .into_os_string(),
    )?;
    builder.insert(
        "YTDLP_PATH",
        paths
            .runtime_root()
            .join("bin")
            .join("yt-dlp.exe")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_deep_research_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::DeepResearch,
        paths,
        os_environment,
    )?;
    builder.insert("DEEP_RESEARCH_HOST", "127.0.0.1")?;
    builder.insert(
        "DEEP_RESEARCH_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::DeepResearch)
            .to_string(),
    )?;
    builder.insert("DEEP_RESEARCH_SECRET", token)?;
    builder.insert("OPENAI_BASE_URL", endpoints.chatmock_v1_url())?;
    builder.insert("OPENAI_API_KEY", "local")?;
    builder.insert(
        "CHATMOCK_MODEL",
        product_environment_value(os_environment, "CHATMOCK_MODEL")
            .unwrap_or_else(|| OsStr::new("default")),
    )?;
    builder.insert("DEEP_RESEARCH_CONTEXT_SIZE", "128000")?;
    builder.insert("DEEP_RESEARCH_STEP_TIMEOUT_MS", "180000")?;
    builder.insert("DEEP_RESEARCH_MAX_CONCURRENT", "2")?;
    builder.insert("DEEP_RESEARCH_SEARCH_PROVIDER", "auto")?;
    builder.insert("DEEP_RESEARCH_SEARCH_TIMEOUT_MS", "300000")?;
    builder.insert("DEEP_RESEARCH_SEARCH_CONCURRENCY", "2")?;
    Ok(builder.finish())
}

fn build_deer_flow_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    _endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::DeerFlow,
        paths,
        os_environment,
    )?;
    let root = paths.app_root().join("deer-flow");
    let backend = root.join("backend");
    let state = paths.data_root().join("runtime").join("deer-flow");
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("PYTHONPATH", backend.as_os_str())?;
    builder.insert("DEER_FLOW_PROJECT_ROOT", root.as_os_str())?;
    builder.insert("DEER_FLOW_STATE_DIR", state.as_os_str())?;
    builder.insert("DEER_FLOW_HOME", state.join("home").into_os_string())?;
    builder.insert(
        "DEER_FLOW_CONFIG_PATH",
        state.join("config.yaml").into_os_string(),
    )?;
    builder.insert(
        "DEER_FLOW_EXTENSIONS_CONFIG_PATH",
        state.join("extensions_config.json").into_os_string(),
    )?;
    builder.insert("DEER_FLOW_AUTH_DISABLED", "1")?;
    builder.insert("GATEWAY_ENABLE_DOCS", "false")?;
    builder.insert("DEER_FLOW_ENV", "local")?;
    Ok(builder.finish())
}

fn build_vibe_trading_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::VibeTrading,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_MANAGED_PYTHON_SERVICE_ID", "vibe-trading")?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_SERVICE_CONFIG",
        paths
            .data_root()
            .join("runtime")
            .join("vibe-trading")
            .join("service-config.json")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_EXECUTABLE",
        runtime_v2_service_python(paths, "vibe-trading").into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_SOURCE_ROOT",
        paths
            .app_root()
            .join("Vibe-Trading")
            .join("agent")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_SERVICE_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::VibeTrading)
            .to_string(),
    )?;
    builder.insert("VIBE_TRADING_SERVICE_API_KEY", token)?;
    builder.insert(
        "VIBE_TRADING_HOME",
        paths
            .data_root()
            .join("runtime")
            .join("vibe-trading")
            .join("home")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_stock_analyst_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::StockAnalyst,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_MANAGED_PYTHON_SERVICE_ID", "stock-analyst")?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_SERVICE_CONFIG",
        paths
            .data_root()
            .join("runtime")
            .join("stock-analyst")
            .join("service-config.json")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_EXECUTABLE",
        runtime_v2_service_python(paths, "stock-analyst").into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_SOURCE_ROOT",
        paths
            .app_root()
            .join("daily_stock_analysis")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_MANAGED_PYTHON_SERVICE_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::StockAnalyst)
            .to_string(),
    )?;
    builder.insert(
        "STOCK_ANALYST_HOME",
        paths
            .data_root()
            .join("runtime")
            .join("stock-analyst")
            .join("home")
            .into_os_string(),
    )?;
    Ok(builder.finish())
}

fn build_solidworks_mcp_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::SolidworksMcp,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED", "1")?;
    builder.insert("BREADBOARD_SOLIDWORKS_BRIDGE_OWNER", "runtime-v2-service")?;
    builder.insert("BREADBOARD_SOLIDWORKS_SERVICE_TOKEN", token)?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_SERVICE_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::SolidworksMcp)
            .to_string(),
    )?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_HOME",
        paths.data_root().join("solidworks").into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_WORKSPACE",
        paths
            .data_root()
            .join("solidworks")
            .join("workspaces")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_MCP_PATH",
        paths
            .app_root()
            .join("SolidworksMCP-python")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_PYTHON",
        solidworks_python(mode, paths).into_os_string(),
    )?;
    match mode {
        RuntimeMode::Packaged => {
            builder.insert("BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME", "1")?;
        }
        RuntimeMode::Lean | RuntimeMode::Hot => {
            builder.insert(
                "BREADBOARD_SOLIDWORKS_BASE_PYTHON",
                paths
                    .runtime_root()
                    .join("runtimes")
                    .join("python")
                    .join("python.exe")
                    .into_os_string(),
            )?;
            builder.insert(
                "BREADBOARD_UV_PATH",
                paths
                    .runtime_root()
                    .join("bin")
                    .join("uv.exe")
                    .into_os_string(),
            )?;
            builder.insert(
                "UV_PROJECT_ENVIRONMENT",
                runtime_v2_service_root(paths, "solidworks-mcp")
                    .join(".venv")
                    .into_os_string(),
            )?;
            builder.insert(
                "UV_CACHE_DIR",
                paths
                    .data_root()
                    .join("runtime-v2")
                    .join("toolchains")
                    .join("cache")
                    .join("uv")
                    .into_os_string(),
            )?;
        }
    }
    copy_selected_product_environment(
        &mut builder,
        os_environment,
        &["BREADBOARD_SOLIDWORKS_EXE", "BREADBOARD_SOLIDWORKS_VERSION"],
    )?;
    Ok(builder.finish())
}

const POSTIZ_SERVICE_PRODUCT_NAMES: &[&str] = &[
    "DOCKER_CLI_PATH",
    "PODMAN_CLI_PATH",
    "DOCKER_DESKTOP_PATH",
    "X_API_KEY",
    "X_API_SECRET",
    "X_URL",
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "THREADS_APP_ID",
    "THREADS_APP_SECRET",
    "FACEBOOK_APP_ID",
    "FACEBOOK_APP_SECRET",
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "YOUTUBE_CLIENT_ID",
    "YOUTUBE_CLIENT_SECRET",
    "GOOGLE_GMB_CLIENT_ID",
    "GOOGLE_GMB_CLIENT_SECRET",
    "TIKTOK_CLIENT_ID",
    "TIKTOK_CLIENT_SECRET",
    "PINTEREST_CLIENT_ID",
    "PINTEREST_CLIENT_SECRET",
    "DRIBBBLE_CLIENT_ID",
    "DRIBBBLE_CLIENT_SECRET",
    "TUMBLR_CLIENT_ID",
    "TUMBLR_CLIENT_SECRET",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN_ID",
    "SLACK_ID",
    "SLACK_SECRET",
    "SLACK_SIGNING_SECRET",
    "KICK_CLIENT_ID",
    "KICK_SECRET",
    "TWITCH_CLIENT_ID",
    "TWITCH_CLIENT_SECRET",
    "WHOP_CLIENT_ID",
    "VK_ID",
    "MEWE_APP_ID",
    "MEWE_API_KEY",
    "MEWE_HOST",
    "NEYNAR_CLIENT_ID",
    "NEYNAR_SECRET_KEY",
    "TELEGRAM_BOT_NAME",
    "TELEGRAM_TOKEN",
    "BREADBOARD_POSTIZ_POSTIZ_MEMORY_MB",
    "BREADBOARD_POSTIZ_POSTIZ_POSTGRES_MEMORY_MB",
    "BREADBOARD_POSTIZ_POSTIZ_REDIS_MEMORY_MB",
    "BREADBOARD_POSTIZ_SPOTLIGHT_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_ELASTICSEARCH_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_POSTGRESQL_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_ADMIN_TOOLS_MEMORY_MB",
    "BREADBOARD_POSTIZ_TEMPORAL_UI_MEMORY_MB",
];

fn build_postiz_coordinator_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    control: &DashboardControlEnvironment,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::PostizCoordinator,
        paths,
        os_environment,
    )?;
    let service_url = endpoints.base_url(TrustedServiceEnvironmentSource::PostizCoordinator);
    let web_url = format!(
        "http://127.0.0.1:{}",
        endpoints.auxiliary_port_for(ServiceAuxiliaryEndpoint::PostizWeb)
    );
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_REPO_ROOT", paths.app_root().as_os_str())?;
    builder.insert("BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL", service_url)?;
    builder.insert("BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN", token)?;
    builder.insert("SOCIALS_MANAGER_MODE", "stack")?;
    builder.insert("SOCIALS_MANAGER_URL", web_url)?;
    builder.insert(
        "SOCIALS_MANAGER_ROOT",
        paths.app_root().join("postiz-app").into_os_string(),
    )?;
    builder.insert("SOCIALS_MANAGER_PROJECT", "breadboard-postiz")?;
    let ready_timeout = if mode == RuntimeMode::Packaged {
        20_000
    } else {
        bounded_product_u64(
            os_environment,
            TrustedServiceEnvironmentProfile::PostizCoordinator,
            "SOCIALS_MANAGER_READY_TIMEOUT_MS",
            1_000,
            1_080_000,
            20_000,
        )?
    };
    builder.insert(
        "SOCIALS_MANAGER_READY_TIMEOUT_MS",
        ready_timeout.to_string(),
    )?;
    builder.insert("SOCIALS_MANAGER_AUTOSTART_DOCKER", "true")?;
    builder.insert("SOCIALS_MANAGER_SUPPRESS_DOCKER_UI", "true")?;
    builder.insert("POSTIZ_SUPERVISOR_HOST", "127.0.0.1")?;
    builder.insert("POSTIZ_SUPERVISOR_STARTUP_TIMEOUT_MS", "1080000")?;
    builder.insert(
        "POSTIZ_IDLE_TIMEOUT_MS",
        bounded_product_u64(
            os_environment,
            TrustedServiceEnvironmentProfile::PostizCoordinator,
            "POSTIZ_IDLE_TIMEOUT_MS",
            0,
            604_800_000,
            1_500_000,
        )?
        .to_string(),
    )?;
    let idle_check = if mode == RuntimeMode::Packaged {
        60_000
    } else {
        bounded_product_u64(
            os_environment,
            TrustedServiceEnvironmentProfile::PostizCoordinator,
            "POSTIZ_IDLE_CHECK_MS",
            1_000,
            300_000,
            60_000,
        )?
    };
    builder.insert("POSTIZ_IDLE_CHECK_MS", idle_check.to_string())?;
    builder.insert("BREADBOARD_SUPERVISOR_CONTROL_URL", control.url.as_str())?;
    builder.insert(
        "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
        control.token.as_str(),
    )?;
    copy_selected_product_environment(&mut builder, os_environment, POSTIZ_SERVICE_PRODUCT_NAMES)?;
    Ok(builder.finish())
}

fn build_inbox_zero_stack_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    control: &DashboardControlEnvironment,
    token: &str,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_node_service_environment(
        mode,
        TrustedServiceEnvironmentProfile::InboxZeroStack,
        paths,
        os_environment,
    )?;
    builder.insert("BREADBOARD_DATA_DIR", paths.data_root().as_os_str())?;
    builder.insert("BREADBOARD_REPO_ROOT", paths.app_root().as_os_str())?;
    builder.insert(
        "BREADBOARD_INBOX_ZERO_SERVICE_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::InboxZeroStack),
    )?;
    builder.insert("BREADBOARD_INBOX_ZERO_SERVICE_TOKEN", token)?;
    builder.insert("INBOX_ZERO_MODE", "stack")?;
    builder.insert(
        "INBOX_ZERO_URL",
        format!(
            "http://127.0.0.1:{}",
            endpoints.auxiliary_port_for(ServiceAuxiliaryEndpoint::InboxWeb)
        ),
    )?;
    builder.insert(
        "INBOX_ZERO_ROOT",
        paths.app_root().join("inbox-zero").into_os_string(),
    )?;
    builder.insert("INBOX_ZERO_PROJECT", "breadboard-inbox-zero")?;
    for (name, endpoint) in [
        ("INBOX_ZERO_PORT", ServiceAuxiliaryEndpoint::InboxWeb),
        (
            "INBOX_ZERO_POSTGRES_PORT",
            ServiceAuxiliaryEndpoint::InboxDatabase,
        ),
        (
            "INBOX_ZERO_REDIS_PORT",
            ServiceAuxiliaryEndpoint::InboxRedis,
        ),
        (
            "INBOX_ZERO_REDIS_HTTP_PORT",
            ServiceAuxiliaryEndpoint::InboxRedisHttp,
        ),
    ] {
        builder.insert(name, endpoints.auxiliary_port_for(endpoint).to_string())?;
    }
    builder.insert("INBOX_ZERO_READY_TIMEOUT_MS", "180000")?;
    builder.insert("INBOX_ZERO_AUTOSTART_DOCKER", "true")?;
    builder.insert("INBOX_ZERO_SUPPRESS_DOCKER_UI", "true")?;
    builder.insert("BREADBOARD_SUPERVISOR_CONTROL_URL", control.url.as_str())?;
    builder.insert(
        "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
        control.token.as_str(),
    )?;
    copy_selected_product_environment(
        &mut builder,
        os_environment,
        &[
            "DOCKER_CLI_PATH",
            "PODMAN_CLI_PATH",
            "DOCKER_DESKTOP_PATH",
            "INBOX_ZERO_GOOGLE_CLIENT_ID",
            "INBOX_ZERO_GOOGLE_CLIENT_SECRET",
            "INBOX_ZERO_MICROSOFT_CLIENT_ID",
            "INBOX_ZERO_MICROSOFT_CLIENT_SECRET",
        ],
    )?;
    Ok(builder.finish())
}

fn build_gateway_environment(
    mode: RuntimeMode,
    profile: TrustedServiceEnvironmentProfile,
    dashboard: &TrustedServiceEnvironment,
    token_name: &'static str,
    token: &str,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = EnvironmentBuilder::new(mode, profile);
    for (name, value) in &dashboard.pairs {
        let name_text = name.to_string_lossy();
        if name_text.starts_with("VLM_OCR_")
            || name_text.starts_with("RECALL_")
            || name_text.starts_with("INTERACTIVE_VISUALIZER_")
            || name_text.starts_with("SCRIBERR_")
            || name_text.starts_with("VIDEO_TRANSCRIPTION_")
            || name_text.starts_with("BREADBOARD_EMBEDDING_")
            || name_text.starts_with("BREADBOARD_SPOTIFY_")
            || name_text.starts_with("BREADBOARD_SOLIDWORKS_")
            || matches!(
                name_text.as_ref(),
                "PORT"
                    | "HOSTNAME"
                    | "BREADBOARD_DASHBOARD_BUNDLER"
                    | "BREADBOARD_SUPERVISOR_CONTROL_URL"
                    | "BREADBOARD_SUPERVISOR_CONTROL_TOKEN"
                    | "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN"
                    | "BREADBOARD_PACKAGED_SERVICE_EVIDENCE"
                    | "BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS"
                    | "BREADBOARD_TELEGRAM_GATEWAY_URL"
                    | "BREADBOARD_TELEGRAM_GATEWAY_TOKEN"
                    | "BREADBOARD_WHATSAPP_GATEWAY_URL"
                    | "BREADBOARD_WHATSAPP_GATEWAY_TOKEN"
                    | "BREADBOARD_OPENWORK_SERVICE_URL"
                    | "BREADBOARD_OPENWORK_SERVICE_TOKEN"
                    | "BREADBOARD_OPENSCIENCE_SERVICE_URL"
                    | "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN"
                    | "BREADBOARD_MONEY_PRINTER_SERVICE_URL"
                    | "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN"
                    | "BREADBOARD_WARDROBE_SERVICE_URL"
                    | "BREADBOARD_WARDROBE_SERVICE_TOKEN"
                    | "BREADBOARD_MEM0_SERVICE_URL"
                    | "BREADBOARD_MEM0_SERVICE_TOKEN"
                    | "BREADBOARD_LOCAL_MCP_BROKER_URL"
                    | "BREADBOARD_LOCAL_MCP_BROKER_TOKEN"
                    | "BREADBOARD_LOCAL_MCP_REGISTRY_ROOT"
                    | "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL"
                    | "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN"
                    | "BREADBOARD_INBOX_ZERO_SERVICE_URL"
                    | "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN"
                    | "BREADBOARD_MEM0_LLM_MODEL"
                    | "SOCIALS_MANAGER_URL"
                    | "WARDROBE_ROOT"
                    | "WARDROBE_RUNTIME_ROOT"
                    | "WARDROBE_DATA_DIR"
                    | "WARDROBE_MODEL_REFERENCE"
                    | "PENECHO_URL"
                    | "PENECHO_PORT"
                    | "BREADBOARD_PENECHO_RUNTIME_MANAGED"
                    | "BREADBOARD_UV_PATH"
                    | "OPENCODE_BIN"
                    | "OPENCODE_ROOT"
                    | "BREADBOARD_OPENCODE_CONFIG"
                    | "TRADINGAGENTS_ROOT"
                    | "TRADINGAGENTS_CREDENTIALS_FILE"
                    | "CAREER_OPS_ROOT"
                    | "PLAYWRIGHT_BROWSERS_PATH"
            )
        {
            continue;
        }
        let name: &'static str = OPTIONAL_ELECTRON_GATED_PRODUCT_ENVIRONMENT_NAMES
            .iter()
            .copied()
            .chain([
                "SystemRoot",
                "USERPROFILE",
                "APPDATA",
                "LOCALAPPDATA",
                "PROGRAMDATA",
                "SystemDrive",
                "PROGRAMFILES",
                "PROGRAMFILES(X86)",
                "PATH",
                "ComSpec",
                "PATHEXT",
                "TEMP",
                "TMP",
                "NODE_ENV",
                "NODE_OPTIONS",
                "BREADBOARD_DATA_DIR",
                "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
                "BREADBOARD_REPO_ROOT",
                "QUARTZ_CONTENT_PATH",
                "NEXT_PUBLIC_QUARTZ_URL",
                "COUNCIL_LEDGER_DIR",
                "COMFYUI_ENABLED",
                "COMFYUI_MANAGED",
                "COMFYUI_URL",
                "COMFYUI_PORT",
                "COMFYUI_ROOT",
                "COMFYUI_ENV_DIR",
                "COMFYUI_RUNTIME_DIR",
                "COMFYUI_START_TIMEOUT_MS",
                "COMFYUI_GENERATE_TIMEOUT_MS",
                "NEXTAUTH_SECRET",
                "NEXTAUTH_URL",
                "SECOND_BRAIN_INITIAL_INVITE_CODE",
                "OPENAI_BASE_URL",
                "OPENAI_API_KEY",
                "CHATMOCK_BASE_URL",
                "CODEX_HOME",
                "HERMES_HOME",
                "HERMES_BASE_URL",
                "HERMES_DASHBOARD_SESSION_TOKEN",
                "BREADBOARD_HERMES_TOOL_SECRET",
                "HERMES_CAPABILITY_SECRET",
                "HERMES_ENABLED",
                "HERMES_MODE",
                "HERMES_ROOT",
                "HERMES_SKILLS_QUARANTINE",
                "HERMES_SKILLS_APPROVED",
                "HERMES_SKILLS_CONDITIONAL",
                "HERMES_FIRST_PARTY_SKILLS_ROOT",
                "BREADBOARD_INTERNAL_URL",
                "BREADBOARD_RUNTIME_V2_ACTIVE",
                "GBRAIN_MODE",
                "GBRAIN_ADAPTER_URL",
                "GBRAIN_ADAPTER_SECRET",
                "GBRAIN_QUERY_TIMEOUT_MS",
                "OPENAI_BASE_URL",
                "OPENAI_API_KEY",
                "SOCIALS_MANAGER_MODE",
                "VIDEO_TRANSCRIPTION_ENABLED",
                "UI_TARS_MODE",
                "COLPALI_MODE",
                "HUMANIZER_MODE",
                "CLIPROXY_MODE",
                "CAD_MODE",
                "BREADBOARD_CAD_PORT",
                "BREADBOARD_COLPALI_HOME",
                "BREADBOARD_COLPALI_PORT",
                "BREADBOARD_HUMANIZER_DEVICE",
                "BREADBOARD_HUMANIZER_HOME",
                "BREADBOARD_HUMANIZER_PORT",
                "CAD_SERVICE_SECRET",
                "CAD_SERVICE_URL",
                "CLIPROXY_API_KEY",
                "CLIPROXY_BASE_URL",
                "CLIPROXY_HOME",
                "CLIPROXY_MANAGEMENT_KEY",
                "CLIPROXY_PORT",
                "COLPALI_SERVICE_SECRET",
                "COLPALI_SERVICE_URL",
                "DEEP_RESEARCH_MODE",
                "DEEP_RESEARCH_SECRET",
                "DEEP_RESEARCH_URL",
                "DEER_FLOW_SERVICE_URL",
                "DEER_FLOW_STATE_DIR",
                "HUMANIZER_SERVICE_SECRET",
                "HUMANIZER_SERVICE_URL",
                "STOCK_ANALYST_SERVICE_URL",
                "UI_TARS_ADAPTER_SECRET",
                "UI_TARS_ADAPTER_URL",
                "VIBE_TRADING_SERVICE_API_KEY",
                "VIBE_TRADING_SERVICE_URL",
                "VOICEBOX_BASE_URL",
                "VOICEBOX_STATUS_PATH",
            ])
            .find(|candidate| candidate.eq_ignore_ascii_case(name_text.as_ref()))
            .ok_or(TrustedServiceEnvironmentError::InvalidEnvironmentName {
                profile,
                name: name_text.into_owned(),
            })?;
        builder.insert(name, value.clone())?;
    }
    builder.insert(token_name, token)?;
    Ok(builder.finish())
}

fn build_chatmock_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    cliproxy_api_key: &str,
    config: &RequiredDesktopConfigV2,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Chatmock,
        paths,
        os_environment,
    )?;
    let ledger = paths.data_root().join(".breadboard").join("council-runs");
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("CODEX_HOME", codex_home(mode, paths).into_os_string())?;
    builder.insert("COUNCIL_LEDGER_DIR", ledger.as_os_str())?;
    builder.insert(
        "COUNCIL_REQUEST_RECEIPT_DIR",
        ledger.join("request-receipts").into_os_string(),
    )?;
    builder.insert("CHATMOCK_ALLOW_ENV_PROVIDER_KEYS", "false")?;
    if config.cliproxy_mode != "disabled" {
        builder.insert(
            "CLIPROXY_BASE_URL",
            format!(
                "{}/v1",
                endpoints.base_url(TrustedServiceEnvironmentSource::Cliproxy)
            ),
        )?;
        builder.insert("CLIPROXY_API_KEY", cliproxy_api_key)?;
    }
    Ok(builder.finish())
}

fn build_comfyui_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Comfyui,
        paths,
        os_environment,
    )?;
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert(
        "COMFYUI_ROOT",
        comfyui_toolchain_directory(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "COMFYUI_ENV_DIR",
        comfyui_environment_directory(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "COMFYUI_RUNTIME_DIR",
        comfyui_runtime_directory(paths).into_os_string(),
    )?;
    builder.insert(
        "COMFYUI_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Comfyui),
    )?;
    builder.insert(
        "COMFYUI_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Comfyui)
            .to_string(),
    )?;
    Ok(builder.finish())
}

fn build_hermes_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
    config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Hermes,
        paths,
        os_environment,
    )?;
    builder.insert("PYTHONUNBUFFERED", "1")?;
    builder.insert("PYTHONDONTWRITEBYTECODE", "1")?;
    builder.insert("HERMES_HOME", hermes_home(mode, paths).into_os_string())?;
    builder.insert("HERMES_DESKTOP", "1")?;
    builder.insert("HERMES_SERVE_HEADLESS", "1")?;
    builder.insert(
        "HERMES_DASHBOARD_SESSION_TOKEN",
        config.hermes_session_token.as_str(),
    )?;
    builder.insert(
        "BREADBOARD_INTERNAL_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard),
    )?;
    builder.insert(
        "BREADBOARD_HERMES_TOOL_SECRET",
        config.hermes_tool_secret.as_str(),
    )?;
    Ok(builder.finish())
}

const MAX_HERMES_RUNTIME_CONFIG_BYTES: usize = 32 * 1024;
const MAX_RUNTIME_ENDPOINT_RECEIPT_BYTES: usize = 8 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEndpointReceipt {
    pid: u32,
    started_at: String,
    urls: BTreeMap<&'static str, String>,
}

fn write_runtime_endpoint_receipt(
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    config: &RequiredDesktopConfigV2,
) -> Result<(), TrustedServiceEnvironmentError> {
    let dashboard = endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard);
    let mut urls = BTreeMap::from([
        (
            "chatmock",
            endpoints.base_url(TrustedServiceEnvironmentSource::Chatmock),
        ),
        ("dashboard", dashboard.clone()),
        // Quartz is served by the dashboard after the Runtime V2 cutover; the
        // compatibility key remains for QA and installed diagnostics.
        ("quartz", dashboard),
    ]);
    if config.gbrain_mode != "disabled" {
        urls.insert(
            "gbrain",
            endpoints.base_url(TrustedServiceEnvironmentSource::Gbrain),
        );
    }
    let receipt = RuntimeEndpointReceipt {
        pid: std::process::id(),
        started_at: runtime_started_at(),
        urls,
    };
    let bytes = serde_json::to_vec_pretty(&receipt).map_err(|_| {
        TrustedServiceEnvironmentError::InvalidDesktopConfigField {
            field: "runtimeEndpoints",
        }
    })?;
    drop(paths.atomic_replace_data_file(
        "runtime/endpoints.json",
        &bytes,
        MAX_RUNTIME_ENDPOINT_RECEIPT_BYTES,
    )?);
    Ok(())
}

fn runtime_started_at() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = duration.as_secs();
    let millis = duration.subsec_millis();
    let days = i64::try_from(seconds / 86_400).unwrap_or(i64::MAX);
    let second_of_day = seconds % 86_400;
    let hour = second_of_day / 3_600;
    let minute = (second_of_day % 3_600) / 60;
    let second = second_of_day % 60;
    // Proleptic Gregorian conversion for non-negative Unix days (Howard
    // Hinnant's civil-from-days transform), avoiding locale/timezone authority.
    let z = days.saturating_add(719_468);
    let era = z / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn write_hermes_runtime_config(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
) -> Result<(), TrustedServiceEnvironmentError> {
    let model = product_environment_value(os_environment, "CHATMOCK_MODEL")
        .and_then(OsStr::to_str)
        .unwrap_or("default");
    let model = serde_json::to_string(model).map_err(|_| {
        TrustedServiceEnvironmentError::InvalidEnvironmentValue {
            profile: TrustedServiceEnvironmentProfile::Hermes,
            name: "CHATMOCK_MODEL",
        }
    })?;
    let chatmock = serde_json::to_string(&endpoints.chatmock_v1_url()).map_err(|_| {
        TrustedServiceEnvironmentError::InvalidEnvironmentValue {
            profile: TrustedServiceEnvironmentProfile::Hermes,
            name: "CHATMOCK_BASE_URL",
        }
    })?;
    // Keep this value-by-value equivalent to the former Electron-generated
    // file. Comments were intentionally omitted: they are not configuration
    // authority and keeping the generated file compact reduces secret-adjacent
    // diagnostic surface.
    let yaml = format!(
        concat!(
            "# Generated by Breadboard. Hermes state is disposable and non-canonical.\n",
            "model:\n",
            "  default: {}\n",
            "  provider: custom\n",
            "  base_url: {}\n",
            "  supports_vision: true\n",
            "toolsets:\n",
            "  - breadboard\n",
            "  - web\n",
            "web:\n",
            "  search_backend: ddgs\n",
            "  extract_backend: fetch\n",
            "moa:\n",
            "  enabled: false\n",
            "  presets:\n",
            "    default:\n",
            "      enabled: false\n",
            "memory:\n",
            "  memory_enabled: false\n",
            "  user_profile_enabled: false\n",
            "display:\n",
            "  show_reasoning: true\n",
            "  busy_input_mode: steer\n",
            "  busy_steer_ack_enabled: false\n",
            "  memory_notifications: off\n",
            "tools:\n",
            "  tool_search:\n",
            "    enabled: on\n",
            "tool_loop_guardrails:\n",
            "  warnings_enabled: true\n",
            "  hard_stop_enabled: true\n",
            "agent:\n",
            "  coding_context: off\n",
            "  image_input_mode: native\n"
        ),
        model, chatmock
    );
    let relative = match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => ".runtime/hermes/config.yaml",
        RuntimeMode::Packaged => "runtime/hermes/config.yaml",
    };
    drop(paths.atomic_replace_data_file(
        relative,
        yaml.as_bytes(),
        MAX_HERMES_RUNTIME_CONFIG_BYTES,
    )?);
    Ok(())
}

fn build_gbrain_environment(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    endpoints: &ServiceEndpointMap,
    os_environment: &TrustedOsEnvironment,
    config: &RequiredDesktopConfigV2,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Gbrain,
        paths,
        os_environment,
    )?;
    builder.insert("GBRAIN_ADAPTER_HOST", "127.0.0.1")?;
    builder.insert(
        "GBRAIN_ADAPTER_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Gbrain)
            .to_string(),
    )?;
    builder.insert(
        "GBRAIN_ADAPTER_SECRET",
        config.gbrain_adapter_secret.as_str(),
    )?;
    builder.insert(
        "GBRAIN_DATA_DIR",
        paths.data_root().join("gbrain").into_os_string(),
    )?;
    builder.insert("GBRAIN_BACKEND", "gbrain")?;
    builder.insert("GBRAIN_EMBEDDING_PROVIDER", "openai-compatible")?;
    builder.insert("GBRAIN_EMBEDDING_BASE_URL", endpoints.chatmock_v1_url())?;
    builder.insert("GBRAIN_EMBEDDING_API_KEY", "local")?;
    builder.insert("GBRAIN_EMBEDDING_MODEL", "local/bge-small-en-v1.5")?;
    builder.insert("GBRAIN_EMBEDDING_DIMENSIONS", "384")?;
    builder.insert("GBRAIN_QUERY_TIMEOUT_MS", "15000")?;
    Ok(builder.finish())
}

struct DashboardEnvironmentInputs<'a> {
    mode: RuntimeMode,
    paths: &'a RuntimePaths,
    endpoints: &'a ServiceEndpointMap,
    control: &'a DashboardControlEnvironment,
    telegram_gateway_token: &'a str,
    whatsapp_gateway_token: &'a str,
    openwork_token: &'a str,
    openscience_token: &'a str,
    money_printer_token: &'a str,
    wardrobe_token: &'a str,
    mem0_token: &'a str,
    local_mcp_broker_token: &'a str,
    postiz_coordinator_token: &'a str,
    inbox_zero_token: &'a str,
    spotify_playback_token: &'a str,
    solidworks_mcp_token: &'a str,
    ui_tars_token: &'a str,
    cad_token: &'a str,
    colpali_token: &'a str,
    humanizer_token: &'a str,
    deep_research_token: &'a str,
    vibe_trading_token: &'a str,
    cliproxy_api_key: &'a str,
    cliproxy_management_key: &'a str,
    recall_api_key: &'a str,
    vlm_mode: &'a VlmOcrMode,
    os_environment: &'a TrustedOsEnvironment,
    config: &'a RequiredDesktopConfigV2,
}

fn build_dashboard_environment(
    inputs: DashboardEnvironmentInputs<'_>,
) -> Result<TrustedServiceEnvironment, TrustedServiceEnvironmentError> {
    let DashboardEnvironmentInputs {
        mode,
        paths,
        endpoints,
        control,
        telegram_gateway_token,
        whatsapp_gateway_token,
        openwork_token,
        openscience_token,
        money_printer_token,
        wardrobe_token,
        mem0_token,
        local_mcp_broker_token,
        postiz_coordinator_token,
        inbox_zero_token,
        spotify_playback_token,
        solidworks_mcp_token,
        ui_tars_token,
        cad_token,
        colpali_token,
        humanizer_token,
        deep_research_token,
        vibe_trading_token,
        cliproxy_api_key,
        cliproxy_management_key,
        recall_api_key,
        vlm_mode,
        os_environment,
        config,
    } = inputs;
    let mut builder = build_common_environment(
        mode,
        TrustedServiceEnvironmentProfile::Dashboard,
        paths,
        os_environment,
    )?;
    let dashboard_url = endpoints.base_url(TrustedServiceEnvironmentSource::Dashboard);
    let comfyui_url = endpoints.base_url(TrustedServiceEnvironmentSource::Comfyui);
    let gbrain_url = endpoints.base_url(TrustedServiceEnvironmentSource::Gbrain);
    let hermes_url = endpoints.base_url(TrustedServiceEnvironmentSource::Hermes);
    let chatmock_v1_url = endpoints.chatmock_v1_url();
    let ledger = paths.data_root().join(".breadboard").join("council-runs");
    let is_hot = mode == RuntimeMode::Hot;
    let is_packaged = mode == RuntimeMode::Packaged;

    builder.insert(
        "NODE_ENV",
        if is_hot { "development" } else { "production" },
    )?;
    // This trusted hot-only cap keeps Next's own post-request restart boundary
    // below the dashboard Job limit. Never inherit caller or shell options:
    // NODE_OPTIONS can also inject executable preloads.
    builder.insert(
        "NODE_OPTIONS",
        if is_hot {
            HOT_DASHBOARD_NODE_OPTIONS
        } else {
            ""
        },
    )?;
    builder.insert(
        "BREADBOARD_DASHBOARD_BUNDLER",
        if is_hot { "turbopack" } else { "standalone" },
    )?;
    builder.insert(
        "PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Dashboard)
            .to_string(),
    )?;
    builder.insert("HOSTNAME", "127.0.0.1")?;
    builder.insert(
        "BREADBOARD_DATA_DIR",
        // Electron QA deliberately separates dataRoot from appRoot. Preserve
        // that isolation in both hot and lean runs; ordinary development pins
        // both authorities to the checkout and therefore keeps the historical
        // empty override. Packaged mode always uses the explicit data layout.
        if is_packaged || paths.has_distinct_data_root() {
            paths.data_root().as_os_str()
        } else {
            OsStr::new("")
        },
    )?;
    builder.insert(
        "BREADBOARD_LOCAL_MCP_REGISTRY_ROOT",
        paths
            .data_root()
            .join("runtime-v2")
            .join("local-mcp-definitions")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
        if is_packaged {
            OsString::new()
        } else {
            paths.app_root().join("dashboard").into_os_string()
        },
    )?;
    builder.insert("BREADBOARD_REPO_ROOT", paths.app_root().as_os_str())?;
    builder.insert(
        "QUARTZ_CONTENT_PATH",
        quartz_content(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "NEXT_PUBLIC_QUARTZ_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Quartz),
    )?;
    builder.insert("COUNCIL_LEDGER_DIR", ledger.as_os_str())?;
    builder.insert("HERMES_HOME", hermes_home(mode, paths).into_os_string())?;
    insert_product_environment(&mut builder, os_environment)?;
    if let Some(token) = packaged_service_evidence_token(mode, os_environment)? {
        let endpoint_pairs = TrustedServiceEnvironmentSource::ALL
            .into_iter()
            .map(|source| (source, endpoints.base_url(source)))
            .collect::<Vec<_>>();
        let endpoint_json = serde_json::to_string(&endpoint_pairs).map_err(|_| {
            TrustedServiceEnvironmentError::InvalidEnvironmentValue {
                profile: TrustedServiceEnvironmentProfile::Dashboard,
                name: "BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS",
            }
        })?;
        builder.insert("BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN", token)?;
        builder.insert("BREADBOARD_PACKAGED_SERVICE_EVIDENCE", "1")?;
        builder.insert(
            "BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS",
            endpoint_json,
        )?;
    }

    let comfyui_enabled = config.comfy_ui_mode != "disabled";
    let comfyui_managed = config.comfy_ui_mode == "managed";
    builder.insert(
        "COMFYUI_ENABLED",
        if comfyui_enabled { "true" } else { "false" },
    )?;
    builder.insert(
        "COMFYUI_MANAGED",
        if comfyui_managed { "true" } else { "false" },
    )?;
    builder.insert(
        "COMFYUI_URL",
        if config.comfy_ui_mode == "external" {
            config
                .comfy_ui_external_url
                .as_deref()
                .expect("external ComfyUI configuration was validated")
        } else {
            comfyui_url.as_str()
        },
    )?;
    builder.insert(
        "COMFYUI_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Comfyui)
            .to_string(),
    )?;
    builder.insert(
        "COMFYUI_ROOT",
        comfyui_toolchain_directory(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "COMFYUI_ENV_DIR",
        comfyui_environment_directory(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "COMFYUI_RUNTIME_DIR",
        comfyui_runtime_directory(paths).into_os_string(),
    )?;
    builder.insert("COMFYUI_START_TIMEOUT_MS", "180000")?;
    builder.insert("COMFYUI_GENERATE_TIMEOUT_MS", "600000")?;

    builder.insert("NEXTAUTH_SECRET", config.next_auth_secret.as_str())?;
    builder.insert("NEXTAUTH_URL", dashboard_url.as_str())?;
    builder.insert(
        "SECOND_BRAIN_INITIAL_INVITE_CODE",
        config.initial_invite_code.as_str(),
    )?;

    builder.insert("OPENAI_BASE_URL", chatmock_v1_url.as_str())?;
    builder.insert("OPENAI_API_KEY", "local")?;
    builder.insert("CHATMOCK_BASE_URL", chatmock_v1_url.as_str())?;
    builder.insert(
        "CHATMOCK_MODEL",
        product_environment_value(os_environment, "CHATMOCK_MODEL")
            .unwrap_or_else(|| OsStr::new("default")),
    )?;

    builder.insert("CODEX_HOME", codex_home(mode, paths).into_os_string())?;
    builder.insert("HERMES_BASE_URL", hermes_url)?;
    builder.insert(
        "HERMES_DASHBOARD_SESSION_TOKEN",
        config.hermes_session_token.as_str(),
    )?;
    builder.insert(
        "BREADBOARD_HERMES_TOOL_SECRET",
        config.hermes_tool_secret.as_str(),
    )?;
    builder.insert(
        "HERMES_CAPABILITY_SECRET",
        config.hermes_capability_secret.as_str(),
    )?;
    builder.insert("HERMES_ENABLED", "true")?;
    builder.insert("HERMES_MODE", "required")?;
    builder.insert(
        "HERMES_ROOT",
        paths
            .data_root()
            .join("runtime")
            .join("hermes-workspaces")
            .into_os_string(),
    )?;
    builder.insert(
        "HERMES_SKILLS_QUARANTINE",
        paths
            .data_root()
            .join("skills")
            .join("quarantine")
            .into_os_string(),
    )?;
    builder.insert(
        "HERMES_SKILLS_APPROVED",
        paths
            .data_root()
            .join("skills")
            .join("approved")
            .into_os_string(),
    )?;
    builder.insert(
        "HERMES_SKILLS_CONDITIONAL",
        paths
            .data_root()
            .join("skills")
            .join("conditional")
            .into_os_string(),
    )?;
    builder.insert(
        "HERMES_FIRST_PARTY_SKILLS_ROOT",
        paths
            .app_root()
            .join("hermes-skills")
            .join("prebuilt")
            .into_os_string(),
    )?;

    builder.insert("BREADBOARD_INTERNAL_URL", dashboard_url)?;
    builder.insert("BREADBOARD_SUPERVISOR_CONTROL_URL", control.url.as_str())?;
    builder.insert(
        "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
        control.token.as_str(),
    )?;
    builder.insert("BREADBOARD_RUNTIME_V2_ACTIVE", "true")?;
    builder.insert(
        "BREADBOARD_TELEGRAM_GATEWAY_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::TelegramGateway),
    )?;
    builder.insert("BREADBOARD_TELEGRAM_GATEWAY_TOKEN", telegram_gateway_token)?;
    builder.insert(
        "BREADBOARD_WHATSAPP_GATEWAY_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::WhatsappGateway),
    )?;
    builder.insert("BREADBOARD_WHATSAPP_GATEWAY_TOKEN", whatsapp_gateway_token)?;
    for (name, source, token_name, token) in [
        (
            "BREADBOARD_OPENWORK_SERVICE_URL",
            TrustedServiceEnvironmentSource::Openwork,
            "BREADBOARD_OPENWORK_SERVICE_TOKEN",
            openwork_token,
        ),
        (
            "BREADBOARD_OPENSCIENCE_SERVICE_URL",
            TrustedServiceEnvironmentSource::Openscience,
            "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
            openscience_token,
        ),
        (
            "BREADBOARD_MONEY_PRINTER_SERVICE_URL",
            TrustedServiceEnvironmentSource::MoneyPrinter,
            "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
            money_printer_token,
        ),
        (
            "BREADBOARD_WARDROBE_SERVICE_URL",
            TrustedServiceEnvironmentSource::Wardrobe,
            "BREADBOARD_WARDROBE_SERVICE_TOKEN",
            wardrobe_token,
        ),
        (
            "BREADBOARD_MEM0_SERVICE_URL",
            TrustedServiceEnvironmentSource::Mem0SemanticEngine,
            "BREADBOARD_MEM0_SERVICE_TOKEN",
            mem0_token,
        ),
        (
            "BREADBOARD_LOCAL_MCP_BROKER_URL",
            TrustedServiceEnvironmentSource::LocalMcpBroker,
            "BREADBOARD_LOCAL_MCP_BROKER_TOKEN",
            local_mcp_broker_token,
        ),
        (
            "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL",
            TrustedServiceEnvironmentSource::PostizCoordinator,
            "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN",
            postiz_coordinator_token,
        ),
        (
            "BREADBOARD_INBOX_ZERO_SERVICE_URL",
            TrustedServiceEnvironmentSource::InboxZeroStack,
            "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN",
            inbox_zero_token,
        ),
        (
            "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_URL",
            TrustedServiceEnvironmentSource::SpotifyPlayback,
            "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN",
            spotify_playback_token,
        ),
        (
            "BREADBOARD_SOLIDWORKS_SERVICE_URL",
            TrustedServiceEnvironmentSource::SolidworksMcp,
            "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN",
            solidworks_mcp_token,
        ),
    ] {
        builder.insert(name, endpoints.base_url(source))?;
        builder.insert(token_name, token)?;
    }
    builder.insert(
        "WARDROBE_ROOT",
        match mode {
            RuntimeMode::Lean | RuntimeMode::Hot => paths.app_root().join("wardrobe"),
            RuntimeMode::Packaged => paths.app_root().join("wardrobe-runtime"),
        }
        .into_os_string(),
    )?;
    builder.insert(
        "WARDROBE_RUNTIME_ROOT",
        match mode {
            RuntimeMode::Lean | RuntimeMode::Hot => paths
                .data_root()
                .join("runtime-v2")
                .join("toolchains")
                .join("wardrobe"),
            RuntimeMode::Packaged => paths.app_root().join("wardrobe-runtime"),
        }
        .into_os_string(),
    )?;
    builder.insert(
        "WARDROBE_DATA_DIR",
        paths
            .data_root()
            .join("wardrobe")
            .join("data")
            .into_os_string(),
    )?;
    builder.insert(
        "WARDROBE_MODEL_REFERENCE",
        paths
            .data_root()
            .join("wardrobe")
            .join("data")
            .join("model-reference.png")
            .into_os_string(),
    )?;
    builder.insert(
        "PENECHO_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Penecho),
    )?;
    builder.insert(
        "PENECHO_PORT",
        endpoints
            .port_for(TrustedServiceEnvironmentSource::Penecho)
            .to_string(),
    )?;
    builder.insert("BREADBOARD_PENECHO_RUNTIME_MANAGED", "1")?;
    builder.insert("BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED", "1")?;
    builder.insert("BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED", "1")?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_MCP_PATH",
        paths
            .app_root()
            .join("SolidworksMCP-python")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_PYTHON",
        solidworks_python(mode, paths).into_os_string(),
    )?;
    match mode {
        RuntimeMode::Packaged => {
            builder.insert("BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME", "1")?;
        }
        RuntimeMode::Lean | RuntimeMode::Hot => {
            builder.insert(
                "BREADBOARD_UV_PATH",
                paths
                    .runtime_root()
                    .join("bin")
                    .join("uv.exe")
                    .into_os_string(),
            )?;
        }
    }
    builder.insert(
        "BREADBOARD_SOLIDWORKS_HOME",
        paths.data_root().join("solidworks").into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_SOLIDWORKS_WORKSPACE",
        paths
            .data_root()
            .join("solidworks")
            .join("workspaces")
            .into_os_string(),
    )?;
    copy_selected_product_environment(
        &mut builder,
        os_environment,
        &["BREADBOARD_SOLIDWORKS_EXE", "BREADBOARD_SOLIDWORKS_VERSION"],
    )?;
    builder.insert(
        "RECALL_BASE_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Recall),
    )?;
    builder.insert("RECALL_RUNTIME_MANAGED", "1")?;
    builder.insert("RECALL_API_KEY", recall_api_key)?;
    builder.insert(
        "RECALL_HOME",
        paths.data_root().join("recall").into_os_string(),
    )?;
    builder.insert(
        "RECALL_DATA_DIR",
        paths
            .data_root()
            .join("recall")
            .join("data")
            .into_os_string(),
    )?;
    builder.insert("VLM_OCR_BASE_URL", vlm_mode.base_url.as_str())?;
    builder.insert("VLM_OCR_AUTO_START", "0")?;
    if vlm_mode.managed {
        builder.insert("VLM_OCR_RUNTIME_MANAGED", "1")?;
    }

    builder.insert("GBRAIN_MODE", config.gbrain_mode.as_str())?;
    if config.gbrain_mode != "disabled" {
        builder.insert("GBRAIN_ADAPTER_URL", gbrain_url)?;
        builder.insert(
            "GBRAIN_ADAPTER_SECRET",
            config.gbrain_adapter_secret.as_str(),
        )?;
        builder.insert("GBRAIN_QUERY_TIMEOUT_MS", "15000")?;
    }

    builder.insert("SOCIALS_MANAGER_MODE", "stack")?;
    builder.insert(
        "SOCIALS_MANAGER_URL",
        format!(
            "http://127.0.0.1:{}",
            endpoints.auxiliary_port_for(ServiceAuxiliaryEndpoint::PostizWeb)
        ),
    )?;
    builder.insert(
        "VOICEBOX_BASE_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::Voicebox),
    )?;
    builder.insert(
        "VOICEBOX_STATUS_PATH",
        paths
            .data_root()
            .join("runtime")
            .join("voicebox")
            .join("startup-status.json")
            .into_os_string(),
    )?;
    builder.insert(
        "VIDEO_TRANSCRIPTION_ENABLED",
        if config.scriberr_enabled {
            "true"
        } else {
            "false"
        },
    )?;
    if config.scriberr_enabled {
        let scriberr_url = config
            .scriberr_base_url
            .clone()
            .unwrap_or_else(|| endpoints.base_url(TrustedServiceEnvironmentSource::Scriberr));
        builder.insert("SCRIBERR_BASE_URL", scriberr_url)?;
        builder.insert("SCRIBERR_USERNAME", config.scriberr_username.as_str())?;
        builder.insert("SCRIBERR_PASSWORD", config.scriberr_password.as_str())?;
    }
    builder.insert("UI_TARS_MODE", config.ui_tars_mode.as_str())?;
    if config.ui_tars_mode != "disabled" {
        builder.insert(
            "UI_TARS_ADAPTER_URL",
            endpoints.base_url(TrustedServiceEnvironmentSource::UiTars),
        )?;
        builder.insert("UI_TARS_ADAPTER_SECRET", ui_tars_token)?;
    }
    builder.insert(
        "COLPALI_MODE",
        if config.colpali_mode == "disabled" {
            "disabled"
        } else {
            "auto"
        },
    )?;
    if config.colpali_mode != "disabled" {
        builder.insert(
            "COLPALI_SERVICE_URL",
            endpoints.base_url(TrustedServiceEnvironmentSource::Colpali),
        )?;
        builder.insert("COLPALI_SERVICE_SECRET", colpali_token)?;
        builder.insert(
            "BREADBOARD_COLPALI_PORT",
            endpoints
                .port_for(TrustedServiceEnvironmentSource::Colpali)
                .to_string(),
        )?;
        builder.insert(
            "BREADBOARD_COLPALI_HOME",
            paths
                .data_root()
                .join("runtime")
                .join("colpali")
                .into_os_string(),
        )?;
    }
    builder.insert("HUMANIZER_MODE", config.humanizer_mode.as_str())?;
    if config.humanizer_mode != "disabled" {
        builder.insert(
            "HUMANIZER_SERVICE_URL",
            endpoints.base_url(TrustedServiceEnvironmentSource::Humanizer),
        )?;
        builder.insert("HUMANIZER_SERVICE_SECRET", humanizer_token)?;
        builder.insert(
            "BREADBOARD_HUMANIZER_PORT",
            endpoints
                .port_for(TrustedServiceEnvironmentSource::Humanizer)
                .to_string(),
        )?;
        builder.insert(
            "BREADBOARD_HUMANIZER_HOME",
            paths
                .data_root()
                .join("runtime")
                .join("humanizer")
                .into_os_string(),
        )?;
        builder.insert(
            "BREADBOARD_HUMANIZER_DEVICE",
            config.humanizer_device.as_str(),
        )?;
    }
    builder.insert("CLIPROXY_MODE", config.cliproxy_mode.as_str())?;
    if config.cliproxy_mode != "disabled" {
        builder.insert(
            "CLIPROXY_HOME",
            paths.data_root().join("cliproxy").into_os_string(),
        )?;
        builder.insert(
            "CLIPROXY_PORT",
            endpoints
                .port_for(TrustedServiceEnvironmentSource::Cliproxy)
                .to_string(),
        )?;
        builder.insert(
            "CLIPROXY_BASE_URL",
            format!(
                "{}/v1",
                endpoints.base_url(TrustedServiceEnvironmentSource::Cliproxy)
            ),
        )?;
        builder.insert("CLIPROXY_API_KEY", cliproxy_api_key)?;
        builder.insert("CLIPROXY_MANAGEMENT_KEY", cliproxy_management_key)?;
    }
    builder.insert("CAD_MODE", config.cad_mode.as_str())?;
    if config.cad_mode != "disabled" {
        builder.insert(
            "CAD_SERVICE_URL",
            endpoints.base_url(TrustedServiceEnvironmentSource::Cad),
        )?;
        builder.insert("CAD_SERVICE_SECRET", cad_token)?;
        builder.insert(
            "BREADBOARD_CAD_PORT",
            endpoints
                .port_for(TrustedServiceEnvironmentSource::Cad)
                .to_string(),
        )?;
    }
    builder.insert("DEEP_RESEARCH_MODE", "optional")?;
    builder.insert(
        "DEEP_RESEARCH_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::DeepResearch),
    )?;
    builder.insert("DEEP_RESEARCH_SECRET", deep_research_token)?;
    builder.insert(
        "DEER_FLOW_SERVICE_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::DeerFlow),
    )?;
    builder.insert(
        "DEER_FLOW_STATE_DIR",
        paths
            .data_root()
            .join("runtime")
            .join("deer-flow")
            .into_os_string(),
    )?;
    builder.insert(
        "VIBE_TRADING_SERVICE_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::VibeTrading),
    )?;
    builder.insert("VIBE_TRADING_SERVICE_API_KEY", vibe_trading_token)?;
    builder.insert(
        "STOCK_ANALYST_SERVICE_URL",
        endpoints.base_url(TrustedServiceEnvironmentSource::StockAnalyst),
    )?;
    builder.insert(
        "BREADBOARD_GRAFT_CLI",
        graft_cli_path(mode, paths, os_environment).into_os_string(),
    )?;
    builder.insert(
        "OPENCODE_BIN",
        opencode_binary_path(mode, paths).into_os_string(),
    )?;
    builder.insert(
        "OPENCODE_ROOT",
        paths.app_root().join("opencode").into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_OPENCODE_CONFIG",
        paths
            .app_root()
            .join("opencode-config")
            .join("opencode.json")
            .into_os_string(),
    )?;
    builder.insert(
        "TRADINGAGENTS_ROOT",
        paths.app_root().join("tradingagents").into_os_string(),
    )?;
    builder.insert(
        "TRADINGAGENTS_CREDENTIALS_FILE",
        paths
            .data_root()
            .join("runtime-v2")
            .join("services")
            .join("tradingagents")
            .join("credentials.json")
            .into_os_string(),
    )?;
    builder.insert(
        "CAREER_OPS_ROOT",
        paths.app_root().join("career-ops").into_os_string(),
    )?;
    builder.insert(
        "PLAYWRIGHT_BROWSERS_PATH",
        paths
            .data_root()
            .join("runtime-v2")
            .join("toolchains")
            .join("career-ops-browsers")
            .into_os_string(),
    )?;
    builder.insert(
        "BREADBOARD_IFIXAI_MODE",
        product_environment_value(os_environment, "BREADBOARD_IFIXAI_MODE")
            .unwrap_or_else(|| OsStr::new("")),
    )?;

    Ok(builder.finish())
}

fn graft_cli_path(
    mode: RuntimeMode,
    paths: &RuntimePaths,
    os_environment: &TrustedOsEnvironment,
) -> PathBuf {
    if mode == RuntimeMode::Packaged {
        return paths.app_root().join("graft").join("dist").join("cli.js");
    }
    if let Some(explicit) = product_environment_value(os_environment, "BREADBOARD_GRAFT_CLI") {
        let explicit = PathBuf::from(explicit);
        if explicit.is_absolute() {
            return explicit;
        }
    }
    if let Some((_, app_data)) = os_environment
        .optional
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("APPDATA"))
    {
        return PathBuf::from(app_data)
            .join("npm")
            .join("node_modules")
            .join("@nanonets")
            .join("graft")
            .join("dist")
            .join("cli.js");
    }
    paths
        .app_root()
        .join(".runtime")
        .join("graft")
        .join("dist")
        .join("cli.js")
}

fn opencode_binary_path(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Packaged => paths
            .app_root()
            .join("opencode")
            .join("bin")
            .join("opencode.exe"),
        RuntimeMode::Lean | RuntimeMode::Hot => paths
            .app_root()
            .join("opencode")
            .join("packages")
            .join("opencode")
            .join("dist")
            .join("opencode-windows-x64")
            .join("bin")
            .join("opencode.exe"),
    }
}

fn agent_browser_executable_path(
    _paths: &RuntimePaths,
    os_environment: &TrustedOsEnvironment,
) -> PathBuf {
    let is_direct_regular_file = |candidate: &Path| {
        let Ok(metadata) = std::fs::symlink_metadata(candidate) else {
            return false;
        };
        metadata.is_file() && !metadata.file_type().is_symlink()
    };
    if let Some(explicit) =
        product_environment_value(os_environment, "AGENT_BROWSER_EXECUTABLE_PATH")
    {
        let explicit = PathBuf::from(explicit);
        if explicit.is_absolute() && is_direct_regular_file(&explicit) {
            return explicit;
        }
    }
    let optional_path = |name: &str| {
        os_environment
            .optional
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
            .map(|(_, value)| PathBuf::from(value))
    };
    let program_files =
        optional_path("PROGRAMFILES").unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let program_files_x86 = optional_path("PROGRAMFILES(X86)")
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
    let candidates = [
        program_files.join("Google/Chrome/Application/chrome.exe"),
        program_files_x86.join("Google/Chrome/Application/chrome.exe"),
        program_files_x86.join("Microsoft/Edge/Application/msedge.exe"),
        program_files.join("Microsoft/Edge/Application/msedge.exe"),
    ];
    candidates
        .iter()
        .find(|candidate| is_direct_regular_file(candidate))
        .cloned()
        .unwrap_or_else(|| candidates[2].clone())
}

fn git_binary_path(
    mode: RuntimeMode,
    _paths: &RuntimePaths,
    os_environment: &TrustedOsEnvironment,
) -> PathBuf {
    if mode != RuntimeMode::Packaged {
        if let Some(explicit) = product_environment_value(os_environment, "BREADBOARD_GIT_BIN") {
            let explicit = PathBuf::from(explicit);
            if explicit.is_absolute() {
                return explicit;
            }
        }
    }
    if let Some((_, program_files)) = os_environment
        .optional
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("PROGRAMFILES"))
    {
        return PathBuf::from(program_files)
            .join("Git")
            .join("cmd")
            .join("git.exe");
    }
    PathBuf::from(&os_environment.system_root)
        .join("System32")
        .join("git.exe")
}

fn git_bash_path(os_environment: &TrustedOsEnvironment) -> Option<PathBuf> {
    let is_direct_regular_file = |candidate: &Path| {
        let Ok(metadata) = std::fs::symlink_metadata(candidate) else {
            return false;
        };
        metadata.is_file() && !metadata.file_type().is_symlink()
    };
    let optional_path = |name: &str| {
        os_environment
            .optional
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
            .map(|(_, value)| PathBuf::from(value))
    };
    let program_files =
        optional_path("PROGRAMFILES").unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let program_files_x86 = optional_path("PROGRAMFILES(X86)")
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
    [
        program_files.join("Git/bin/bash.exe"),
        program_files.join("Git/usr/bin/bash.exe"),
        program_files_x86.join("Git/bin/bash.exe"),
        program_files_x86.join("Git/usr/bin/bash.exe"),
    ]
    .into_iter()
    .find(|candidate| is_direct_regular_file(candidate))
}

fn docker_cli_path(os_environment: &TrustedOsEnvironment) -> PathBuf {
    let is_direct_regular_file = |candidate: &Path| {
        let Ok(metadata) = std::fs::symlink_metadata(candidate) else {
            return false;
        };
        metadata.is_file() && !metadata.file_type().is_symlink()
    };
    if let Some(explicit) = product_environment_value(os_environment, "DOCKER_CLI_PATH") {
        let explicit = PathBuf::from(explicit);
        if explicit.is_absolute() && is_direct_regular_file(&explicit) {
            return explicit;
        }
    }
    let program_files = os_environment
        .optional
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("PROGRAMFILES"))
        .map(|(_, value)| PathBuf::from(value))
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    program_files
        .join("Docker")
        .join("Docker")
        .join("resources")
        .join("bin")
        .join("docker.exe")
}

fn codex_home(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => {
            paths.app_root().join(".runtime").join("codex-desktop")
        }
        RuntimeMode::Packaged => paths.data_root().join("runtime").join("codex"),
    }
}

fn hermes_home(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => paths.data_root().join(".runtime").join("hermes"),
        RuntimeMode::Packaged => paths.data_root().join("runtime").join("hermes"),
    }
}

fn comfyui_toolchain_directory(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => paths
            .data_root()
            .join("runtime-v2")
            .join("toolchains")
            .join("comfyui"),
        RuntimeMode::Packaged => paths.app_root().join("comfyui"),
    }
}

fn comfyui_environment_directory(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => comfyui_runtime_directory(paths).join(".venv"),
        RuntimeMode::Packaged => paths.runtime_root().join("runtimes").join("comfyui-python"),
    }
}

fn comfyui_runtime_directory(paths: &RuntimePaths) -> PathBuf {
    paths
        .data_root()
        .join("runtime-v2")
        .join("services")
        .join("comfyui")
}

fn quartz_content(mode: RuntimeMode, paths: &RuntimePaths) -> PathBuf {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot if !paths.has_distinct_data_root() => {
            paths.app_root().join("quartz").join("content")
        }
        RuntimeMode::Lean | RuntimeMode::Hot | RuntimeMode::Packaged => {
            paths.data_root().join("quartz").join("content")
        }
    }
}

fn join_closed_windows_path(
    components: &[&Path],
) -> Result<OsString, TrustedServiceEnvironmentError> {
    let mut joined = OsString::new();
    for (index, component) in components.iter().enumerate() {
        let text = component.as_os_str();
        if text.is_empty()
            || text
                .to_string_lossy()
                .chars()
                .any(|character| matches!(character, ';' | '\0'))
        {
            return Err(TrustedServiceEnvironmentError::InvalidDerivedPath { field: "PATH" });
        }
        if index > 0 {
            joined.push(";");
        }
        joined.push(text);
    }
    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::*;
    use breadboard_runtime_protocol::{
        ServiceExecutableAuthority, ServiceInstallProbe, ServiceResourceLimits,
        ServiceWorkingDirectoryPolicy,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;
    use tempfile::TempDir;

    const NEXT_AUTH_SECRET: &str = "next-auth-secret-0123456789-abcdef";
    const GBRAIN_ADAPTER_SECRET: &str = "gbrain-adapter-secret-0123456789-ab";
    const HERMES_SESSION_TOKEN: &str = "hermes-session-token-0123456789-ab";
    const HERMES_TOOL_SECRET: &str = "hermes-tool-secret-0123456789-abcd";
    const HERMES_CAPABILITY_SECRET: &str = "hermes-capability-secret-0123456789";
    const CONTROL_TOKEN: &str = "control-token-0123456789-abcdefgh";
    const MEMORY_EVIDENCE_TOKEN: &str =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn fixture() -> (
        TempDir,
        RuntimePaths,
        TrustedDirectoryPin,
        TrustedOsEnvironment,
    ) {
        let temporary = TempDir::new().unwrap();
        let data = temporary.path().join("data");
        let app = temporary.path().join("app");
        let runtime = temporary.path().join("runtime");
        let config = temporary.path().join("config");
        for directory in [&data, &app, &runtime, &config] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(
            config.join(DESKTOP_CONFIG_FILE),
            serde_json::to_vec(&json!({
                "version": 2,
                "nextAuthSecret": NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": HERMES_SESSION_TOKEN,
                "hermesToolSecret": HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789",
                "unrelatedProviderSecret": "must-not-enter-any-environment"
            }))
            .unwrap(),
        )
        .unwrap();
        let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
        let config = TrustedDirectoryPin::pin_existing("configuration", config).unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            Vec::new(),
        )
        .unwrap();
        (temporary, paths, config, os_environment)
    }

    fn control() -> DashboardControlEnvironment {
        DashboardControlEnvironment::new("http://127.0.0.1:7739", CONTROL_TOKEN).unwrap()
    }

    fn endpoints() -> ServiceEndpointMap {
        ServiceEndpointMap::new(
            [
                7737, 7741, 7738, 7739, 7740, 7742, 7743, 7744, 7745, 7746, 7747, 7748, 7749, 7750,
                7751, 7752, 7753, 7754, 7755, 7756, 7757, 7758, 7759, 7760, 7761, 7762, 7763, 7764,
                7765, 7766, 7767, 7768,
            ],
            [7770, 7771, 7772, 7773, 7774],
        )
        .unwrap()
    }

    fn launch_profile(
        mode: RuntimeMode,
        source: TrustedServiceEnvironmentSource,
    ) -> ServiceLaunchProfile {
        ServiceLaunchProfile {
            modes: vec![mode],
            executable_authority: ServiceExecutableAuthority::RuntimeRoot,
            allowed_executable: "runtime.exe".to_string(),
            arguments: Vec::new(),
            environment_source: source,
            working_directory: ServiceWorkingDirectoryPolicy::AppRoot,
            install_probe: ServiceInstallProbe::FilesPresent { files: Vec::new() },
            resource_limits: ServiceResourceLimits {
                estimated_cold_start_commit_mb: 1,
                soft_commit_limit_mb: 0,
                hard_commit_limit_mb: 2,
            },
        }
    }

    fn values(environment: &TrustedServiceEnvironment) -> HashMap<String, String> {
        environment
            .pairs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.to_string_lossy().into_owned(),
                )
            })
            .collect()
    }

    fn worker_values(environment: &TrustedWorkerEnvironment) -> HashMap<String, String> {
        environment
            .pairs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.to_string_lossy().into_owned(),
                )
            })
            .collect()
    }

    fn assert_exact_names(values: &HashMap<String, String>, expected: &[&str]) {
        let actual: HashSet<_> = values.keys().map(String::as_str).collect();
        let expected: HashSet<_> = expected.iter().copied().collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn solidworks_uses_only_the_immutable_interpreter_in_packaged_mode() {
        let (_temporary, paths, config, os_environment) = fixture();
        let token = "solidworks-token-0123456789-abcdef";

        for mode in [RuntimeMode::Lean, RuntimeMode::Hot] {
            let environment = values(
                &build_solidworks_mcp_environment(
                    mode,
                    &paths,
                    &endpoints(),
                    token,
                    &os_environment,
                )
                .unwrap(),
            );
            assert_eq!(
                environment["BREADBOARD_SOLIDWORKS_PYTHON"],
                runtime_v2_service_python(&paths, "solidworks-mcp").to_string_lossy()
            );
            assert!(!environment.contains_key("BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME"));
            for installer_name in [
                "BREADBOARD_SOLIDWORKS_BASE_PYTHON",
                "BREADBOARD_UV_PATH",
                "UV_PROJECT_ENVIRONMENT",
                "UV_CACHE_DIR",
            ] {
                assert!(environment.contains_key(installer_name));
            }
        }

        let packaged = values(
            &build_solidworks_mcp_environment(
                RuntimeMode::Packaged,
                &paths,
                &endpoints(),
                token,
                &os_environment,
            )
            .unwrap(),
        );
        assert_eq!(packaged["BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME"], "1");
        assert_eq!(
            packaged["BREADBOARD_SOLIDWORKS_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes")
                .join("solidworks-python")
                .join(if cfg!(windows) {
                    "python.exe"
                } else {
                    "bin/python"
                })
                .to_string_lossy()
        );
        for installer_name in [
            "BREADBOARD_SOLIDWORKS_BASE_PYTHON",
            "BREADBOARD_UV_PATH",
            "UV_PROJECT_ENVIRONMENT",
            "UV_CACHE_DIR",
        ] {
            assert!(!packaged.contains_key(installer_name));
        }

        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let dashboard = values(&services.dashboard);
        assert_eq!(dashboard["BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME"], "1");
        assert_eq!(
            dashboard["BREADBOARD_SOLIDWORKS_PYTHON"],
            packaged["BREADBOARD_SOLIDWORKS_PYTHON"]
        );
        assert!(!dashboard.contains_key("BREADBOARD_UV_PATH"));
    }

    #[test]
    fn vlm_ocr_packaged_mode_uses_only_bundled_runtime_and_models() {
        let (_temporary, paths, _config, os_environment) = fixture();
        let managed = VlmOcrMode {
            managed: true,
            base_url: "http://127.0.0.1:7750/v1".to_owned(),
        };

        for mode in [RuntimeMode::Lean, RuntimeMode::Hot] {
            let environment = values(
                &build_vlm_ocr_environment(mode, &paths, &endpoints(), &os_environment, &managed)
                    .unwrap(),
            );
            assert!(!environment.contains_key("VLM_OCR_SERVER_BINARY"));
            assert!(!environment.contains_key("VLM_OCR_MODEL_PATH"));
            assert!(!environment.contains_key("VLM_OCR_MMPROJ_PATH"));
        }

        let packaged = values(
            &build_vlm_ocr_environment(
                RuntimeMode::Packaged,
                &paths,
                &endpoints(),
                &os_environment,
                &managed,
            )
            .unwrap(),
        );
        let vlm_root = paths.runtime_root().join("bin").join("vlm-ocr");
        assert_eq!(
            packaged["VLM_OCR_SERVER_BINARY"],
            vlm_root
                .join("runtime")
                .join("llama-server.exe")
                .to_string_lossy()
        );
        assert_eq!(
            packaged["VLM_OCR_MODEL_PATH"],
            vlm_root
                .join("models")
                .join("HunyuanOCR-Q8_0.gguf")
                .to_string_lossy()
        );
        assert_eq!(
            packaged["VLM_OCR_MMPROJ_PATH"],
            vlm_root
                .join("models")
                .join("mmproj-HunyuanOCR-Q8_0.gguf")
                .to_string_lossy()
        );
        assert!(!packaged.contains_key("VLM_OCR_HF_REPO"));
    }

    #[test]
    fn openwork_uses_immutable_packaged_runtime_and_writable_development_runtime() {
        let (_temporary, paths, _config, os_environment) = fixture();
        let token = "openwork-token-0123456789-abcdef";

        for mode in [RuntimeMode::Lean, RuntimeMode::Hot] {
            let environment =
                values(&build_openwork_environment(mode, &paths, token, &os_environment).unwrap());
            assert_eq!(
                environment["OPENWORK_SERVER_RUNTIME_ROOT"],
                paths.data_root().join("openwork-runtime").to_string_lossy()
            );
            assert_eq!(
                environment["OPENCODE_BIN"],
                paths
                    .app_root()
                    .join("opencode/packages/opencode/dist/opencode-windows-x64/bin/opencode.exe")
                    .to_string_lossy()
            );
        }

        let packaged = values(
            &build_openwork_environment(RuntimeMode::Packaged, &paths, token, &os_environment)
                .unwrap(),
        );
        assert_eq!(
            packaged["OPENWORK_SERVER_RUNTIME_ROOT"],
            paths.app_root().join("openwork-runtime").to_string_lossy()
        );
        assert_eq!(
            packaged["OPENCODE_BIN"],
            paths
                .app_root()
                .join("opencode/bin/opencode.exe")
                .to_string_lossy()
        );
        assert_eq!(
            packaged["OPENWORK_WORKSPACE_ROOT"],
            paths
                .data_root()
                .join("openwork-workspace")
                .to_string_lossy()
        );
        assert_eq!(
            packaged["OPENWORK_SERVER_STATE_ROOT"],
            paths.data_root().join("openwork-state").to_string_lossy()
        );
    }

    #[test]
    fn comfyui_and_wardrobe_use_immutable_packaged_runtimes_and_writable_state() {
        let (_temporary, paths, _config, os_environment) = fixture();
        let endpoints = endpoints();

        for mode in [RuntimeMode::Lean, RuntimeMode::Hot] {
            let comfyui = values(
                &build_comfyui_environment(mode, &paths, &endpoints, &os_environment).unwrap(),
            );
            assert_eq!(
                comfyui["COMFYUI_ROOT"],
                paths
                    .data_root()
                    .join("runtime-v2/toolchains/comfyui")
                    .to_string_lossy()
            );
            assert_eq!(
                comfyui["COMFYUI_ENV_DIR"],
                paths
                    .data_root()
                    .join("runtime-v2/services/comfyui/.venv")
                    .to_string_lossy()
            );

            let wardrobe = values(
                &build_wardrobe_environment(
                    mode,
                    &paths,
                    &endpoints,
                    "wardrobe-token-0123456789-abcdef",
                    &os_environment,
                )
                .unwrap(),
            );
            assert_eq!(
                wardrobe["WARDROBE_ROOT"],
                paths.app_root().join("wardrobe").to_string_lossy()
            );
            assert_eq!(
                wardrobe["WARDROBE_RUNTIME_ROOT"],
                paths
                    .data_root()
                    .join("runtime-v2/toolchains/wardrobe")
                    .to_string_lossy()
            );
        }

        let comfyui = values(
            &build_comfyui_environment(RuntimeMode::Packaged, &paths, &endpoints, &os_environment)
                .unwrap(),
        );
        assert_eq!(
            comfyui["COMFYUI_ROOT"],
            paths.app_root().join("comfyui").to_string_lossy()
        );
        assert_eq!(
            comfyui["COMFYUI_ENV_DIR"],
            paths
                .runtime_root()
                .join("runtimes/comfyui-python")
                .to_string_lossy()
        );
        assert_eq!(
            comfyui["COMFYUI_RUNTIME_DIR"],
            paths
                .data_root()
                .join("runtime-v2/services/comfyui")
                .to_string_lossy()
        );

        let wardrobe = values(
            &build_wardrobe_environment(
                RuntimeMode::Packaged,
                &paths,
                &endpoints,
                "wardrobe-token-0123456789-abcdef",
                &os_environment,
            )
            .unwrap(),
        );
        assert_eq!(
            wardrobe["WARDROBE_ROOT"],
            paths.app_root().join("wardrobe-runtime").to_string_lossy()
        );
        assert_eq!(
            wardrobe["WARDROBE_RUNTIME_ROOT"],
            paths.app_root().join("wardrobe-runtime").to_string_lossy()
        );
        assert_eq!(
            wardrobe["WARDROBE_DATA_DIR"],
            paths.data_root().join("wardrobe/data").to_string_lossy()
        );
    }

    #[test]
    fn endpoint_allocations_are_nonzero_and_distinct() {
        assert!(ServiceEndpointMap::new(
            [
                0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
                24, 25, 26, 27, 28, 29, 30, 31, 32
            ],
            [33, 34, 35, 36, 37],
        )
        .is_err());
        for duplicate_index in 1..TrustedServiceEnvironmentSource::COUNT {
            let mut ports = [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
                24, 25, 26, 27, 28, 29, 30, 31, 32,
            ];
            ports[duplicate_index] = ports[duplicate_index - 1];
            assert!(ServiceEndpointMap::new(ports, [33, 34, 35, 36, 37]).is_err());
        }
        let allocations = ServiceEndpointMap::new(
            [
                41_001, 41_002, 41_003, 41_004, 41_005, 41_006, 41_007, 41_008, 41_009, 41_010,
                41_011, 41_012, 41_013, 41_014, 41_015, 41_016, 41_017, 41_018, 41_019, 41_020,
                41_021, 41_022, 41_023, 41_024, 41_025, 41_026, 41_027, 41_028, 41_029, 41_030,
                41_031, 41_032,
            ],
            [41_033, 41_034, 41_035, 41_036, 41_037],
        )
        .unwrap();
        let observed =
            TrustedServiceEnvironmentSource::ALL.map(|source| allocations.port_for(source).get());
        assert_eq!(
            observed,
            [
                41_001, 41_002, 41_003, 41_004, 41_005, 41_006, 41_007, 41_008, 41_009, 41_010,
                41_011, 41_012, 41_013, 41_014, 41_015, 41_016, 41_017, 41_018, 41_019, 41_020,
                41_021, 41_022, 41_023, 41_024, 41_025, 41_026, 41_027, 41_028, 41_029, 41_030,
                41_031, 41_032,
            ]
        );
        assert_eq!(
            ServiceAuxiliaryEndpoint::ALL
                .map(|endpoint| allocations.auxiliary_port_for(endpoint).get()),
            [41_033, 41_034, 41_035, 41_036, 41_037],
        );
        assert!(ServiceEndpointMap::new(
            [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
                24, 25, 26, 27, 28, 29, 30, 31, 32
            ],
            [32, 34, 35, 36, 37],
        )
        .is_err());
        assert_eq!(
            endpoints()
                .port_for(TrustedServiceEnvironmentSource::Hermes)
                .get(),
            7740
        );
    }

    #[test]
    fn dashboard_control_requires_a_canonical_loopback_origin_and_bounded_token() {
        assert!(DashboardControlEnvironment::new("http://127.0.0.1:7739", CONTROL_TOKEN).is_ok());
        for invalid in [
            "http://localhost:7739",
            "https://127.0.0.1:7739",
            "http://127.0.0.1:7739/",
            "http://127.0.0.1:0",
            "http://127.0.0.1:07739",
        ] {
            assert!(DashboardControlEnvironment::new(invalid, CONTROL_TOKEN).is_err());
        }
        assert!(DashboardControlEnvironment::new("http://127.0.0.1:7739", "short").is_err());
    }

    #[test]
    fn environment_builder_rejects_case_insensitive_duplicates_and_redacts_values() {
        let mut builder = EnvironmentBuilder::new(
            RuntimeMode::Lean,
            TrustedServiceEnvironmentProfile::Dashboard,
        );
        builder.insert("PATH", "first-secret-value").unwrap();
        assert!(matches!(
            builder.insert("Path", "second-secret-value"),
            Err(TrustedServiceEnvironmentError::DuplicateEnvironmentName { .. })
        ));
        let environment = builder.finish();
        let debug = format!("{environment:?}");
        assert!(!debug.contains("first-secret-value"));
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn electron_product_values_receive_their_closed_bounds_without_reclassifying_os_paths() {
        assert!(TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![("QUARTZ_BUILD_CONCURRENCY", OsString::from("16"))],
        )
        .is_ok());
        assert!(matches!(
            TrustedOsEnvironment::from_captured_values(
                OsString::from(r"C:\Windows"),
                vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
                vec![("QUARTZ_BUILD_CONCURRENCY", OsString::from("17"))],
            ),
            Err(TrustedOsEnvironmentCaptureError::InvalidVariable)
        ));
    }

    #[test]
    fn packaged_memory_evidence_token_reaches_only_the_dashboard() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![(
                "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
                OsString::from(MEMORY_EVIDENCE_TOKEN),
            )],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let dashboard = values(
            &services
                .prepare_for_launch_profile(
                    "dashboard",
                    &launch_profile(
                        RuntimeMode::Packaged,
                        TrustedServiceEnvironmentSource::Dashboard,
                    ),
                )
                .unwrap(),
        );
        assert_eq!(
            dashboard["BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN"],
            MEMORY_EVIDENCE_TOKEN
        );
        assert_eq!(dashboard["BREADBOARD_PACKAGED_SERVICE_EVIDENCE"], "1");
        let endpoint_pairs: Vec<(TrustedServiceEnvironmentSource, String)> =
            serde_json::from_str(&dashboard["BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS"])
                .unwrap();
        assert_eq!(endpoint_pairs.len(), TrustedServiceEnvironmentSource::COUNT);
        assert!(endpoint_pairs.iter().any(|(source, url)| {
            *source == TrustedServiceEnvironmentSource::Gbrain
                && url.starts_with("http://127.0.0.1:")
        }));

        let telegram = values(
            &services
                .prepare_for_launch_profile(
                    "telegram-gateway",
                    &launch_profile(
                        RuntimeMode::Packaged,
                        TrustedServiceEnvironmentSource::TelegramGateway,
                    ),
                )
                .unwrap(),
        );
        assert!(!telegram.contains_key("BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN"));
        assert!(!telegram.contains_key("BREADBOARD_PACKAGED_SERVICE_EVIDENCE"));
        assert!(!telegram.contains_key("BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS"));
    }

    #[test]
    fn memory_evidence_token_is_absent_outside_packaged_mode_and_invalid_values_fail_closed() {
        let (_temporary, paths, config, _) = fixture();
        let valid_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![(
                "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
                OsString::from(MEMORY_EVIDENCE_TOKEN),
            )],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Lean,
            &paths,
            &config,
            &endpoints(),
            control(),
            &valid_environment,
        )
        .unwrap();
        let dashboard = values(
            &services
                .prepare_for_launch_profile(
                    "dashboard",
                    &launch_profile(
                        RuntimeMode::Lean,
                        TrustedServiceEnvironmentSource::Dashboard,
                    ),
                )
                .unwrap(),
        );
        assert!(!dashboard.contains_key("BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN"));
        assert!(!dashboard.contains_key("BREADBOARD_PACKAGED_SERVICE_EVIDENCE"));
        assert!(!dashboard.contains_key("BREADBOARD_PACKAGED_SERVICE_EVIDENCE_ENDPOINTS"));

        let (_temporary, paths, config, _) = fixture();
        let invalid_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![(
                "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
                OsString::from("not-256-bit-hex"),
            )],
        )
        .unwrap();
        assert!(matches!(
            TrustedServiceEnvironmentSet::load(
                RuntimeMode::Packaged,
                &paths,
                &config,
                &endpoints(),
                control(),
                &invalid_environment,
            ),
            Err(TrustedServiceEnvironmentError::InvalidEnvironmentValue {
                name: "BREADBOARD_MEMORY_DIAGNOSTIC_TOKEN",
                ..
            })
        ));
    }

    #[test]
    fn watermark_worker_receives_only_fixed_runtime_and_staged_script_paths() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let watermark =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Watermark));
        assert_exact_names(
            &watermark,
            &[
                "SystemRoot",
                "BREADBOARD_WATERMARKS_PYTHON",
                "BREADBOARD_WATERMARKS_SCRIPTS_ROOT",
            ],
        );
        assert_eq!(
            watermark["BREADBOARD_WATERMARKS_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            watermark["BREADBOARD_WATERMARKS_SCRIPTS_ROOT"],
            paths
                .app_root()
                .join("watermarks-remover/skills/remove-ai-marks/scripts")
                .to_string_lossy()
        );
    }

    #[test]
    fn hardware_blueprint_worker_gets_only_fixed_optional_cad_authority() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let hardware = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterHardwareBlueprint),
        );
        assert_eq!(hardware["BREADBOARD_RUNTIME_V2_ACTIVE"], "true");
        assert_eq!(
            hardware["BREADBOARD_SUPERVISOR_CONTROL_TOKEN"],
            CONTROL_TOKEN
        );
        assert_eq!(hardware["CAD_SERVICE_URL"], "http://127.0.0.1:7759");
        assert_eq!(
            hardware["BREADBOARD_SOLIDWORKS_SERVICE_URL"],
            "http://127.0.0.1:7768"
        );
        assert_eq!(hardware["BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED"], "1");
        assert_eq!(hardware["BREADBOARD_SOLIDWORKS_IMMUTABLE_RUNTIME"], "1");
        assert!(hardware["BREADBOARD_SOLIDWORKS_MCP_PATH"].ends_with(r"app\SolidworksMCP-python"));
        assert!(hardware["BREADBOARD_SOLIDWORKS_PYTHON"]
            .ends_with(r"runtime\runtimes\solidworks-python\python.exe"));
        assert!(!hardware.contains_key("BREADBOARD_UV_PATH"));
        assert!(hardware["BREADBOARD_SOLIDWORKS_HOME"].ends_with(r"data\solidworks"));
        assert!(
            hardware["BREADBOARD_SOLIDWORKS_WORKSPACE"].ends_with(r"data\solidworks\workspaces")
        );
        assert_eq!(hardware["CHATMOCK_API_KEY"], "local");
        assert!(!hardware.contains_key("NEXTAUTH_SECRET"));
        assert!(!hardware.contains_key("OPENAI_API_KEY"));
    }

    #[test]
    fn get_doc_meeting_inbox_and_socials_workers_receive_only_their_closed_contracts() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![],
            vec![
                (
                    "GET_DOC_CONTACT_EMAIL",
                    OsString::from("research@example.com"),
                ),
                ("OPENALEX_MAILTO", OsString::from("openalex@example.com")),
                ("UNPAYWALL_EMAIL", OsString::from("unpaywall@example.com")),
                ("CORE_API_KEY", OsString::from("core-key")),
            ],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );

        let get_doc =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::GetDoc));
        assert_eq!(get_doc["CHATMOCK_API_KEY"], "local");
        assert_eq!(get_doc["GET_DOC_CONTACT_EMAIL"], "research@example.com");
        assert_eq!(get_doc["CORE_API_KEY"], "core-key");
        assert!(!get_doc.contains_key("NEXTAUTH_SECRET"));

        let download = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::GetDocDownload),
        );
        assert!(!download.contains_key("CHATMOCK_API_KEY"));
        assert!(!download.contains_key("CORE_API_KEY"));

        let meeting = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::MeetingNotes),
        );
        assert_eq!(meeting["CHATMOCK_API_KEY"], "local");
        assert_eq!(
            meeting["BREADBOARD_RUNTIME_V2_MEDIA_BIN"],
            paths.runtime_root().join("bin").to_string_lossy()
        );
        assert!(!meeting.contains_key("HF_TOKEN"));
        assert!(!meeting.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));

        let inbox = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterInboxZero),
        );
        assert_eq!(inbox["CHATMOCK_API_KEY"], "local");
        assert_eq!(
            inbox["BREADBOARD_INBOX_ZERO_SERVICE_URL"],
            "http://127.0.0.1:7754"
        );
        assert!(!inbox.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!inbox.contains_key("INBOX_ZERO_GOOGLE_CLIENT_SECRET"));

        let socials = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterSocialsManager),
        );
        assert_eq!(socials["CHATMOCK_API_KEY"], "local");
        assert_eq!(
            socials["BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL"],
            "http://127.0.0.1:7753"
        );
        assert_eq!(socials["SOCIALS_MANAGER_MODE"], "stack");
        assert_eq!(socials["POSTIZ_MODE"], "stack");
        assert!(!socials.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!socials.contains_key("X_API_SECRET"));
        assert!(!socials.contains_key("DOCKER_CLI_PATH"));

        let agent_tars =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::AgentTars));
        assert_eq!(
            agent_tars["BREADBOARD_UI_TARS_SERVICE_URL"],
            "http://127.0.0.1:7758"
        );
        assert!(!agent_tars["BREADBOARD_UI_TARS_SERVICE_TOKEN"].is_empty());
        assert_eq!(agent_tars.len(), 3);
        assert!(!agent_tars.contains_key("UI_TARS_ADAPTER_SECRET"));
        assert!(!agent_tars.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn max_research_worker_receives_nested_runtime_authority_without_dashboard_secrets() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![
                (
                    "GET_DOC_CONTACT_EMAIL",
                    OsString::from("research@example.com"),
                ),
                ("BREADBOARD_AGENT_MEMORY", OsString::from("on")),
                (
                    "BREADBOARD_AGENT_MEMORY_AGENTS",
                    OsString::from("max_research"),
                ),
                ("BREADBOARD_MEM0", OsString::from("on")),
                ("BREADBOARD_MEM0_EXTRACTION", OsString::from("off")),
                ("BREADBOARD_EMBEDDINGS", OsString::from("on")),
                (
                    "BREADBOARD_EMBEDDING_MODEL",
                    OsString::from("local/bge-small-en-v1.5"),
                ),
            ],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let max_research = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterMaxResearch),
        );
        assert_eq!(max_research["BREADBOARD_RUNTIME_V2_ACTIVE"], "true");
        assert_eq!(
            max_research["BREADBOARD_SUPERVISOR_CONTROL_TOKEN"],
            CONTROL_TOKEN
        );
        assert_eq!(max_research["DEEP_RESEARCH_MODE"], "optional");
        assert_eq!(max_research["DEEP_RESEARCH_URL"], "http://127.0.0.1:7764");
        assert_eq!(
            max_research["BREADBOARD_OPENSCIENCE_SERVICE_URL"],
            "http://127.0.0.1:7745"
        );
        assert_eq!(
            max_research["BREADBOARD_MEM0_SERVICE_URL"],
            "http://127.0.0.1:7751"
        );
        assert_eq!(max_research["CHATMOCK_API_KEY"], "local");
        assert_eq!(max_research["BREADBOARD_AGENT_MEMORY"], "on");
        assert_eq!(max_research["BREADBOARD_MEM0"], "on");
        assert_eq!(max_research["BREADBOARD_EMBEDDINGS"], "on");
        assert!(!max_research.contains_key("OPENSCIENCE_ROOT"));
        assert!(!max_research.contains_key("OPENSCIENCE_CLI_ROOT"));
        assert!(!max_research.contains_key("OPENSCIENCE_STATE_ROOT"));
        assert!(!max_research.contains_key("OPENSCIENCE_WORKSPACE_ROOT"));
        assert!(!max_research.contains_key("NEXTAUTH_SECRET"));
        assert!(!max_research.contains_key("HERMES_DASHBOARD_SESSION_TOKEN"));
        assert!(!max_research.contains_key("AGENT_REACH_ROOT"));
        assert!(!max_research.contains_key("OPENSCIENCE_BIN"));
    }

    #[test]
    fn managed_outer_service_workers_receive_only_their_endpoint_authority() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![
                ("HTTPS_PROXY", OsString::from("http://proxy.example:8443")),
                ("LANG", OsString::from("C.UTF-8")),
                ("OPENAI_API_KEY", OsString::from("must-not-cross")),
            ],
        )
        .unwrap();
        let endpoints = endpoints();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints,
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );

        let wardrobe = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterWardrobe),
        );
        assert_eq!(
            wardrobe["BREADBOARD_WARDROBE_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::Wardrobe)
        );
        assert!(!wardrobe["BREADBOARD_WARDROBE_SERVICE_TOKEN"].is_empty());
        assert!(!wardrobe.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!wardrobe.contains_key("CHATMOCK_API_KEY"));
        assert!(!wardrobe.contains_key("OPENAI_API_KEY"));

        let parametric_cad = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterParametricCad),
        );
        assert_eq!(parametric_cad["BREADBOARD_RUNTIME_V2_ACTIVE"], "true");
        assert_eq!(
            parametric_cad["BREADBOARD_SUPERVISOR_CONTROL_TOKEN"],
            CONTROL_TOKEN
        );
        assert_eq!(
            parametric_cad["CAD_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::Cad)
        );
        assert!(!parametric_cad["CAD_SERVICE_SECRET"].is_empty());
        assert_eq!(parametric_cad["CHATMOCK_API_KEY"], "local");
        assert_eq!(parametric_cad["HTTPS_PROXY"], "http://proxy.example:8443");
        assert_eq!(parametric_cad["LANG"], "C.UTF-8");
        assert!(!parametric_cad.contains_key("BREADBOARD_SOLIDWORKS_SERVICE_URL"));
        assert!(!parametric_cad.contains_key("OPENAI_API_KEY"));
        assert!(!parametric_cad.contains_key("NEXTAUTH_SECRET"));

        let stock_analyst = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterStockAnalyst),
        );
        assert_eq!(
            stock_analyst["STOCK_ANALYST_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::StockAnalyst)
        );
        assert!(!stock_analyst.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!stock_analyst.contains_key("CHATMOCK_API_KEY"));
        assert!(!stock_analyst.contains_key("OPENAI_API_KEY"));
        assert!(!stock_analyst.contains_key("STOCK_ANALYST_CREDENTIALS_FILE"));

        let vibe_trading = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterVibeTrading),
        );
        assert_eq!(
            vibe_trading["VIBE_TRADING_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::VibeTrading)
        );
        assert!(!vibe_trading["VIBE_TRADING_SERVICE_API_KEY"].is_empty());
        assert!(!vibe_trading.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!vibe_trading.contains_key("CHATMOCK_API_KEY"));
        assert!(!vibe_trading.contains_key("OPENAI_API_KEY"));
        assert!(!vibe_trading.contains_key("VIBE_TRADING_CREDENTIALS_FILE"));

        let deer_flow = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterDeerFlow),
        );
        assert_eq!(
            deer_flow["DEER_FLOW_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::DeerFlow)
        );
        assert!(!deer_flow.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!deer_flow.contains_key("CHATMOCK_API_KEY"));
        assert!(!deer_flow.contains_key("OPENAI_API_KEY"));
        assert!(!deer_flow.contains_key("DEER_FLOW_CONFIG_PATH"));

        let money_printer = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterMoneyPrinter),
        );
        assert_eq!(
            money_printer["BREADBOARD_MONEY_PRINTER_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::MoneyPrinter)
        );
        assert!(!money_printer["BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN"].is_empty());
        assert_eq!(money_printer["CHATMOCK_API_KEY"], "local");
        assert!(!money_printer.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!money_printer.contains_key("OPENAI_API_KEY"));
        assert!(!money_printer.contains_key("MONEY_PRINTER_ROOT"));

        let deep_research = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterDeepResearch),
        );
        assert_exact_names(
            &deep_research,
            &["SystemRoot", "DEEP_RESEARCH_URL", "DEEP_RESEARCH_SECRET"],
        );
        assert_eq!(
            deep_research["DEEP_RESEARCH_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::DeepResearch)
        );
        assert!(!deep_research["DEEP_RESEARCH_SECRET"].is_empty());
        assert!(!deep_research.contains_key("DEEP_RESEARCH_MODE"));
        assert!(!deep_research.contains_key("DEEP_RESEARCH_REQUEST_TIMEOUT_MS"));
        assert!(!deep_research.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!deep_research.contains_key("OPENAI_API_KEY"));
        assert!(!deep_research.contains_key("BRAVE_API_KEY"));

        let openscience = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterOpenscience),
        );
        assert_exact_names(
            &openscience,
            &[
                "SystemRoot",
                "BREADBOARD_OPENSCIENCE_SERVICE_URL",
                "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
            ],
        );
        assert_eq!(
            openscience["BREADBOARD_OPENSCIENCE_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::Openscience)
        );
        assert!(!openscience["BREADBOARD_OPENSCIENCE_SERVICE_TOKEN"].is_empty());
        assert!(!openscience.contains_key("CHATMOCK_API_KEY"));
        assert!(!openscience.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!openscience.contains_key("OPENAI_API_KEY"));
        assert!(!openscience.contains_key("OPENSCIENCE_ROOT"));

        let openwork = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterOpenwork),
        );
        assert_exact_names(
            &openwork,
            &[
                "SystemRoot",
                "BREADBOARD_OPENWORK_SERVICE_URL",
                "BREADBOARD_OPENWORK_SERVICE_TOKEN",
            ],
        );
        assert_eq!(
            openwork["BREADBOARD_OPENWORK_SERVICE_URL"],
            endpoints.base_url(TrustedServiceEnvironmentSource::Openwork)
        );
        assert!(!openwork["BREADBOARD_OPENWORK_SERVICE_TOKEN"].is_empty());
        assert!(!openwork.contains_key("CHATMOCK_API_KEY"));
        assert!(!openwork.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!openwork.contains_key("OPENWORK_ROOT"));
        assert!(!openwork.contains_key("OPENWORK_BUN_PATH"));
    }

    #[test]
    fn scriberr_garden_worker_uses_mode_correct_roots_and_managed_dependency_authority() {
        let (_temporary, paths, config, _) = fixture();
        fs::write(
            config.absolute().join(DESKTOP_CONFIG_FILE),
            serde_json::to_vec(&json!({
                "version": 2,
                "nextAuthSecret": NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": HERMES_SESSION_TOKEN,
                "hermesToolSecret": HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789",
                "scriberrEnabled": true,
                "scriberrUsername": "breadboard",
                "scriberrPassword": "scriberr-password-0123456789-abcdef"
            }))
            .unwrap(),
        )
        .unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Breadboard"))],
            vec![
                (
                    "SCRIBERR_API_TOKEN",
                    OsString::from("external-token-must-stay-sealed"),
                ),
                ("SCRIBERR_REQUEST_TIMEOUT_MS", OsString::from("600000")),
                ("VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB", OsString::from("2048")),
                ("QUARTZ_AUTO_PUBLISH", OsString::from("true")),
                ("QUARTZ_PUBLISH_MODE", OsString::from("await")),
                ("QUARTZ_BUILD_CONCURRENCY", OsString::from("4")),
                ("QUARTZ_BUILD_TIMEOUT_MS", OsString::from("3600000")),
            ],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let scriberr = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::ScriberrGarden),
        );
        assert_eq!(
            scriberr["BREADBOARD_SCRIBERR_SOURCE_ROOT"],
            paths
                .app_root()
                .join("dashboard-standalone/dashboard/worker-src")
                .to_string_lossy()
        );
        assert_eq!(
            scriberr["BREADBOARD_REPO_ROOT"],
            paths.app_root().join("quartz-template").to_string_lossy()
        );
        assert_eq!(
            scriberr["YTDLP_PATH"],
            paths
                .runtime_root()
                .join("bin/yt-dlp.exe")
                .to_string_lossy()
        );
        assert_eq!(scriberr["NODE_ENV"], "production");
        assert_eq!(scriberr["QUARTZ_AUTO_PUBLISH"], "true");
        assert_eq!(scriberr["QUARTZ_PUBLISH_MODE"], "await");
        assert_eq!(scriberr["QUARTZ_BUILD_CONCURRENCY"], "4");
        assert_eq!(scriberr["QUARTZ_BUILD_TIMEOUT_MS"], "3600000");
        assert_eq!(scriberr["SCRIBERR_REQUEST_TIMEOUT_MS"], "600000");
        assert_eq!(scriberr["VIDEO_TRANSCRIPTION_MAX_UPLOAD_MB"], "2048");
        assert_eq!(scriberr["CHATMOCK_API_KEY"], "local");
        assert!(!scriberr.contains_key("SCRIBERR_API_TOKEN"));
        assert!(workers.should_acquire_service_dependency("scriberr"));
        assert!(!scriberr.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!scriberr.contains_key("NEXTAUTH_SECRET"));
        let video_use = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterVideoUse),
        );
        assert_eq!(video_use["BREADBOARD_RUNTIME_V2_ACTIVE"], "true");
        assert_eq!(video_use["CHATMOCK_API_KEY"], "local");
        assert_eq!(
            video_use["VIDEO_USE_SOURCE_COMMIT"],
            "8e94eb04d22c5de30bd0febd2cd06fb4103949dd"
        );
        assert_eq!(
            video_use["VIDEO_USE_ROOT"],
            paths.app_root().join("video-use").to_string_lossy()
        );
        assert_eq!(
            video_use["SUBSAI_ROOT"],
            paths.app_root().join("subsai").to_string_lossy()
        );
        assert_eq!(
            video_use["BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            video_use["BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH"],
            paths
                .runtime_root()
                .join("bin/ffmpeg.exe")
                .to_string_lossy()
        );
        assert_eq!(
            video_use["BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH"],
            paths
                .runtime_root()
                .join("bin/ffprobe.exe")
                .to_string_lossy()
        );
        assert_eq!(video_use["SCRIBERR_REQUEST_TIMEOUT_MS"], "600000");
        assert_eq!(
            video_use["BREADBOARD_SUPERVISOR_CONTROL_TOKEN"],
            CONTROL_TOKEN
        );
        assert!(!video_use.contains_key("SCRIBERR_API_TOKEN"));
        assert!(!video_use.contains_key("VIDEO_USE_PYTHON"));
        assert!(!video_use.contains_key("OPENAI_API_KEY"));
        assert!(!video_use.contains_key("NEXTAUTH_SECRET"));
        let speech_media =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::SpeechMedia));
        assert_eq!(
            speech_media["BREADBOARD_RUNTIME_V2_MEDIA_FFMPEG_PATH"],
            paths
                .runtime_root()
                .join("bin")
                .join(if cfg!(windows) {
                    "ffmpeg.exe"
                } else {
                    "ffmpeg"
                })
                .to_string_lossy()
        );
        assert_eq!(
            speech_media["BREADBOARD_RUNTIME_V2_MEDIA_FFPROBE_PATH"],
            paths
                .runtime_root()
                .join("bin")
                .join(if cfg!(windows) {
                    "ffprobe.exe"
                } else {
                    "ffprobe"
                })
                .to_string_lossy()
        );
        assert_eq!(
            speech_media["BREADBOARD_RUNTIME_V2_MEDIA_YTDLP_PATH"],
            paths
                .runtime_root()
                .join("bin")
                .join(if cfg!(windows) {
                    "yt-dlp.exe"
                } else {
                    "yt-dlp"
                })
                .to_string_lossy()
        );
        assert_eq!(
            speech_media["BREADBOARD_RUNTIME_V2_MEDIA_PYTHON_PATH"],
            paths
                .runtime_root()
                .join("runtimes")
                .join("python")
                .join(if cfg!(windows) {
                    "python.exe"
                } else {
                    "bin/python"
                })
                .to_string_lossy()
        );
        assert_eq!(
            speech_media["BREADBOARD_RUNTIME_V2_MEDIA_VIDEO_USE_ROOT"],
            paths.app_root().join("video-use").to_string_lossy()
        );
        assert_eq!(speech_media.len(), 6);
        assert!(!speech_media.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!speech_media.contains_key("CHATMOCK_API_KEY"));
        assert!(!speech_media.contains_key("OPENAI_API_KEY"));
        assert!(!speech_media.contains_key("NEXTAUTH_SECRET"));
    }

    #[test]
    fn external_scriberr_keeps_its_explicit_token_and_bypasses_the_local_service_lease() {
        let (_temporary, paths, config, _) = fixture();
        fs::write(
            config.absolute().join(DESKTOP_CONFIG_FILE),
            serde_json::to_vec(&json!({
                "version": 2,
                "nextAuthSecret": NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": HERMES_SESSION_TOKEN,
                "hermesToolSecret": HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789",
                "scriberrEnabled": true,
                "scriberrBaseUrl": "https://scriberr.example.invalid",
                "scriberrUsername": "external-user"
            }))
            .unwrap(),
        )
        .unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            Vec::new(),
            vec![(
                "SCRIBERR_API_TOKEN",
                OsString::from("external-scriberr-token-0123456789"),
            )],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let scriberr = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::ScriberrGarden),
        );
        assert_eq!(
            scriberr["SCRIBERR_BASE_URL"],
            "https://scriberr.example.invalid"
        );
        assert_eq!(
            scriberr["SCRIBERR_API_TOKEN"],
            "external-scriberr-token-0123456789"
        );
        assert!(!workers.should_acquire_service_dependency("scriberr"));
        let video_use = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterVideoUse),
        );
        assert_eq!(
            video_use["SCRIBERR_API_TOKEN"],
            "external-scriberr-token-0123456789"
        );
    }

    #[test]
    fn load_builds_only_the_audited_hot_profiles() {
        let (_temporary, paths, config, os_environment) = fixture();
        let set = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Hot,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();

        let chatmock = set
            .prepare_for_launch_profile(
                "chatmock",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Chatmock),
            )
            .unwrap();
        let chatmock = values(&chatmock);
        assert_exact_names(
            &chatmock,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "PYTHONUNBUFFERED",
                "PYTHONDONTWRITEBYTECODE",
                "CODEX_HOME",
                "COUNCIL_LEDGER_DIR",
                "COUNCIL_REQUEST_RECEIPT_DIR",
                "CHATMOCK_ALLOW_ENV_PROVIDER_KEYS",
                "CLIPROXY_BASE_URL",
                "CLIPROXY_API_KEY",
            ],
        );
        assert_eq!(chatmock["CHATMOCK_ALLOW_ENV_PROVIDER_KEYS"], "false");
        assert_eq!(chatmock["PYTHONUNBUFFERED"], "1");
        assert!(chatmock["CODEX_HOME"].ends_with(r"app\.runtime\codex-desktop"));
        assert!(!chatmock.contains_key("OPENAI_API_KEY"));
        assert_eq!(chatmock["CLIPROXY_BASE_URL"], "http://127.0.0.1:7756/v1");
        assert_eq!(chatmock["CLIPROXY_API_KEY"].len(), 64);

        let comfyui = set
            .prepare_for_launch_profile(
                "comfyui",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Comfyui),
            )
            .unwrap();
        let comfyui = values(&comfyui);
        assert_exact_names(
            &comfyui,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "PYTHONUNBUFFERED",
                "PYTHONDONTWRITEBYTECODE",
                "COMFYUI_ROOT",
                "COMFYUI_ENV_DIR",
                "COMFYUI_RUNTIME_DIR",
                "COMFYUI_URL",
                "COMFYUI_PORT",
            ],
        );
        assert_eq!(comfyui["PYTHONUNBUFFERED"], "1");
        assert_eq!(comfyui["COMFYUI_URL"], "http://127.0.0.1:7741");
        assert_eq!(comfyui["COMFYUI_PORT"], "7741");
        assert!(comfyui["COMFYUI_ROOT"].ends_with(r"data\runtime-v2\toolchains\comfyui"));
        assert!(comfyui["COMFYUI_ENV_DIR"].ends_with(r"data\runtime-v2\services\comfyui\.venv"));
        assert!(comfyui["COMFYUI_RUNTIME_DIR"].ends_with(r"data\runtime-v2\services\comfyui"));

        let hermes = set
            .prepare_for_launch_profile(
                "hermes",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Hermes),
            )
            .unwrap();
        let hermes = values(&hermes);
        assert_exact_names(
            &hermes,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "PYTHONUNBUFFERED",
                "PYTHONDONTWRITEBYTECODE",
                "HERMES_HOME",
                "HERMES_DESKTOP",
                "HERMES_SERVE_HEADLESS",
                "HERMES_DASHBOARD_SESSION_TOKEN",
                "BREADBOARD_INTERNAL_URL",
                "BREADBOARD_HERMES_TOOL_SECRET",
            ],
        );
        assert_eq!(
            hermes["HERMES_DASHBOARD_SESSION_TOKEN"],
            HERMES_SESSION_TOKEN
        );
        assert_eq!(hermes["BREADBOARD_INTERNAL_URL"], "http://127.0.0.1:7738");
        assert!(!hermes.contains_key("OPENAI_BASE_URL"));
        assert!(!hermes.contains_key("CHATMOCK_BASE_URL"));

        let gbrain = set
            .prepare_for_launch_profile(
                "gbrain",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Gbrain),
            )
            .unwrap();
        let gbrain = values(&gbrain);
        assert_exact_names(
            &gbrain,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "GBRAIN_ADAPTER_HOST",
                "GBRAIN_ADAPTER_PORT",
                "GBRAIN_ADAPTER_SECRET",
                "GBRAIN_DATA_DIR",
                "GBRAIN_BACKEND",
                "GBRAIN_EMBEDDING_PROVIDER",
                "GBRAIN_EMBEDDING_BASE_URL",
                "GBRAIN_EMBEDDING_API_KEY",
                "GBRAIN_EMBEDDING_MODEL",
                "GBRAIN_EMBEDDING_DIMENSIONS",
                "GBRAIN_QUERY_TIMEOUT_MS",
            ],
        );
        assert_eq!(gbrain["GBRAIN_ADAPTER_HOST"], "127.0.0.1");
        assert_eq!(gbrain["GBRAIN_ADAPTER_PORT"], "7739");
        assert_eq!(gbrain["GBRAIN_ADAPTER_SECRET"], GBRAIN_ADAPTER_SECRET);
        assert_eq!(
            gbrain["GBRAIN_EMBEDDING_BASE_URL"],
            "http://127.0.0.1:7737/v1"
        );
        assert!(gbrain["GBRAIN_DATA_DIR"].ends_with(r"data\gbrain"));
        assert!(!gbrain.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));

        let dashboard = set
            .prepare_for_launch_profile(
                "dashboard",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Dashboard),
            )
            .unwrap();
        let dashboard = values(&dashboard);
        assert_exact_names(
            &dashboard,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "NODE_ENV",
                "NODE_OPTIONS",
                "BREADBOARD_DASHBOARD_BUNDLER",
                "PORT",
                "HOSTNAME",
                "BREADBOARD_DATA_DIR",
                "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
                "BREADBOARD_REPO_ROOT",
                "QUARTZ_CONTENT_PATH",
                "NEXT_PUBLIC_QUARTZ_URL",
                "COUNCIL_LEDGER_DIR",
                "HERMES_HOME",
                "NEXTAUTH_SECRET",
                "NEXTAUTH_URL",
                "SECOND_BRAIN_INITIAL_INVITE_CODE",
                "OPENAI_BASE_URL",
                "OPENAI_API_KEY",
                "CHATMOCK_BASE_URL",
                "CHATMOCK_MODEL",
                "CODEX_HOME",
                "HERMES_BASE_URL",
                "HERMES_DASHBOARD_SESSION_TOKEN",
                "BREADBOARD_HERMES_TOOL_SECRET",
                "HERMES_CAPABILITY_SECRET",
                "HERMES_ENABLED",
                "HERMES_MODE",
                "HERMES_ROOT",
                "HERMES_SKILLS_QUARANTINE",
                "HERMES_SKILLS_APPROVED",
                "HERMES_SKILLS_CONDITIONAL",
                "HERMES_FIRST_PARTY_SKILLS_ROOT",
                "BREADBOARD_INTERNAL_URL",
                "BREADBOARD_SUPERVISOR_CONTROL_URL",
                "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
                "BREADBOARD_RUNTIME_V2_ACTIVE",
                "SOCIALS_MANAGER_MODE",
                "VIDEO_TRANSCRIPTION_ENABLED",
                "GBRAIN_MODE",
                "GBRAIN_ADAPTER_URL",
                "GBRAIN_ADAPTER_SECRET",
                "GBRAIN_QUERY_TIMEOUT_MS",
                "COMFYUI_ENABLED",
                "COMFYUI_MANAGED",
                "COMFYUI_URL",
                "COMFYUI_PORT",
                "COMFYUI_ROOT",
                "COMFYUI_ENV_DIR",
                "COMFYUI_RUNTIME_DIR",
                "COMFYUI_START_TIMEOUT_MS",
                "COMFYUI_GENERATE_TIMEOUT_MS",
                "UI_TARS_MODE",
                "COLPALI_MODE",
                "HUMANIZER_MODE",
                "CLIPROXY_MODE",
                "CAD_MODE",
                "BREADBOARD_CAD_PORT",
                "BREADBOARD_COLPALI_HOME",
                "BREADBOARD_COLPALI_PORT",
                "BREADBOARD_HUMANIZER_DEVICE",
                "BREADBOARD_HUMANIZER_HOME",
                "BREADBOARD_HUMANIZER_PORT",
                "CAD_SERVICE_SECRET",
                "CAD_SERVICE_URL",
                "CLIPROXY_API_KEY",
                "CLIPROXY_BASE_URL",
                "CLIPROXY_HOME",
                "CLIPROXY_MANAGEMENT_KEY",
                "CLIPROXY_PORT",
                "COLPALI_SERVICE_SECRET",
                "COLPALI_SERVICE_URL",
                "DEEP_RESEARCH_MODE",
                "DEEP_RESEARCH_SECRET",
                "DEEP_RESEARCH_URL",
                "DEER_FLOW_SERVICE_URL",
                "DEER_FLOW_STATE_DIR",
                "HUMANIZER_SERVICE_SECRET",
                "HUMANIZER_SERVICE_URL",
                "STOCK_ANALYST_SERVICE_URL",
                "UI_TARS_ADAPTER_SECRET",
                "UI_TARS_ADAPTER_URL",
                "VIBE_TRADING_SERVICE_API_KEY",
                "VIBE_TRADING_SERVICE_URL",
                "VOICEBOX_BASE_URL",
                "VOICEBOX_STATUS_PATH",
                "BREADBOARD_IFIXAI_MODE",
                "BREADBOARD_GRAFT_CLI",
                "OPENCODE_BIN",
                "OPENCODE_ROOT",
                "BREADBOARD_OPENCODE_CONFIG",
                "TRADINGAGENTS_ROOT",
                "TRADINGAGENTS_CREDENTIALS_FILE",
                "CAREER_OPS_ROOT",
                "PLAYWRIGHT_BROWSERS_PATH",
                "BREADBOARD_TELEGRAM_GATEWAY_URL",
                "BREADBOARD_TELEGRAM_GATEWAY_TOKEN",
                "BREADBOARD_WHATSAPP_GATEWAY_URL",
                "BREADBOARD_WHATSAPP_GATEWAY_TOKEN",
                "BREADBOARD_OPENWORK_SERVICE_URL",
                "BREADBOARD_OPENWORK_SERVICE_TOKEN",
                "BREADBOARD_OPENSCIENCE_SERVICE_URL",
                "BREADBOARD_OPENSCIENCE_SERVICE_TOKEN",
                "BREADBOARD_MONEY_PRINTER_SERVICE_URL",
                "BREADBOARD_MONEY_PRINTER_SERVICE_TOKEN",
                "BREADBOARD_WARDROBE_SERVICE_URL",
                "BREADBOARD_WARDROBE_SERVICE_TOKEN",
                "BREADBOARD_MEM0_SERVICE_URL",
                "BREADBOARD_MEM0_SERVICE_TOKEN",
                "BREADBOARD_LOCAL_MCP_BROKER_URL",
                "BREADBOARD_LOCAL_MCP_BROKER_TOKEN",
                "BREADBOARD_LOCAL_MCP_REGISTRY_ROOT",
                "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_URL",
                "BREADBOARD_POSTIZ_COORDINATOR_SERVICE_TOKEN",
                "BREADBOARD_INBOX_ZERO_SERVICE_URL",
                "BREADBOARD_INBOX_ZERO_SERVICE_TOKEN",
                "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_URL",
                "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN",
                "BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED",
                "BREADBOARD_SOLIDWORKS_SERVICE_URL",
                "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN",
                "BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED",
                "BREADBOARD_SOLIDWORKS_MCP_PATH",
                "BREADBOARD_SOLIDWORKS_PYTHON",
                "BREADBOARD_UV_PATH",
                "BREADBOARD_SOLIDWORKS_HOME",
                "BREADBOARD_SOLIDWORKS_WORKSPACE",
                "SOCIALS_MANAGER_URL",
                "WARDROBE_ROOT",
                "WARDROBE_RUNTIME_ROOT",
                "WARDROBE_DATA_DIR",
                "WARDROBE_MODEL_REFERENCE",
                "PENECHO_URL",
                "PENECHO_PORT",
                "BREADBOARD_PENECHO_RUNTIME_MANAGED",
                "VLM_OCR_BASE_URL",
                "VLM_OCR_AUTO_START",
                "VLM_OCR_RUNTIME_MANAGED",
                "RECALL_RUNTIME_MANAGED",
                "RECALL_BASE_URL",
                "RECALL_HOME",
                "RECALL_DATA_DIR",
                "RECALL_API_KEY",
            ],
        );
        assert_eq!(dashboard["NODE_ENV"], "development");
        assert_eq!(
            dashboard["BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_URL"],
            "http://127.0.0.1:7755"
        );
        assert_eq!(
            dashboard["BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED"],
            "1"
        );
        assert_eq!(
            dashboard["BREADBOARD_LOCAL_MCP_REGISTRY_ROOT"],
            paths
                .data_root()
                .join("runtime-v2/local-mcp-definitions")
                .to_string_lossy()
        );

        let local_mcp = set
            .prepare_for_launch_profile(
                "local-mcp-broker",
                &launch_profile(
                    RuntimeMode::Hot,
                    TrustedServiceEnvironmentSource::LocalMcpBroker,
                ),
            )
            .unwrap();
        let local_mcp = values(&local_mcp);
        assert_exact_names(
            &local_mcp,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "NODE_ENV",
                "NODE_OPTIONS",
                "BREADBOARD_LOCAL_MCP_BROKER_TOKEN",
                "BREADBOARD_LOCAL_MCP_REGISTRY_ROOT",
            ],
        );
        assert_eq!(
            local_mcp["BREADBOARD_LOCAL_MCP_REGISTRY_ROOT"],
            paths
                .data_root()
                .join("runtime-v2/local-mcp-definitions")
                .to_string_lossy()
        );
        assert!(!local_mcp.contains_key("NEXTAUTH_SECRET"));

        let spotify = set
            .prepare_for_launch_profile(
                "spotify-playback",
                &launch_profile(
                    RuntimeMode::Hot,
                    TrustedServiceEnvironmentSource::SpotifyPlayback,
                ),
            )
            .unwrap();
        let spotify = values(&spotify);
        assert_exact_names(
            &spotify,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "NODE_ENV",
                "NODE_OPTIONS",
                "BREADBOARD_DATA_DIR",
                "BREADBOARD_SPOTIFY_PLAYBACK_SERVICE_TOKEN",
                "BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED",
                "BREADBOARD_SPOTIFY_DASHBOARD_ORIGIN",
            ],
        );
        assert_eq!(spotify["BREADBOARD_SPOTIFY_PLAYBACK_RUNTIME_MANAGED"], "1");
        assert_eq!(
            spotify["BREADBOARD_SPOTIFY_DASHBOARD_ORIGIN"],
            "http://127.0.0.1:7738"
        );
        assert!(!spotify.contains_key("NEXTAUTH_SECRET"));
        assert!(!spotify.contains_key("OPENAI_API_KEY"));

        let solidworks = set
            .prepare_for_launch_profile(
                "solidworks-mcp",
                &launch_profile(
                    RuntimeMode::Hot,
                    TrustedServiceEnvironmentSource::SolidworksMcp,
                ),
            )
            .unwrap();
        let solidworks = values(&solidworks);
        assert_exact_names(
            &solidworks,
            &[
                "SystemRoot",
                "USERPROFILE",
                "PATH",
                "TEMP",
                "TMP",
                "ComSpec",
                "PATHEXT",
                "NODE_ENV",
                "NODE_OPTIONS",
                "BREADBOARD_DATA_DIR",
                "BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED",
                "BREADBOARD_SOLIDWORKS_BRIDGE_OWNER",
                "BREADBOARD_SOLIDWORKS_SERVICE_TOKEN",
                "BREADBOARD_SOLIDWORKS_SERVICE_PORT",
                "BREADBOARD_SOLIDWORKS_HOME",
                "BREADBOARD_SOLIDWORKS_WORKSPACE",
                "BREADBOARD_SOLIDWORKS_MCP_PATH",
                "BREADBOARD_SOLIDWORKS_PYTHON",
                "BREADBOARD_SOLIDWORKS_BASE_PYTHON",
                "BREADBOARD_UV_PATH",
                "UV_PROJECT_ENVIRONMENT",
                "UV_CACHE_DIR",
            ],
        );
        assert_eq!(solidworks["BREADBOARD_SOLIDWORKS_RUNTIME_MANAGED"], "1");
        assert_eq!(
            solidworks["BREADBOARD_SOLIDWORKS_BRIDGE_OWNER"],
            "runtime-v2-service"
        );
        assert_eq!(solidworks["BREADBOARD_SOLIDWORKS_SERVICE_PORT"], "7768");
        assert!(solidworks["BREADBOARD_SOLIDWORKS_MCP_PATH"].ends_with(r"app\SolidworksMCP-python"));
        assert!(solidworks["BREADBOARD_SOLIDWORKS_PYTHON"]
            .ends_with(r"data\runtime-v2\services\solidworks-mcp\.venv\Scripts\python.exe"));
        assert!(!solidworks.contains_key("NEXTAUTH_SECRET"));
        assert!(!solidworks.contains_key("OPENAI_API_KEY"));
        assert!(!solidworks.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert_eq!(dashboard["NODE_OPTIONS"], HOT_DASHBOARD_NODE_OPTIONS);
        assert_eq!(dashboard["BREADBOARD_DASHBOARD_BUNDLER"], "turbopack");
        assert_eq!(dashboard["OPENAI_BASE_URL"], "http://127.0.0.1:7737/v1");
        assert_eq!(dashboard["HERMES_BASE_URL"], "http://127.0.0.1:7740");
        assert_eq!(dashboard["GBRAIN_MODE"], "preferred");
        assert_eq!(dashboard["GBRAIN_ADAPTER_URL"], "http://127.0.0.1:7739");
        assert_eq!(dashboard["GBRAIN_ADAPTER_SECRET"], GBRAIN_ADAPTER_SECRET);
        assert_eq!(dashboard["COMFYUI_ENABLED"], "true");
        assert_eq!(dashboard["COMFYUI_MANAGED"], "true");
        assert_eq!(dashboard["COMFYUI_URL"], "http://127.0.0.1:7741");
        assert_eq!(dashboard["COMFYUI_PORT"], "7741");
        assert!(dashboard["COMFYUI_ROOT"].ends_with(r"data\runtime-v2\toolchains\comfyui"));
        assert!(dashboard["COMFYUI_ENV_DIR"].ends_with(r"data\runtime-v2\services\comfyui\.venv"));
        assert!(dashboard["COMFYUI_RUNTIME_DIR"].ends_with(r"data\runtime-v2\services\comfyui"));
        assert_eq!(dashboard["SOCIALS_MANAGER_MODE"], "stack");
        assert_eq!(dashboard["SOCIALS_MANAGER_URL"], "http://127.0.0.1:7770");
        assert_eq!(dashboard["VIDEO_TRANSCRIPTION_ENABLED"], "false");
        assert_eq!(dashboard["UI_TARS_MODE"], "optional");
        assert_eq!(dashboard["COLPALI_MODE"], "auto");
        assert_eq!(dashboard["HUMANIZER_MODE"], "local");
        assert_eq!(dashboard["CLIPROXY_MODE"], "optional");
        assert_eq!(dashboard["CAD_MODE"], "optional");
        assert_eq!(dashboard["BREADBOARD_IFIXAI_MODE"], "");
        assert!(!dashboard
            .values()
            .any(|value| value == "must-not-enter-any-environment"));

        let debug = format!("{set:?} {os_environment:?}");
        for secret in [
            NEXT_AUTH_SECRET,
            GBRAIN_ADAPTER_SECRET,
            HERMES_SESSION_TOKEN,
            HERMES_TOOL_SECRET,
            HERMES_CAPABILITY_SECRET,
            CONTROL_TOKEN,
        ] {
            assert!(!debug.contains(secret));
        }
    }

    #[test]
    fn dashboard_node_options_are_trusted_and_hot_only() {
        assert!(!OPTIONAL_ELECTRON_GATED_PRODUCT_ENVIRONMENT_NAMES.contains(&"NODE_OPTIONS"));

        for (mode, expected_node_options, expected_bundler) in [
            (RuntimeMode::Hot, HOT_DASHBOARD_NODE_OPTIONS, "turbopack"),
            (RuntimeMode::Lean, "", "standalone"),
            (RuntimeMode::Packaged, "", "standalone"),
        ] {
            let (_temporary, paths, config, os_environment) = fixture();
            let set = TrustedServiceEnvironmentSet::load(
                mode,
                &paths,
                &config,
                &endpoints(),
                control(),
                &os_environment,
            )
            .unwrap();
            let dashboard = set
                .prepare_for_launch_profile(
                    "dashboard",
                    &launch_profile(mode, TrustedServiceEnvironmentSource::Dashboard),
                )
                .unwrap();
            let dashboard = values(&dashboard);

            assert_eq!(dashboard["NODE_OPTIONS"], expected_node_options);
            assert_eq!(dashboard["BREADBOARD_DASHBOARD_BUNDLER"], expected_bundler);
        }
    }

    #[test]
    fn dashboard_data_override_is_explicit_only_for_packaged_or_distinct_data_authority() {
        for (mode, shared_roots, expect_explicit_data) in [
            (RuntimeMode::Hot, false, true),
            (RuntimeMode::Lean, false, true),
            (RuntimeMode::Hot, true, false),
            (RuntimeMode::Lean, true, false),
            (RuntimeMode::Packaged, true, true),
        ] {
            let (temporary, isolated_paths, config, os_environment) = fixture();
            let runtime_root = isolated_paths.runtime_root().to_path_buf();
            let paths = if shared_roots {
                let shared = temporary.path().join("shared");
                fs::create_dir_all(&shared).unwrap();
                RuntimePaths::new(&shared, &shared, runtime_root).unwrap()
            } else {
                isolated_paths
            };
            assert_eq!(paths.has_distinct_data_root(), !shared_roots);
            let shared_temporary = paths.data_root().join("runtime-v2").join("temp");
            assert!(!shared_temporary.exists());

            let set = TrustedServiceEnvironmentSet::load(
                mode,
                &paths,
                &config,
                &endpoints(),
                control(),
                &os_environment,
            )
            .unwrap();
            assert!(shared_temporary.is_dir());
            let dashboard = set
                .prepare_for_launch_profile(
                    "dashboard",
                    &launch_profile(mode, TrustedServiceEnvironmentSource::Dashboard),
                )
                .unwrap();
            let dashboard = values(&dashboard);
            assert_eq!(dashboard["TEMP"], shared_temporary.to_string_lossy());
            assert_eq!(dashboard["TMP"], shared_temporary.to_string_lossy());
            let expected_data = if expect_explicit_data {
                paths.data_root().to_string_lossy().into_owned()
            } else {
                String::new()
            };
            assert_eq!(dashboard["BREADBOARD_DATA_DIR"], expected_data);
            let expected_quartz_content = if mode == RuntimeMode::Packaged || !shared_roots {
                paths.data_root().join("quartz").join("content")
            } else {
                paths.app_root().join("quartz").join("content")
            };
            assert_eq!(
                dashboard["QUARTZ_CONTENT_PATH"],
                expected_quartz_content.to_string_lossy()
            );
            let expected_development_dashboard = if mode == RuntimeMode::Packaged {
                String::new()
            } else {
                paths
                    .app_root()
                    .join("dashboard")
                    .to_string_lossy()
                    .into_owned()
            };
            assert_eq!(
                dashboard["BREADBOARD_DEVELOPMENT_DASHBOARD_DIR"],
                expected_development_dashboard
            );
        }
    }

    #[test]
    fn rust_owns_the_exact_hermes_home_and_generated_config() {
        let (_temporary, paths, config, os_environment) = fixture();
        let set = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Hot,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let hermes = values(
            &set.prepare_for_launch_profile(
                "hermes",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Hermes),
            )
            .unwrap(),
        );
        let expected_home = paths.data_root().join(".runtime").join("hermes");
        assert_eq!(hermes["HERMES_HOME"], expected_home.to_string_lossy());
        let yaml = fs::read_to_string(expected_home.join("config.yaml")).unwrap();
        assert_eq!(
            yaml,
            concat!(
                "# Generated by Breadboard. Hermes state is disposable and non-canonical.\n",
                "model:\n",
                "  default: \"default\"\n",
                "  provider: custom\n",
                "  base_url: \"http://127.0.0.1:7737/v1\"\n",
                "  supports_vision: true\n",
                "toolsets:\n",
                "  - breadboard\n",
                "  - web\n",
                "web:\n",
                "  search_backend: ddgs\n",
                "  extract_backend: fetch\n",
                "moa:\n",
                "  enabled: false\n",
                "  presets:\n",
                "    default:\n",
                "      enabled: false\n",
                "memory:\n",
                "  memory_enabled: false\n",
                "  user_profile_enabled: false\n",
                "display:\n",
                "  show_reasoning: true\n",
                "  busy_input_mode: steer\n",
                "  busy_steer_ack_enabled: false\n",
                "  memory_notifications: off\n",
                "tools:\n",
                "  tool_search:\n",
                "    enabled: on\n",
                "tool_loop_guardrails:\n",
                "  warnings_enabled: true\n",
                "  hard_stop_enabled: true\n",
                "agent:\n",
                "  coding_context: off\n",
                "  image_input_mode: native\n"
            )
        );
        for secret in [
            NEXT_AUTH_SECRET,
            GBRAIN_ADAPTER_SECRET,
            HERMES_SESSION_TOKEN,
            HERMES_TOOL_SECRET,
            HERMES_CAPABILITY_SECRET,
            CONTROL_TOKEN,
        ] {
            assert!(!yaml.contains(secret));
        }
    }

    #[test]
    fn agent_edits_worker_receives_only_the_fixed_git_tool_profile() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let agent_edits =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::AgentEdits));
        assert_eq!(agent_edits["BREADBOARD_RUNTIME_V2_FIXED_TOOLS"], "1");
        assert_eq!(
            agent_edits["BREADBOARD_GIT_BIN"],
            r"C:\Windows\System32\git.exe"
        );
        assert!(agent_edits.contains_key("SystemRoot"));
        assert!(!agent_edits.contains_key("NEXTAUTH_SECRET"));
        assert!(!agent_edits.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn system_location_worker_receives_only_the_fixed_windows_location_tool() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let location = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::SystemLocation),
        );
        assert_eq!(location["BREADBOARD_RUNTIME_V2_FIXED_TOOLS"], "1");
        assert_eq!(
            location["BREADBOARD_WINDOWS_POWERSHELL_BIN"],
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
        );
        assert!(location.contains_key("SystemRoot"));
        assert!(!location.contains_key("PATH"));
        assert!(!location.contains_key("NEXTAUTH_SECRET"));
        assert!(!location.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn opencode_worker_receives_the_pinned_runtime_and_no_control_authority() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let opencode = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterOpencode),
        );
        assert_eq!(
            opencode["OPENCODE_BIN"],
            paths
                .app_root()
                .join("opencode/bin/opencode.exe")
                .to_string_lossy()
        );
        assert_eq!(
            opencode["OPENCODE_ROOT"],
            paths.app_root().join("opencode").to_string_lossy()
        );
        assert_eq!(
            opencode["BREADBOARD_OPENCODE_CONFIG"],
            paths
                .app_root()
                .join("opencode-config/opencode.json")
                .to_string_lossy()
        );
        assert_eq!(opencode["CHATMOCK_API_KEY"], "local");
        assert_eq!(opencode["BREADBOARD_RUNTIME_V2_FIXED_TOOLS"], "1");
        assert_eq!(
            opencode["BREADBOARD_GRAFT_HOME"],
            paths.data_root().join("runtime-v2/graft").to_string_lossy()
        );
        assert!(!opencode.contains_key("NEXTAUTH_SECRET"));
        assert!(!opencode.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn trading_agent_worker_receives_only_sealed_roots_and_local_model_authority() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let trading = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::TradingAgent),
        );
        assert_eq!(
            trading["TRADINGAGENTS_ROOT"],
            paths.app_root().join("tradingagents").to_string_lossy()
        );
        assert_eq!(
            trading["TRADINGAGENTS_CREDENTIALS_FILE"],
            paths
                .data_root()
                .join("runtime-v2/services/tradingagents/credentials.json")
                .to_string_lossy()
        );
        assert_eq!(trading["CHATMOCK_API_KEY"], "local");
        assert!(trading.contains_key("PATH"));
        assert!(!trading.contains_key("NEXTAUTH_SECRET"));
        assert!(!trading.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn career_ops_worker_receives_managed_workspace_and_browser_roots() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let career = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterCareerOps),
        );
        assert_eq!(
            career["CAREER_OPS_ROOT"],
            paths.app_root().join("career-ops").to_string_lossy()
        );
        assert_eq!(
            career["PLAYWRIGHT_BROWSERS_PATH"],
            paths
                .data_root()
                .join("runtime-v2/toolchains/career-ops-browsers")
                .to_string_lossy()
        );
        assert_eq!(career["CHATMOCK_API_KEY"], "local");
        assert!(!career.contains_key("NEXTAUTH_SECRET"));
        assert!(!career.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn openexecutive_worker_receives_managed_state_source_and_local_model_authority() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let executive = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterOpenExecutive),
        );
        assert_eq!(
            executive["OPENEXECUTIVE_ROOT"],
            paths.app_root().join("OpenExecutive").to_string_lossy()
        );
        assert_eq!(
            executive["BREADBOARD_DATA_DIR"],
            paths.data_root().to_string_lossy()
        );
        assert_eq!(executive["CHATMOCK_API_KEY"], "local");
        assert!(!executive.contains_key("NEXTAUTH_SECRET"));
        assert!(!executive.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn chatmock_login_worker_reuses_only_the_sealed_chatmock_account_home() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let chatmock =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Chatmock));
        assert_eq!(
            chatmock["CODEX_HOME"],
            paths.data_root().join("runtime/codex").to_string_lossy()
        );
        assert!(chatmock.contains_key("PATH"));
        assert!(!chatmock.contains_key("NEXTAUTH_SECRET"));
        assert!(!chatmock.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn cinema_workers_receive_fixed_media_tools_and_only_vox_gets_service_control() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let vimax =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Vimax));
        assert_eq!(
            vimax["BREADBOARD_RUNTIME_V2_APP_ROOT"],
            paths.app_root().to_string_lossy()
        );
        assert_eq!(
            vimax["BREADBOARD_RUNTIME_V2_VIMAX_FFMPEG_PATH"],
            paths
                .runtime_root()
                .join("bin/ffmpeg.exe")
                .to_string_lossy()
        );
        assert_eq!(vimax["CHATMOCK_API_KEY"], "local");
        assert_eq!(vimax["OPENAI_API_KEY"], "local");
        assert!(!vimax.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!vimax.contains_key("NEXTAUTH_SECRET"));

        let vox =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::VoxDirector));
        assert_eq!(
            vox["BREADBOARD_RUNTIME_V2_VOX_ROOT"],
            paths.app_root().join("vox-director").to_string_lossy()
        );
        assert_eq!(
            vox["BREADBOARD_RUNTIME_V2_VOX_PYTHON_PATH"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            vox["BREADBOARD_RUNTIME_V2_VOX_FFMPEG_PATH"],
            paths
                .runtime_root()
                .join("bin/ffmpeg.exe")
                .to_string_lossy()
        );
        assert_eq!(
            vox["BREADBOARD_RUNTIME_V2_VOX_FFPROBE_PATH"],
            paths
                .runtime_root()
                .join("bin/ffprobe.exe")
                .to_string_lossy()
        );
        assert_eq!(vox["BREADBOARD_RUNTIME_V2_ACTIVE"], "true");
        assert_eq!(vox["BREADBOARD_SUPERVISOR_CONTROL_TOKEN"], CONTROL_TOKEN);
        assert_eq!(vox["COMFYUI_URL"], "http://127.0.0.1:7741");
        assert_eq!(vox["VOICEBOX_BASE_URL"], "http://127.0.0.1:7762");
        assert!(!vox.contains_key("NEXTAUTH_SECRET"));
        assert!(!vox.contains_key("HERMES_DASHBOARD_SESSION_TOKEN"));
        assert!(!vox.contains_key("VOX_DIRECTOR_WORKSPACE_ROOT"));
    }

    #[test]
    fn shorts_and_open_gym_workers_receive_only_sealed_source_and_data_roots() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let shorts =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterShorts));
        assert_eq!(
            shorts["SHORTS_ROOT"],
            paths
                .app_root()
                .join("AI-Youtube-Shorts-Generator")
                .to_string_lossy()
        );
        assert_eq!(
            shorts["SHORTS_PYTHON"],
            paths
                .data_root()
                .join("runtime-v2/services/shorts/.venv/Scripts/python.exe")
                .to_string_lossy()
        );
        assert_eq!(shorts["CHATMOCK_API_KEY"], "local");
        assert!(!shorts.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!shorts.contains_key("NEXTAUTH_SECRET"));

        let open_gym = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterOpenGym),
        );
        assert_eq!(
            open_gym["OPEN_GYM_ROOT"],
            paths.app_root().join("openGym").to_string_lossy()
        );
        assert_eq!(
            open_gym["OPEN_GYM_AGENT_DATA_DIR"],
            paths
                .data_root()
                .join("open-gym-agent/state")
                .to_string_lossy()
        );
        assert_eq!(
            open_gym["OPEN_GYM_MEDIA_CACHE_DIR"],
            paths
                .data_root()
                .join("open-gym-agent/media/gif")
                .to_string_lossy()
        );
        assert_eq!(open_gym["CHATMOCK_API_KEY"], "local");
        assert!(!open_gym.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        assert!(!open_gym.contains_key("NEXTAUTH_SECRET"));
    }

    #[test]
    fn agent_reach_setup_gets_original_browser_roots_and_an_exact_docker_path() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![
                ("USERPROFILE", OsString::from(r"C:\Users\Original")),
                (
                    "APPDATA",
                    OsString::from(r"C:\Users\Original\AppData\Roaming"),
                ),
                (
                    "LOCALAPPDATA",
                    OsString::from(r"C:\Users\Original\AppData\Local"),
                ),
            ],
            vec![(
                "DOCKER_CLI_PATH",
                OsString::from(r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"),
            )],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let setup = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::AgentReachSetup),
        );
        assert_eq!(
            setup["BREADBOARD_AGENT_REACH_BROWSER_HOME"],
            r"C:\Users\Original"
        );
        assert_eq!(setup["APPDATA"], r"C:\Users\Original\AppData\Roaming");
        assert_eq!(setup["LOCALAPPDATA"], r"C:\Users\Original\AppData\Local");
        assert_eq!(
            setup["DOCKER_CLI_PATH"],
            r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"
        );
        assert!(!setup.contains_key("NEXTAUTH_SECRET"));
        assert!(!setup.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn gbrain_sync_gets_only_the_runtime_adapter_contract() {
        let (_temporary, paths, config, os_environment) = fixture();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let sync =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::GbrainSync));
        assert_exact_names(
            &sync,
            &[
                "SystemRoot",
                "GBRAIN_MODE",
                "GBRAIN_ADAPTER_URL",
                "GBRAIN_ADAPTER_SECRET",
                "GBRAIN_QUERY_TIMEOUT_MS",
                "OPENAI_BASE_URL",
                "OPENAI_API_KEY",
            ],
        );
        assert_eq!(sync["GBRAIN_MODE"], "preferred");
        assert_eq!(sync["GBRAIN_ADAPTER_URL"], "http://127.0.0.1:7739");
        assert_eq!(sync["GBRAIN_ADAPTER_SECRET"], GBRAIN_ADAPTER_SECRET);
        assert_eq!(sync["GBRAIN_QUERY_TIMEOUT_MS"], "1500000");
        assert_eq!(sync["OPENAI_BASE_URL"], "http://127.0.0.1:7737/v1");
        assert_eq!(sync["OPENAI_API_KEY"], "local");
        assert!(!sync.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn outer_agent_reach_gets_only_managed_tools_and_the_pinned_browser() {
        let (temporary, paths, config, _) = fixture();
        let browser = temporary.path().join("browser").join("msedge.exe");
        fs::create_dir_all(browser.parent().unwrap()).unwrap();
        fs::write(&browser, b"test browser").unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![
                ("USERPROFILE", OsString::from(r"C:\Users\Original")),
                (
                    "APPDATA",
                    OsString::from(r"C:\Users\Original\AppData\Roaming"),
                ),
                (
                    "LOCALAPPDATA",
                    OsString::from(r"C:\Users\Original\AppData\Local"),
                ),
                ("PROGRAMFILES", OsString::from(r"C:\Program Files")),
                (
                    "PROGRAMFILES(X86)",
                    OsString::from(r"C:\Program Files (x86)"),
                ),
            ],
            vec![(
                "AGENT_BROWSER_EXECUTABLE_PATH",
                browser.as_os_str().to_os_string(),
            )],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let reach = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterAgentReach),
        );
        assert_eq!(
            reach["BREADBOARD_DATA_DIR"],
            paths.data_root().to_string_lossy()
        );
        assert_eq!(
            reach["AGENT_BROWSER_EXECUTABLE_PATH"],
            browser.to_string_lossy()
        );
        assert_eq!(reach["CHATMOCK_API_KEY"], "local");
        let closed_path = reach["PATH"].replace('\\', "/");
        for expected in [
            "runtime-v2/services/agent-reach/.venv/Scripts",
            "runtime-v2/toolchains/agent-reach/tools/bin",
            "runtime-v2/toolchains/agent-reach/npm",
            "WindowsPowerShell/v1.0",
        ] {
            assert!(closed_path.contains(expected));
        }
        assert!(!reach.contains_key("NEXTAUTH_SECRET"));
        assert!(!reach.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn browser_profile_worker_gets_only_the_pinned_browser_and_closed_profile_tools() {
        let (temporary, paths, config, _) = fixture();
        let browser = temporary.path().join("browser").join("msedge.exe");
        fs::create_dir_all(browser.parent().unwrap()).unwrap();
        fs::write(&browser, b"test browser").unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![
                ("USERPROFILE", OsString::from(r"C:\Users\Original")),
                (
                    "APPDATA",
                    OsString::from(r"C:\Users\Original\AppData\Roaming"),
                ),
                (
                    "LOCALAPPDATA",
                    OsString::from(r"C:\Users\Original\AppData\Local"),
                ),
                ("PROGRAMFILES", OsString::from(r"C:\Program Files")),
                (
                    "PROGRAMFILES(X86)",
                    OsString::from(r"C:\Program Files (x86)"),
                ),
            ],
            vec![(
                "AGENT_BROWSER_EXECUTABLE_PATH",
                browser.as_os_str().to_os_string(),
            )],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let profile = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::AgentBrowserProfile),
        );
        assert_eq!(
            profile["BREADBOARD_AGENT_BROWSER_PROFILE_BROWSER_PATH"],
            browser.to_string_lossy()
        );
        assert!(profile["BREADBOARD_AGENT_BROWSER_PROFILE_OPENCLI_PATH"]
            .replace('\\', "/")
            .ends_with("runtime-v2/toolchains/agent-reach/npm/opencli.cmd"));
        let tool_path = profile["BREADBOARD_AGENT_BROWSER_PROFILE_TOOL_PATH"].replace('\\', "/");
        assert!(tool_path.contains("runtime-v2/toolchains/agent-reach/npm"));
        assert!(tool_path.contains("runtimes/node"));
        for forbidden in [
            "CHATMOCK_API_KEY",
            "OPENAI_API_KEY",
            "NEXTAUTH_SECRET",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
        ] {
            assert!(!profile.contains_key(forbidden));
        }
    }

    #[test]
    fn outer_legal_gets_only_the_pinned_harness_shell_and_local_model_contract() {
        let (temporary, paths, config, _) = fixture();
        let program_files = temporary.path().join("Program Files");
        let bash = program_files.join("Git/bin/bash.exe");
        fs::create_dir_all(bash.parent().unwrap()).unwrap();
        fs::write(&bash, b"test git bash").unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![
                ("USERPROFILE", OsString::from(r"C:\Users\Original")),
                ("PROGRAMFILES", program_files.as_os_str().to_os_string()),
            ],
            Vec::new(),
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let legal =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterLegal));
        assert_eq!(
            legal["HARVEY_LABS_ROOT"],
            paths.app_root().join("harvey-labs").to_string_lossy()
        );
        assert_eq!(legal["LEGAL_AGENT_BASH"], bash.to_string_lossy());
        assert_eq!(legal["CHATMOCK_API_KEY"], "local");
        assert_eq!(legal["HOME"], r"C:\Users\Original");
        assert_eq!(legal["WINDIR"], r"C:\Windows");
        assert_eq!(legal["LANG"], "C.UTF-8");
        assert_eq!(legal["LC_ALL"], "C.UTF-8");
        for forbidden in [
            "OPENAI_API_KEY",
            "NEXTAUTH_SECRET",
            "GBRAIN_ADAPTER_SECRET",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
        ] {
            assert!(!legal.contains_key(forbidden));
        }
    }

    #[test]
    fn sf3d_gets_managed_paths_bounded_settings_and_one_canonical_model_token() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Original"))],
            vec![
                ("SF3D_DEVICE", OsString::from("cuda")),
                (
                    "SF3D_PRETRAINED_MODEL",
                    OsString::from("stabilityai/stable-fast-3d"),
                ),
                ("SF3D_TIMEOUT_MS", OsString::from("600000")),
                ("HF_TOKEN", OsString::from("sealed-hugging-face-token")),
                (
                    "HUGGING_FACE_HUB_TOKEN",
                    OsString::from("lower-priority-token"),
                ),
                ("CUDA_VISIBLE_DEVICES", OsString::from("0")),
            ],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let dashboard = values(&services.dashboard);
        assert!(!dashboard.contains_key("HF_TOKEN"));
        assert!(!dashboard.contains_key("HUGGING_FACE_HUB_TOKEN"));
        assert!(!dashboard.contains_key("SF3D_DEVICE"));
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let sf3d = worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Sf3d));
        assert_eq!(
            sf3d["SF3D_ROOT"],
            paths.app_root().join("stable-fast-3d").to_string_lossy()
        );
        assert_eq!(
            sf3d["SF3D_PYTHON"],
            paths
                .data_root()
                .join("runtime-v2/services/sf3d/.venv/Scripts/python.exe")
                .to_string_lossy()
        );
        assert_eq!(sf3d["SF3D_TIMEOUT_MS"], "600000");
        assert_eq!(sf3d["HUGGINGFACE_TOKEN"], "sealed-hugging-face-token");
        assert_eq!(sf3d["CUDA_VISIBLE_DEVICES"], "0");
        assert!(!sf3d.contains_key("HF_TOKEN"));
        assert!(!sf3d.contains_key("HUGGING_FACE_HUB_TOKEN"));
        assert!(!sf3d.contains_key("NEXTAUTH_SECRET"));
        assert!(!sf3d.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
    }

    #[test]
    fn coding_outer_workers_receive_only_fixed_tools_roots_and_bounded_product_settings() {
        let (_temporary, paths, config, _) = fixture();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Original"))],
            vec![
                ("RUFLO_CLAUDE_MODEL", OsString::from("claude-sonnet")),
                ("RUFLO_DANGEROUSLY_SKIP_PERMISSIONS", OsString::from("1")),
                ("HTTP_PROXY", OsString::from("http://127.0.0.1:8899")),
            ],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );

        let codex =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterCodex));
        assert_eq!(
            codex["CODEX_BIN"],
            paths.runtime_root().join("bin/codex.exe").to_string_lossy()
        );
        assert_eq!(
            codex["CODEX_HOME"],
            paths.data_root().join("runtime/codex").to_string_lossy()
        );
        assert_eq!(codex["CHATMOCK_API_KEY"], "local");
        assert_eq!(codex["BREADBOARD_RUNTIME_V2_FIXED_TOOLS"], "1");

        let ruflo =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterRuflo));
        assert_eq!(
            ruflo["RUFLO_BIN"],
            paths.app_root().join("ruflo/bin/cli.js").to_string_lossy()
        );
        assert_eq!(
            ruflo["RUFLO_CLAUDE_BIN"],
            paths
                .runtime_root()
                .join("bin/claude.exe")
                .to_string_lossy()
        );
        assert_eq!(ruflo["RUFLO_CLAUDE_MODEL"], "claude-sonnet");
        assert_eq!(ruflo["RUFLO_DANGEROUSLY_SKIP_PERMISSIONS"], "1");
        assert_eq!(ruflo["HOME"], r"C:\Users\Original");

        let deep_tutor = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterDeepTutor),
        );
        assert_eq!(
            deep_tutor["DEEP_TUTOR_ROOT"],
            paths.app_root().join("DeepTutor").to_string_lossy()
        );
        assert_eq!(
            deep_tutor["DEEP_TUTOR_HOME_ROOT"],
            paths
                .data_root()
                .join("runtime-v2/services/deep-tutor/home")
                .to_string_lossy()
        );
        assert_eq!(deep_tutor["CHATMOCK_API_KEY"], "local");
        let deep_tutor_maintenance = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::DeepTutorMaintenance),
        );
        assert_eq!(
            deep_tutor_maintenance["DEEP_TUTOR_PYTHON"],
            paths
                .data_root()
                .join("runtime-v2/services/deep-tutor/.venv/Scripts/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            deep_tutor_maintenance["DEEP_TUTOR_INDEX_SCRIPT"],
            paths
                .app_root()
                .join("scripts/deeptutor-index.py")
                .to_string_lossy()
        );
        assert!(!deep_tutor_maintenance.contains_key("CHATMOCK_API_KEY"));
        for environment in [&codex, &ruflo, &deep_tutor, &deep_tutor_maintenance] {
            assert_eq!(environment["HTTP_PROXY"], "http://127.0.0.1:8899");
            assert!(!environment.contains_key("NEXTAUTH_SECRET"));
            assert!(!environment.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
            assert!(!environment.contains_key("GBRAIN_ADAPTER_SECRET"));
        }
    }

    #[test]
    fn openplanter_and_manim_workers_receive_fixed_interpreters_and_docker_policy() {
        let (temporary, paths, config, _) = fixture();
        let docker = temporary.path().join("Docker").join("docker.exe");
        fs::create_dir_all(docker.parent().unwrap()).unwrap();
        fs::write(&docker, b"test docker cli").unwrap();
        let os_environment = TrustedOsEnvironment::from_captured_values(
            OsString::from(r"C:\Windows"),
            vec![("USERPROFILE", OsString::from(r"C:\Users\Original"))],
            vec![
                ("DOCKER_CLI_PATH", docker.as_os_str().to_os_string()),
                (
                    "MANIM_DOCKER_IMAGE",
                    OsString::from("manimcommunity/manim:v0.20.1"),
                ),
                ("MANIM_TIMEOUT_MS", OsString::from("360000")),
                ("DOCKER_CONTEXT", OsString::from("desktop-linux")),
            ],
        )
        .unwrap();
        let services = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let dashboard = values(&services.dashboard);
        assert!(!dashboard.contains_key("MANIM_DOCKER_IMAGE"));
        assert!(!dashboard.contains_key("DOCKER_CONTEXT"));
        let workers = TrustedWorkerEnvironmentSet::from_service_environments(
            RuntimeMode::Packaged,
            &services,
            &paths,
            &os_environment,
        );
        let openplanter = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterOpenPlanter),
        );
        assert_eq!(
            openplanter["OPENPLANTER_ROOT"],
            paths.app_root().join("OpenPlanter").to_string_lossy()
        );
        assert_eq!(
            openplanter["OPENPLANTER_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(openplanter["CHATMOCK_API_KEY"], "local");
        let manim =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Manim));
        assert_eq!(manim["MANIM_DOCKER_BIN"], docker.to_string_lossy());
        assert_eq!(manim["MANIM_DOCKER_IMAGE"], "manimcommunity/manim:v0.20.1");
        assert_eq!(manim["MANIM_TIMEOUT_MS"], "360000");
        assert_eq!(manim["DOCKER_CONTEXT"], "desktop-linux");
        let premortem =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Premortem));
        assert_eq!(
            premortem["BREADBOARD_PREMORTEM_ROOT"],
            paths
                .app_root()
                .join("premortem-runtime/source")
                .to_string_lossy()
        );
        assert_eq!(
            premortem["BREADBOARD_PREMORTEM_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            premortem["HERMES_ROOT"],
            paths.data_root().join("runtime/hermes").to_string_lossy()
        );
        assert!(!premortem.contains_key("PATH"));
        let agent_loop =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::AgentLoop));
        assert_eq!(
            agent_loop["BREADBOARD_AGENT_LOOP_ROOT"],
            paths
                .app_root()
                .join("agent-loop-runtime/source")
                .to_string_lossy()
        );
        assert_eq!(
            agent_loop["BREADBOARD_AGENT_LOOP_PYTHON"],
            paths
                .app_root()
                .join("agent-loop-runtime/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            agent_loop["BREADBOARD_AGENT_LOOP_SITE_PACKAGES"],
            paths
                .app_root()
                .join("agent-loop-runtime/site-packages")
                .to_string_lossy()
        );
        assert_eq!(
            agent_loop["HERMES_ROOT"],
            paths.data_root().join("runtime/hermes").to_string_lossy()
        );
        assert!(!agent_loop.contains_key("PATH"));
        let omh = worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Omh));
        assert_eq!(
            omh["BREADBOARD_OMH_ROOT"],
            paths.app_root().join("oh-my-hermes").to_string_lossy()
        );
        assert_eq!(
            omh["BREADBOARD_OMH_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert!(!omh.contains_key("PATH"));
        let factcheck =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Factcheck));
        assert_eq!(
            factcheck["BREADBOARD_BULLSHIT_DETECTOR_ROOT"],
            paths.app_root().join("bullshit-detector").to_string_lossy()
        );
        assert_eq!(
            factcheck["BREADBOARD_FACTCHECK_UV"],
            paths.runtime_root().join("bin/uv.exe").to_string_lossy()
        );
        assert_eq!(
            factcheck["BREADBOARD_FACTCHECK_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            factcheck["UV_CACHE_DIR"],
            paths
                .data_root()
                .join("runtime-v2/toolchains/cache/uv")
                .to_string_lossy()
        );
        assert!(!factcheck.contains_key("PATH"));
        let watch_media =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::WatchMedia));
        assert_eq!(
            watch_media["BREADBOARD_WATCH_ROOT"],
            paths
                .app_root()
                .join("hermes-skills/prebuilt/watch")
                .to_string_lossy()
        );
        assert_eq!(
            watch_media["BREADBOARD_WATCH_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            watch_media["FFMPEG_PATH"],
            paths
                .runtime_root()
                .join("bin/ffmpeg.exe")
                .to_string_lossy()
        );
        assert_eq!(watch_media["CHATMOCK_API_KEY"], "local");
        assert_eq!(watch_media["CHATMOCK_MODEL"], "default");
        assert_eq!(
            watch_media["BREADBOARD_WATCH_CONFIG_DIR"],
            Path::new(r"C:\Users\Original")
                .join(".config")
                .join("watch")
                .to_string_lossy()
        );
        let loopx =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Loopx));
        assert_eq!(
            loopx["BREADBOARD_LOOPX_ROOT"],
            paths.app_root().join("LoopX").to_string_lossy()
        );
        assert_eq!(
            loopx["BREADBOARD_LOOPX_PYTHON"],
            paths
                .runtime_root()
                .join("runtimes/python/python.exe")
                .to_string_lossy()
        );
        assert_eq!(
            loopx["BREADBOARD_LOOPX_HOME"],
            paths.data_root().join("loopx-goals").to_string_lossy()
        );
        assert_eq!(loopx["ENABLE_LOOPX"], "1");
        assert!(!loopx.contains_key("PATH"));
        let resource2skill = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::Resource2Skill),
        );
        assert_eq!(
            resource2skill["RESOURCE2SKILL_ROOT"],
            paths.app_root().join("Resource2Skill").to_string_lossy()
        );
        assert_eq!(
            resource2skill["RESOURCE2SKILL_WORKSPACE_ROOT"],
            paths
                .data_root()
                .join("resource2skill-runs")
                .to_string_lossy()
        );
        assert_eq!(
            resource2skill["PLAYWRIGHT_BROWSERS_PATH"],
            paths
                .data_root()
                .join("runtime-v2/services/resource2skill/browsers")
                .to_string_lossy()
        );
        assert_eq!(resource2skill["CHATMOCK_API_KEY"], "local");
        let outer_matraix = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterMatraix),
        );
        assert_eq!(
            outer_matraix["MATRAIX_ROOT"],
            paths
                .app_root()
                .join("MatrAIx-Persona-8B")
                .to_string_lossy()
        );
        assert_eq!(outer_matraix["CHATMOCK_API_KEY"], "local");
        let formsmith =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Formsmith));
        assert_eq!(
            formsmith["SHAPER_ROOT"],
            paths.app_root().join("ShapeR").to_string_lossy()
        );
        assert_eq!(
            formsmith["SHAPER_PYTHON"],
            paths
                .data_root()
                .join("runtime-v2/services/formsmith/.venv/Scripts/python.exe")
                .to_string_lossy()
        );
        assert!(formsmith["SHAPER_TOOL_PATH"].contains("formsmith"));
        let hyperframes =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Hyperframes));
        assert_eq!(
            hyperframes["HYPERFRAMES_ROOT"],
            paths.app_root().join("hyperframes").to_string_lossy()
        );
        assert_eq!(
            hyperframes["HYPERFRAMES_CLI_ROOT"],
            paths.data_root().join("hyperframes-cli").to_string_lossy()
        );
        assert_eq!(
            hyperframes["HYPERFRAMES_FFMPEG_PATH"],
            paths
                .runtime_root()
                .join("bin/ffmpeg.exe")
                .to_string_lossy()
        );
        assert_eq!(
            hyperframes["CODEX_BIN"],
            paths.runtime_root().join("bin/codex.exe").to_string_lossy()
        );
        let openmontage =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::OpenMontage));
        assert_eq!(
            openmontage["OPENMONTAGE_SOURCE_COMMIT"],
            "4eab34c5cfcccaa4f1970554928feccce73ee930"
        );
        assert_eq!(
            openmontage["OPENMONTAGE_FFMPEG_PATH"],
            paths.runtime_root().join("bin").to_string_lossy()
        );
        assert_eq!(openmontage["CHATMOCK_API_KEY"], "local");
        let bolt_slides = worker_values(
            &workers.prepare_for_source(TrustedWorkerEnvironmentSource::OuterBoltSlides),
        );
        assert_eq!(
            bolt_slides["BOLT_SLIDES_ROOT"],
            paths.app_root().join("bolt-slides").to_string_lossy()
        );
        assert_eq!(bolt_slides["CHATMOCK_API_KEY"], "local");
        let subsai =
            worker_values(&workers.prepare_for_source(TrustedWorkerEnvironmentSource::Subsai));
        assert_eq!(
            subsai["SUBSAI_ROOT"],
            paths.app_root().join("subsai").to_string_lossy()
        );
        assert_eq!(
            subsai["SUBSAI_SOURCE_COMMIT"],
            "5ed78a85d2b868a907c811404f7cd9179db39968"
        );
        assert_eq!(
            subsai["UV_PATH"],
            paths.runtime_root().join("bin/uv.exe").to_string_lossy()
        );
        assert_eq!(
            subsai["BREADBOARD_RUNTIME_V2_MEDIA_BIN"],
            paths.runtime_root().join("bin").to_string_lossy()
        );
        for environment in [
            &openplanter,
            &manim,
            &premortem,
            &agent_loop,
            &omh,
            &factcheck,
            &watch_media,
            &loopx,
            &resource2skill,
            &outer_matraix,
            &formsmith,
            &hyperframes,
            &openmontage,
            &bolt_slides,
            &subsai,
        ] {
            assert!(!environment.contains_key("NEXTAUTH_SECRET"));
            assert!(!environment.contains_key("BREADBOARD_SUPERVISOR_CONTROL_TOKEN"));
        }
    }

    #[test]
    fn runtime_endpoint_receipt_is_sanitized_atomic_and_runtime_owned() {
        let (_temporary, paths, config, os_environment) = fixture();
        let _set = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let receipt_path = paths.data_root().join("runtime").join("endpoints.json");
        let bytes = fs::read(&receipt_path).unwrap();
        let receipt: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(receipt["pid"], json!(std::process::id()));
        let started_at = receipt["startedAt"].as_str().unwrap();
        assert_eq!(started_at.len(), 24);
        assert!(started_at.ends_with('Z'));
        let urls = receipt["urls"].as_object().unwrap();
        assert_eq!(
            urls.keys().map(String::as_str).collect::<HashSet<_>>(),
            HashSet::from(["chatmock", "dashboard", "gbrain", "quartz"])
        );
        assert_eq!(urls["chatmock"], json!("http://127.0.0.1:7737"));
        assert_eq!(urls["dashboard"], json!("http://127.0.0.1:7738"));
        assert_eq!(urls["gbrain"], json!("http://127.0.0.1:7739"));
        assert_eq!(urls["quartz"], json!("http://127.0.0.1:7738"));
        assert!(!urls.contains_key("hermes"));
        let text = String::from_utf8(bytes).unwrap();
        for secret in [CONTROL_TOKEN, HERMES_SESSION_TOKEN, HERMES_TOOL_SECRET] {
            assert!(!text.contains(secret));
        }

        let config_path = config.absolute().join(DESKTOP_CONFIG_FILE);
        let mut desktop_config: serde_json::Value =
            serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
        desktop_config["gbrainMode"] = json!("disabled");
        fs::write(&config_path, serde_json::to_vec(&desktop_config).unwrap()).unwrap();
        let _replacement_set = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let replacement: serde_json::Value =
            serde_json::from_slice(&fs::read(receipt_path).unwrap()).unwrap();
        assert!(!replacement["urls"]
            .as_object()
            .unwrap()
            .contains_key("gbrain"));
    }

    #[test]
    fn profile_source_and_mode_checks_do_not_mutate_the_retained_source() {
        let (_temporary, paths, config, os_environment) = fixture();
        let set = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Lean,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        assert!(matches!(
            set.prepare_for_launch_profile(
                "chatmock",
                &launch_profile(
                    RuntimeMode::Lean,
                    TrustedServiceEnvironmentSource::Dashboard
                )
            ),
            Err(TrustedServiceEnvironmentError::EnvironmentSourceMismatch { .. })
        ));
        assert!(matches!(
            set.prepare_for_launch_profile(
                "chatmock",
                &launch_profile(RuntimeMode::Hot, TrustedServiceEnvironmentSource::Chatmock)
            ),
            Err(TrustedServiceEnvironmentError::EnvironmentModeMismatch { .. })
        ));
        assert!(set
            .prepare_for_launch_profile(
                "chatmock",
                &launch_profile(RuntimeMode::Lean, TrustedServiceEnvironmentSource::Chatmock)
            )
            .is_ok());
        assert!(set
            .prepare_for_launch_profile(
                "chatmock",
                &launch_profile(RuntimeMode::Lean, TrustedServiceEnvironmentSource::Chatmock)
            )
            .is_ok());
    }

    #[test]
    fn config_requires_v2_and_bounded_required_secrets_but_ignores_other_fields() {
        let (_temporary, paths, config, os_environment) = fixture();
        assert!(TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .is_ok());

        let config_path = config.absolute().join(DESKTOP_CONFIG_FILE);
        fs::write(
            &config_path,
            serde_json::to_vec(&json!({
                "version": 1,
                "nextAuthSecret": NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": HERMES_SESSION_TOKEN,
                "hermesToolSecret": HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789"
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(matches!(
            TrustedServiceEnvironmentSet::load(
                RuntimeMode::Packaged,
                &paths,
                &config,
                &endpoints(),
                control(),
                &os_environment,
            ),
            Err(TrustedServiceEnvironmentError::UnsupportedDesktopConfigVersion)
        ));
    }

    #[test]
    fn external_comfyui_configuration_is_explicit_bounded_and_dashboard_only() {
        let (_temporary, paths, config, os_environment) = fixture();
        let config_path = config.absolute().join(DESKTOP_CONFIG_FILE);
        fs::write(
            &config_path,
            serde_json::to_vec(&json!({
                "version": 2,
                "nextAuthSecret": NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": HERMES_SESSION_TOKEN,
                "hermesToolSecret": HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789",
                "comfyUiMode": "external",
                "comfyUiExternalUrl": "https://comfy.example.test:8188/api"
            }))
            .unwrap(),
        )
        .unwrap();
        let set = TrustedServiceEnvironmentSet::load(
            RuntimeMode::Packaged,
            &paths,
            &config,
            &endpoints(),
            control(),
            &os_environment,
        )
        .unwrap();
        let dashboard = values(
            &set.prepare_for_launch_profile(
                "dashboard",
                &launch_profile(
                    RuntimeMode::Packaged,
                    TrustedServiceEnvironmentSource::Dashboard,
                ),
            )
            .unwrap(),
        );
        assert_eq!(dashboard["COMFYUI_ENABLED"], "true");
        assert_eq!(dashboard["COMFYUI_MANAGED"], "false");
        assert_eq!(
            dashboard["COMFYUI_URL"],
            "https://comfy.example.test:8188/api"
        );
        let comfyui = values(
            &set.prepare_for_launch_profile(
                "comfyui",
                &launch_profile(
                    RuntimeMode::Packaged,
                    TrustedServiceEnvironmentSource::Comfyui,
                ),
            )
            .unwrap(),
        );
        assert_eq!(comfyui["COMFYUI_URL"], "http://127.0.0.1:7741");

        let mut invalid: serde_json::Value =
            serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
        invalid["comfyUiExternalUrl"] = json!("http://user:secret@127.0.0.1:8188");
        fs::write(&config_path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(matches!(
            TrustedServiceEnvironmentSet::load(
                RuntimeMode::Packaged,
                &paths,
                &config,
                &endpoints(),
                control(),
                &os_environment,
            ),
            Err(TrustedServiceEnvironmentError::InvalidDesktopConfigField {
                field: "comfyUiExternalUrl"
            })
        ));
    }
}
