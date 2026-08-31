use std::fmt;

use serde::{de::Deserializer, Deserialize, Serialize};
use serde_json::{json, Value};

pub const BYOK_ACCOUNT: &str = "biel4";
pub const MAX_PROVIDER_ENDPOINT_BYTES: usize = 2 * 1024;
pub const MAX_PROVIDER_MODEL_BYTES: usize = 256;
pub const MAX_PROVIDER_API_KEY_BYTES: usize = 2 * 1024;
pub const DEFAULT_EXTERNAL_CONNECT_TIMEOUT_MS: u64 = 5_000;
pub const DEFAULT_EXTERNAL_READ_TIMEOUT_MS: u64 = 30_000;
pub const MAX_EXTERNAL_TIMEOUT_MS: u64 = 120_000;
pub const MAX_EXTERNAL_TOKEN_COUNT: u64 = 100_000_000;
pub const MAX_EXTERNAL_PRICE_USD_PER_MILLION_TOKENS: f64 = 1_000_000.0;
pub const MAX_EXTERNAL_BUDGET_USD: f64 = 1_000_000_000.0;
pub const TOKENS_PER_MILLION: f64 = 1_000_000.0;
pub const MAX_EXTERNAL_PROMPT_BYTES: usize = 64 * 1024;
pub const MAX_EXTERNAL_REQUEST_BYTES: usize = 256 * 1024;
pub const MAX_EXTERNAL_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const COST_ROUNDING_TOLERANCE_USD: f64 = 2.0 / TOKENS_PER_MILLION;

const CREDENTIAL_BLOB_MAX_BYTES: usize = 2_560;
const STORED_CREDENTIAL_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum ExternalProviderId {
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
    #[serde(rename = "openai")]
    OpenAi,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "gemini")]
    Gemini,
}

impl ExternalProviderId {
    pub const ALL: [Self; 4] = [
        Self::OpenAiCompatible,
        Self::OpenAi,
        Self::Anthropic,
        Self::Gemini,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "openai-compatible",
            Self::OpenAi => "openai",
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "OpenAI-compatible",
            Self::OpenAi => "OpenAI",
            Self::Anthropic => "Anthropic",
            Self::Gemini => "Gemini",
        }
    }

    pub const fn kind(self) -> ProviderKind {
        match self {
            Self::OpenAiCompatible => ProviderKind::GenericOpenAiCompatible,
            Self::OpenAi | Self::Anthropic | Self::Gemini => ProviderKind::Native,
        }
    }

    pub const fn default_endpoint(self) -> &'static str {
        match self {
            Self::OpenAiCompatible => "https://api.openai.com/v1",
            Self::OpenAi => "https://api.openai.com/v1",
            Self::Anthropic => "https://api.anthropic.com/v1",
            Self::Gemini => "https://generativelanguage.googleapis.com/v1beta",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    #[serde(rename = "generic_openai_compatible")]
    GenericOpenAiCompatible,
    Native,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecureStorageStatus {
    Available,
    Unsupported,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialSource {
    NotConfigured,
    OsSecureStorage,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdentityConfidence {
    Unverified,
    ProviderReported,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalProviderMetadata {
    pub provider_id: ExternalProviderId,
    pub label: &'static str,
    pub kind: ProviderKind,
    pub default_endpoint: &'static str,
    pub configured: bool,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub credential_source: CredentialSource,
    pub storage_status: SecureStorageStatus,
    pub identity_confidence: IdentityConfidence,
    pub connect_timeout_ms: Option<u64>,
    pub read_timeout_ms: Option<u64>,
    pub confirmation_threshold_usd: Option<f64>,
    pub ceiling_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CostPolicy {
    pub confirmation_threshold_usd: Option<f64>,
    pub ceiling_usd: Option<f64>,
}

impl Default for CostPolicy {
    fn default() -> Self {
        Self {
            confirmation_threshold_usd: None,
            ceiling_usd: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PriceSnapshot {
    pub provider_id: ExternalProviderId,
    pub model_id: String,
    pub captured_on: String,
    pub currency: String,
    pub input_usd_per_million_tokens: Option<f64>,
    pub output_usd_per_million_tokens: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdown {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub input_cost_usd: f64,
    pub output_cost_usd: f64,
    pub total_cost_usd: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CostFailure {
    MissingPrice,
    InvalidPrice,
    InvalidUsage,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CostDecision {
    Allow,
    ConfirmationRequired,
    CeilingExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalProviderError {
    UnsupportedPlatform,
    SecureStorageUnavailable,
    SecureStorageError,
    NotConfigured,
    InvalidConfiguration,
    InvalidCredential,
    NetworkConsentRequired,
    RequestTooLarge,
    ResponseTooLarge,
    Timeout,
    Transport,
    Authentication,
    Remote { status: u16 },
    MalformedResponse,
    UnsupportedParameter,
    MissingUsage,
    InvalidUsage,
    MissingPrice,
    InvalidPrice,
    ConfirmationRequired,
    BudgetCeilingExceeded,
}

impl fmt::Display for ExternalProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::UnsupportedPlatform => "secure provider storage is unavailable on this platform",
            Self::SecureStorageUnavailable => {
                "the operating system secure credential store is unavailable"
            }
            Self::SecureStorageError => "the operating system secure credential store failed",
            Self::NotConfigured => "the selected provider is not configured",
            Self::InvalidConfiguration => "the provider configuration is invalid",
            Self::InvalidCredential => "the provider credential is invalid",
            Self::NetworkConsentRequired => "explicit external network consent is required",
            Self::RequestTooLarge => "the provider request exceeds the local size limit",
            Self::ResponseTooLarge => "the provider response exceeds the local size limit",
            Self::Timeout => "the provider request timed out",
            Self::Transport => "the provider transport failed",
            Self::Authentication => "the provider rejected authentication",
            Self::Remote { .. } => "the provider rejected the request",
            Self::MalformedResponse => "the provider response was malformed",
            Self::UnsupportedParameter => "the provider cannot honor the requested parameter",
            Self::MissingUsage => "the provider did not report billable usage",
            Self::InvalidUsage => "the provider reported invalid billable usage",
            Self::MissingPrice => "a dated price snapshot is required",
            Self::InvalidPrice => "the dated price snapshot is invalid",
            Self::ConfirmationRequired => "explicit cost confirmation is required",
            Self::BudgetCeilingExceeded => "the configured budget ceiling would be exceeded",
        })
    }
}

impl std::error::Error for ExternalProviderError {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureProviderRequest {
    pub provider_id: ExternalProviderId,
    pub endpoint: String,
    pub model: String,
    pub api_key: SecretInput,
    #[serde(default)]
    pub connect_timeout_ms: Option<u64>,
    #[serde(default)]
    pub read_timeout_ms: Option<u64>,
    #[serde(default)]
    pub cost_policy: Option<CostPolicy>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderCostPolicyRequest {
    pub provider_id: ExternalProviderId,
    pub cost_policy: CostPolicy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalGenerationRequest {
    pub provider_id: ExternalProviderId,
    pub prompt: String,
    pub max_output_tokens: u64,
    #[serde(default)]
    pub network_consent: bool,
    #[serde(default)]
    pub cost_confirmed: bool,
    #[serde(default)]
    pub price_snapshot: Option<PriceSnapshot>,
}

impl fmt::Debug for ExternalGenerationRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExternalGenerationRequest")
            .field("provider_id", &self.provider_id)
            .field("prompt", &"REDACTED")
            .field("max_output_tokens", &self.max_output_tokens)
            .field("network_consent", &self.network_consent)
            .field("cost_confirmed", &self.cost_confirmed)
            .field("price_snapshot", &self.price_snapshot)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalCostEvidence {
    pub price_snapshot: PriceSnapshot,
    pub estimated: CostBreakdown,
    pub actual: CostBreakdown,
    pub preflight_decision: CostDecision,
    pub final_decision: CostDecision,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalGenerationResult {
    pub provider_id: ExternalProviderId,
    pub requested_model: String,
    pub provider_model: String,
    pub identity_confidence: IdentityConfidence,
    pub text: String,
    pub usage: ExternalUsage,
    pub network_used: bool,
    pub cost: ExternalCostEvidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalGenerationEvidencePayload {
    pub generation_id: String,
    pub provider_id: ExternalProviderId,
    pub requested_model: String,
    pub provider_model: String,
    pub identity_confidence: IdentityConfidence,
    pub network_used: bool,
    pub usage: ExternalUsage,
    pub estimated: CostBreakdown,
    pub actual: CostBreakdown,
    pub preflight_decision: CostDecision,
    pub final_decision: CostDecision,
    pub price_snapshot: PriceSnapshot,
}

pub fn sanitized_external_generation_evidence(
    generation_id: String,
    result: &ExternalGenerationResult,
) -> Result<ExternalGenerationEvidencePayload, ExternalProviderError> {
    let evidence = ExternalGenerationEvidencePayload {
        generation_id,
        provider_id: result.provider_id,
        requested_model: result.requested_model.clone(),
        provider_model: result.provider_model.clone(),
        identity_confidence: result.identity_confidence,
        network_used: result.network_used,
        usage: result.usage.clone(),
        estimated: result.cost.estimated.clone(),
        actual: result.cost.actual.clone(),
        preflight_decision: result.cost.preflight_decision,
        final_decision: result.cost.final_decision,
        price_snapshot: result.cost.price_snapshot.clone(),
    };
    validate_external_generation_evidence(&evidence)?;
    Ok(evidence)
}

pub fn validate_external_generation_evidence(
    evidence: &ExternalGenerationEvidencePayload,
) -> Result<(), ExternalProviderError> {
    validate_model(&evidence.requested_model)?;
    validate_model(&evidence.provider_model)?;
    let total_tokens = evidence
        .usage
        .input_tokens
        .checked_add(evidence.usage.output_tokens)
        .filter(|value| valid_token_count(*value))
        .ok_or(ExternalProviderError::InvalidUsage)?;
    if evidence.usage.total_tokens != total_tokens {
        return Err(ExternalProviderError::InvalidUsage);
    }
    if evidence.actual.input_tokens != evidence.usage.input_tokens
        || evidence.actual.output_tokens != evidence.usage.output_tokens
        || evidence.actual.total_cost_usd < 0.0
    {
        return Err(ExternalProviderError::InvalidUsage);
    }
    let expected_estimated = estimate_external_cost(
        Some(&evidence.price_snapshot),
        evidence.provider_id,
        &evidence.requested_model,
        evidence.estimated.input_tokens,
        evidence.estimated.output_tokens,
    )
    .map_err(map_cost_failure)?;
    if expected_estimated != evidence.estimated {
        return Err(ExternalProviderError::InvalidPrice);
    }
    let expected_actual = estimate_external_cost(
        Some(&evidence.price_snapshot),
        evidence.provider_id,
        &evidence.requested_model,
        evidence.usage.input_tokens,
        evidence.usage.output_tokens,
    )
    .map_err(map_cost_failure)?;
    if expected_actual != evidence.actual {
        return Err(ExternalProviderError::InvalidPrice);
    }
    Ok(())
}

pub struct SecretInput(Vec<u8>);

impl<'de> Deserialize<'de> for SecretInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(|value| Self(value.into_bytes()))
    }
}

impl SecretInput {
    fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for SecretInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretInput(REDACTED)")
    }
}

impl Drop for SecretInput {
    fn drop(&mut self) {
        zeroize_bytes(&mut self.0);
    }
}

struct SecretBytes(Vec<u8>);

impl SecretBytes {
    fn new(value: Vec<u8>) -> Self {
        Self(value)
    }

    fn as_slice(&self) -> &[u8] {
        &self.0
    }

    #[cfg(target_os = "windows")]
    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.0.as_mut_ptr()
    }
}

impl Drop for SecretBytes {
    fn drop(&mut self) {
        zeroize_bytes(&mut self.0);
    }
}

fn zeroize_bytes(value: &mut [u8]) {
    for byte in value {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
}

impl fmt::Debug for SecretBytes {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretBytes(REDACTED)")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecureStorageError {
    UnsupportedPlatform,
    Unavailable,
}

pub trait CredentialBackend {
    fn write(&self, target: &str, value: &[u8]) -> Result<(), SecureStorageError>;
    fn read(&self, target: &str) -> Result<Option<Vec<u8>>, SecureStorageError>;
    fn delete(&self, target: &str) -> Result<bool, SecureStorageError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct OsCredentialBackend;

#[cfg(target_os = "windows")]
impl CredentialBackend for OsCredentialBackend {
    fn write(&self, target: &str, value: &[u8]) -> Result<(), SecureStorageError> {
        use std::ptr::null_mut;

        use windows::{
            core::PWSTR,
            Win32::Security::Credentials::{
                CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
            },
        };

        let mut target_w = wide_null(target);
        let mut value = SecretBytes::new(value.to_vec());
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target_w.as_mut_ptr()),
            CredentialBlobSize: value.as_slice().len() as u32,
            CredentialBlob: value.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(null_mut()),
            ..CREDENTIALW::default()
        };
        unsafe { CredWriteW(&credential, 0) }.map_err(|_| SecureStorageError::Unavailable)
    }

    fn read(&self, target: &str) -> Result<Option<Vec<u8>>, SecureStorageError> {
        use std::{ffi::c_void, ptr::null_mut, slice};

        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::ERROR_NOT_FOUND,
                Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC},
            },
        };

        let target_w = wide_null(target);
        let mut credential: *mut CREDENTIALW = null_mut();
        let result = unsafe {
            CredReadW(
                PCWSTR(target_w.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut credential,
            )
        };
        if let Err(error) = result {
            if error.code() == ERROR_NOT_FOUND.to_hresult() {
                return Ok(None);
            }
            return Err(SecureStorageError::Unavailable);
        }
        if credential.is_null() {
            return Err(SecureStorageError::Unavailable);
        }
        let value = unsafe {
            let credential_ref = &*credential;
            if credential_ref.CredentialBlobSize as usize > CREDENTIAL_BLOB_MAX_BYTES
                || credential_ref.CredentialBlob.is_null()
            {
                CredFree(credential.cast::<c_void>());
                return Err(SecureStorageError::Unavailable);
            }
            slice::from_raw_parts(
                credential_ref.CredentialBlob,
                credential_ref.CredentialBlobSize as usize,
            )
            .to_vec()
        };
        unsafe { CredFree(credential.cast::<c_void>()) };
        Ok(Some(value))
    }

    fn delete(&self, target: &str) -> Result<bool, SecureStorageError> {
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::ERROR_NOT_FOUND,
                Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC},
            },
        };

        let target_w = wide_null(target);
        match unsafe { CredDeleteW(PCWSTR(target_w.as_ptr()), CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(true),
            Err(error) if error.code() == ERROR_NOT_FOUND.to_hresult() => Ok(false),
            Err(_) => Err(SecureStorageError::Unavailable),
        }
    }
}

#[cfg(not(target_os = "windows"))]
impl CredentialBackend for OsCredentialBackend {
    fn write(&self, _target: &str, _value: &[u8]) -> Result<(), SecureStorageError> {
        Err(SecureStorageError::UnsupportedPlatform)
    }

    fn read(&self, _target: &str) -> Result<Option<Vec<u8>>, SecureStorageError> {
        Err(SecureStorageError::UnsupportedPlatform)
    }

    fn delete(&self, _target: &str) -> Result<bool, SecureStorageError> {
        Err(SecureStorageError::UnsupportedPlatform)
    }
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProviderEndpoint {
    display: String,
    host: String,
    port: u16,
    path: String,
}

impl ProviderEndpoint {
    fn parse(input: &str) -> Result<Self, ExternalProviderError> {
        let endpoint = input.trim();
        if endpoint.len() != input.len()
            || endpoint.is_empty()
            || endpoint.len() > MAX_PROVIDER_ENDPOINT_BYTES
            || endpoint
                .chars()
                .any(|character| character.is_control() || character.is_whitespace())
        {
            return Err(ExternalProviderError::InvalidConfiguration);
        }
        let (scheme, authority_and_path) = endpoint
            .split_once("://")
            .ok_or(ExternalProviderError::InvalidConfiguration)?;
        if !scheme.eq_ignore_ascii_case("https")
            || authority_and_path.is_empty()
            || authority_and_path.contains('@')
            || authority_and_path.contains('?')
            || authority_and_path.contains('#')
            || authority_and_path.contains('\\')
        {
            return Err(ExternalProviderError::InvalidConfiguration);
        }
        let (authority, raw_path) = authority_and_path
            .split_once('/')
            .map_or((authority_and_path, ""), |(authority, path)| {
                (authority, path)
            });
        let (host, port) = parse_provider_authority(authority)?;
        let path = normalize_provider_path(raw_path)?;
        let display_host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.clone()
        };
        let display = format!(
            "https://{display_host}{}{}",
            if port == 443 {
                String::new()
            } else {
                format!(":{port}")
            },
            if path.is_empty() {
                String::new()
            } else {
                format!("/{path}")
            }
        );
        Ok(Self {
            display,
            host,
            port,
            path,
        })
    }

    fn display(&self) -> &str {
        &self.display
    }
}

struct TransportHeader {
    name: &'static str,
    value: SecretBytes,
}

struct TransportRequest {
    endpoint: ProviderEndpoint,
    path: String,
    headers: Vec<TransportHeader>,
    body: Vec<u8>,
    connect_timeout_ms: u64,
    read_timeout_ms: u64,
}

#[derive(Clone)]
struct TransportResponse {
    status: u16,
    body: Vec<u8>,
}

trait ExternalTransport {
    fn send(&self, request: &TransportRequest) -> Result<TransportResponse, ExternalProviderError>;

    fn network_used(&self) -> bool;
}

#[derive(Debug, Default, Clone, Copy)]
struct HttpsTransport;

#[cfg(target_os = "windows")]
struct SecretWide(Vec<u16>);

#[cfg(target_os = "windows")]
impl Drop for SecretWide {
    fn drop(&mut self) {
        for value in &mut self.0 {
            unsafe { std::ptr::write_volatile(value, 0) };
        }
    }
}

#[cfg(target_os = "windows")]
struct WinHttpHandle(*mut std::ffi::c_void);

#[cfg(target_os = "windows")]
impl Drop for WinHttpHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            use windows::Win32::Networking::WinHttp::WinHttpCloseHandle;

            let _ = unsafe { WinHttpCloseHandle(self.0) };
        }
    }
}

#[cfg(target_os = "windows")]
fn append_ascii_wide(output: &mut Vec<u16>, value: &[u8]) -> Result<(), ExternalProviderError> {
    if value.iter().any(|byte| !byte.is_ascii()) {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    output.extend(value.iter().map(|byte| u16::from(*byte)));
    Ok(())
}

#[cfg(target_os = "windows")]
fn wide_headers(headers: &[TransportHeader]) -> Result<SecretWide, ExternalProviderError> {
    let mut output = SecretWide(Vec::new());
    for header in headers {
        append_ascii_wide(&mut output.0, header.name.as_bytes())?;
        append_ascii_wide(&mut output.0, b": ")?;
        append_ascii_wide(&mut output.0, header.value.as_slice())?;
        append_ascii_wide(&mut output.0, b"\r\n")?;
    }
    Ok(output)
}

#[cfg(target_os = "windows")]
fn map_winhttp_error(error: windows::core::Error) -> ExternalProviderError {
    use windows::Win32::Networking::WinHttp::ERROR_WINHTTP_TIMEOUT;

    if (error.code().0 as u32 & 0xffff) == ERROR_WINHTTP_TIMEOUT {
        ExternalProviderError::Timeout
    } else {
        ExternalProviderError::Transport
    }
}

#[cfg(target_os = "windows")]
fn timeout_i32(value: u64) -> i32 {
    value.try_into().unwrap_or(i32::MAX)
}

#[cfg(target_os = "windows")]
impl ExternalTransport for HttpsTransport {
    fn send(&self, request: &TransportRequest) -> Result<TransportResponse, ExternalProviderError> {
        use std::{ffi::c_void, ptr::null};

        use windows::{
            core::PCWSTR,
            Win32::Networking::WinHttp::{
                WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryDataAvailable,
                WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest,
                WinHttpSetOption, WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                WINHTTP_DISABLE_REDIRECTS, WINHTTP_FLAG_SECURE, WINHTTP_OPTION_DISABLE_FEATURE,
                WINHTTP_OPTION_MAX_RESPONSE_HEADER_SIZE, WINHTTP_QUERY_FLAG_NUMBER,
                WINHTTP_QUERY_STATUS_CODE,
            },
        };

        let agent = wide_null("Prompt Arena");
        let session = unsafe {
            WinHttpOpen(
                PCWSTR(agent.as_ptr()),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                PCWSTR::null(),
                PCWSTR::null(),
                0,
            )
        };
        if session.is_null() {
            return Err(ExternalProviderError::Transport);
        }
        let session = WinHttpHandle(session);

        let host = wide_null(&request.endpoint.host);
        let connection =
            unsafe { WinHttpConnect(session.0, PCWSTR(host.as_ptr()), request.endpoint.port, 0) };
        if connection.is_null() {
            return Err(ExternalProviderError::Transport);
        }
        let connection = WinHttpHandle(connection);

        let method = wide_null("POST");
        let path = wide_null(&request.path);
        let http_request = unsafe {
            WinHttpOpenRequest(
                connection.0,
                PCWSTR(method.as_ptr()),
                PCWSTR(path.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                null(),
                WINHTTP_FLAG_SECURE,
            )
        };
        if http_request.is_null() {
            return Err(ExternalProviderError::Transport);
        }
        let http_request = WinHttpHandle(http_request);

        unsafe {
            WinHttpSetTimeouts(
                http_request.0,
                timeout_i32(request.connect_timeout_ms),
                timeout_i32(request.connect_timeout_ms),
                timeout_i32(request.read_timeout_ms),
                timeout_i32(request.read_timeout_ms),
            )
        }
        .map_err(map_winhttp_error)?;

        let redirect_options = WINHTTP_DISABLE_REDIRECTS.to_ne_bytes();
        unsafe {
            WinHttpSetOption(
                Some(http_request.0 as *const c_void),
                WINHTTP_OPTION_DISABLE_FEATURE,
                Some(&redirect_options),
            )
        }
        .map_err(map_winhttp_error)?;

        let max_header_options = (64_u32 * 1024).to_ne_bytes();
        unsafe {
            WinHttpSetOption(
                Some(http_request.0 as *const c_void),
                WINHTTP_OPTION_MAX_RESPONSE_HEADER_SIZE,
                Some(&max_header_options),
            )
        }
        .map_err(map_winhttp_error)?;

        let headers = wide_headers(&request.headers)?;
        let body_length = u32::try_from(request.body.len())
            .map_err(|_| ExternalProviderError::RequestTooLarge)?;
        unsafe {
            WinHttpSendRequest(
                http_request.0,
                Some(&headers.0),
                Some(request.body.as_ptr() as *const c_void),
                body_length,
                body_length,
                0,
            )
        }
        .map_err(map_winhttp_error)?;
        unsafe { WinHttpReceiveResponse(http_request.0, std::ptr::null_mut()) }
            .map_err(map_winhttp_error)?;

        let mut status = 0_u32;
        let mut status_length = std::mem::size_of::<u32>() as u32;
        let mut header_index = 0_u32;
        unsafe {
            WinHttpQueryHeaders(
                http_request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                PCWSTR::null(),
                Some((&mut status as *mut u32).cast::<c_void>()),
                &mut status_length,
                &mut header_index,
            )
        }
        .map_err(map_winhttp_error)?;
        let status = u16::try_from(status).map_err(|_| ExternalProviderError::Transport)?;

        let mut body = Vec::new();
        let mut buffer = [0_u8; 8 * 1024];
        loop {
            let mut available = 0_u32;
            unsafe { WinHttpQueryDataAvailable(http_request.0, &mut available) }
                .map_err(map_winhttp_error)?;
            if available == 0 {
                break;
            }
            if available as usize > MAX_EXTERNAL_RESPONSE_BYTES.saturating_sub(body.len()) {
                return Err(ExternalProviderError::ResponseTooLarge);
            }
            let requested = available.min(buffer.len() as u32);
            let mut read = 0_u32;
            unsafe {
                WinHttpReadData(
                    http_request.0,
                    buffer.as_mut_ptr().cast::<c_void>(),
                    requested,
                    &mut read,
                )
            }
            .map_err(map_winhttp_error)?;
            if read == 0 {
                return Err(ExternalProviderError::Transport);
            }
            let end = body
                .len()
                .checked_add(read as usize)
                .ok_or(ExternalProviderError::ResponseTooLarge)?;
            if end > MAX_EXTERNAL_RESPONSE_BYTES {
                return Err(ExternalProviderError::ResponseTooLarge);
            }
            body.extend_from_slice(&buffer[..read as usize]);
        }

        Ok(TransportResponse { status, body })
    }

    fn network_used(&self) -> bool {
        true
    }
}

#[cfg(not(target_os = "windows"))]
impl ExternalTransport for HttpsTransport {
    fn send(
        &self,
        _request: &TransportRequest,
    ) -> Result<TransportResponse, ExternalProviderError> {
        Err(ExternalProviderError::UnsupportedPlatform)
    }

    fn network_used(&self) -> bool {
        false
    }
}

fn secret_header(name: &'static str, value: &[u8]) -> TransportHeader {
    TransportHeader {
        name,
        value: SecretBytes::new(value.to_vec()),
    }
}

fn prefixed_secret_header(name: &'static str, prefix: &[u8], value: &[u8]) -> TransportHeader {
    let mut combined = SecretBytes::new(Vec::with_capacity(prefix.len() + value.len()));
    combined.0.extend_from_slice(prefix);
    combined.0.extend_from_slice(value);
    TransportHeader {
        name,
        value: combined,
    }
}

fn percent_encode_path_segment(value: &str) -> String {
    use std::fmt::Write as _;

    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn provider_request_path(
    provider_id: ExternalProviderId,
    endpoint: &ProviderEndpoint,
    model: &str,
) -> Result<String, ExternalProviderError> {
    let mut path = String::with_capacity(endpoint.path.len() + MAX_PROVIDER_MODEL_BYTES + 32);
    path.push('/');
    if !endpoint.path.is_empty() {
        path.push_str(&endpoint.path);
    }
    match provider_id {
        ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => {
            path.push_str("/chat/completions");
        }
        ExternalProviderId::Anthropic => path.push_str("/messages"),
        ExternalProviderId::Gemini => {
            path.push_str("/models/");
            path.push_str(&percent_encode_path_segment(model));
            path.push_str(":generateContent");
        }
    }
    if path.len() > MAX_PROVIDER_ENDPOINT_BYTES + (MAX_PROVIDER_MODEL_BYTES * 3) + 64 {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    Ok(path)
}

fn build_transport_request(
    provider_id: ExternalProviderId,
    record: &StoredProviderCredential,
    prompt: &str,
    max_output_tokens: u64,
) -> Result<TransportRequest, ExternalProviderError> {
    let endpoint = ProviderEndpoint::parse(&record.endpoint)?;
    let path = provider_request_path(provider_id, &endpoint, &record.model)?;
    let payload = match provider_id {
        ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => json!({
            "model": record.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_output_tokens,
        }),
        ExternalProviderId::Anthropic => json!({
            "model": record.model,
            "max_tokens": max_output_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }),
        ExternalProviderId::Gemini => json!({
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_output_tokens},
        }),
    };
    let body = serde_json::to_vec(&payload).map_err(|_| ExternalProviderError::RequestTooLarge)?;
    if body.len() > MAX_EXTERNAL_REQUEST_BYTES {
        return Err(ExternalProviderError::RequestTooLarge);
    }

    let mut headers = vec![
        secret_header("Accept", b"application/json"),
        secret_header("Content-Type", b"application/json"),
    ];
    match provider_id {
        ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => headers.push(
            prefixed_secret_header("Authorization", b"Bearer ", record.api_key.as_slice()),
        ),
        ExternalProviderId::Anthropic => {
            headers.push(secret_header("anthropic-version", b"2023-06-01"));
            headers.push(secret_header("x-api-key", record.api_key.as_slice()));
        }
        ExternalProviderId::Gemini => {
            headers.push(secret_header("x-goog-api-key", record.api_key.as_slice()));
        }
    }
    Ok(TransportRequest {
        endpoint,
        path,
        headers,
        body,
        connect_timeout_ms: record.connect_timeout_ms,
        read_timeout_ms: record.read_timeout_ms,
    })
}

struct ParsedProviderResponse {
    text: String,
    usage: ExternalUsage,
    provider_model: Option<String>,
}

fn parse_json_response(body: &[u8]) -> Result<Value, ExternalProviderError> {
    if body.len() > MAX_EXTERNAL_RESPONSE_BYTES {
        return Err(ExternalProviderError::ResponseTooLarge);
    }
    serde_json::from_slice(body).map_err(|_| ExternalProviderError::MalformedResponse)
}

fn response_object<'a>(
    value: &'a Value,
) -> Result<&'a serde_json::Map<String, Value>, ExternalProviderError> {
    value
        .as_object()
        .ok_or(ExternalProviderError::MalformedResponse)
}

fn response_text(value: &Value) -> Result<String, ExternalProviderError> {
    let text = value
        .as_str()
        .ok_or(ExternalProviderError::MalformedResponse)?;
    if text.len() > MAX_EXTERNAL_RESPONSE_BYTES {
        return Err(ExternalProviderError::ResponseTooLarge);
    }
    Ok(text.to_owned())
}

fn append_response_text(output: &mut String, value: &Value) -> Result<(), ExternalProviderError> {
    let text = response_text(value)?;
    let end = output
        .len()
        .checked_add(text.len())
        .ok_or(ExternalProviderError::ResponseTooLarge)?;
    if end > MAX_EXTERNAL_RESPONSE_BYTES {
        return Err(ExternalProviderError::ResponseTooLarge);
    }
    output.push_str(&text);
    Ok(())
}

fn optional_provider_model(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Option<String>, ExternalProviderError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => validate_model(value)
            .map(Some)
            .map_err(|_| ExternalProviderError::MalformedResponse),
        Some(_) => Err(ExternalProviderError::MalformedResponse),
    }
}

fn usage_number(value: &Value) -> Result<u64, ExternalProviderError> {
    let value = value.as_u64().ok_or(ExternalProviderError::InvalidUsage)?;
    if valid_token_count(value) {
        Ok(value)
    } else {
        Err(ExternalProviderError::InvalidUsage)
    }
}

fn parse_usage(
    root: &serde_json::Map<String, Value>,
    usage_field: &str,
    input_field: &str,
    output_field: &str,
    total_field: &str,
    total_required: bool,
) -> Result<ExternalUsage, ExternalProviderError> {
    let usage = root
        .get(usage_field)
        .ok_or(ExternalProviderError::MissingUsage)?
        .as_object()
        .ok_or(ExternalProviderError::InvalidUsage)?;
    let input_tokens = usage
        .get(input_field)
        .ok_or(ExternalProviderError::MissingUsage)
        .and_then(usage_number)?;
    let output_tokens = usage
        .get(output_field)
        .ok_or(ExternalProviderError::MissingUsage)
        .and_then(usage_number)?;
    let calculated_total = input_tokens
        .checked_add(output_tokens)
        .filter(|value| valid_token_count(*value))
        .ok_or(ExternalProviderError::InvalidUsage)?;
    let total_tokens = match usage.get(total_field) {
        Some(value) => {
            let value = usage_number(value)?;
            if value != calculated_total {
                return Err(ExternalProviderError::InvalidUsage);
            }
            value
        }
        None if total_required => return Err(ExternalProviderError::MissingUsage),
        None => calculated_total,
    };
    Ok(ExternalUsage {
        input_tokens,
        output_tokens,
        total_tokens,
    })
}

fn parse_openai_response(body: &[u8]) -> Result<ParsedProviderResponse, ExternalProviderError> {
    let value = parse_json_response(body)?;
    let root = response_object(&value)?;
    let choices = root
        .get("choices")
        .and_then(Value::as_array)
        .filter(|choices| !choices.is_empty())
        .ok_or(ExternalProviderError::MalformedResponse)?;
    let choice = response_object(
        choices
            .first()
            .ok_or(ExternalProviderError::MalformedResponse)?,
    )?;
    let message = response_object(
        choice
            .get("message")
            .ok_or(ExternalProviderError::MalformedResponse)?,
    )?;
    let text = response_text(
        message
            .get("content")
            .ok_or(ExternalProviderError::MalformedResponse)?,
    )?;
    Ok(ParsedProviderResponse {
        text,
        usage: parse_usage(
            root,
            "usage",
            "prompt_tokens",
            "completion_tokens",
            "total_tokens",
            true,
        )?,
        provider_model: optional_provider_model(root, "model")?,
    })
}

fn parse_anthropic_response(body: &[u8]) -> Result<ParsedProviderResponse, ExternalProviderError> {
    let value = parse_json_response(body)?;
    let root = response_object(&value)?;
    let content = root
        .get("content")
        .and_then(Value::as_array)
        .filter(|content| !content.is_empty())
        .ok_or(ExternalProviderError::MalformedResponse)?;
    let mut text = String::new();
    let mut found_text = false;
    for block in content {
        let block = response_object(block)?;
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                append_response_text(
                    &mut text,
                    block
                        .get("text")
                        .ok_or(ExternalProviderError::MalformedResponse)?,
                )?;
                found_text = true;
            }
            Some(_) => {}
            None => return Err(ExternalProviderError::MalformedResponse),
        }
    }
    if !found_text {
        return Err(ExternalProviderError::MalformedResponse);
    }
    Ok(ParsedProviderResponse {
        text,
        usage: parse_usage(
            root,
            "usage",
            "input_tokens",
            "output_tokens",
            "total_tokens",
            false,
        )?,
        provider_model: optional_provider_model(root, "model")?,
    })
}

fn parse_gemini_response(body: &[u8]) -> Result<ParsedProviderResponse, ExternalProviderError> {
    let value = parse_json_response(body)?;
    let root = response_object(&value)?;
    let candidates = root
        .get("candidates")
        .and_then(Value::as_array)
        .filter(|candidates| !candidates.is_empty())
        .ok_or(ExternalProviderError::MalformedResponse)?;
    let candidate = response_object(
        candidates
            .first()
            .ok_or(ExternalProviderError::MalformedResponse)?,
    )?;
    let content = response_object(
        candidate
            .get("content")
            .ok_or(ExternalProviderError::MalformedResponse)?,
    )?;
    let parts = content
        .get("parts")
        .and_then(Value::as_array)
        .filter(|parts| !parts.is_empty())
        .ok_or(ExternalProviderError::MalformedResponse)?;
    let mut text = String::new();
    for part in parts {
        let part = response_object(part)?;
        if let Some(value) = part.get("text") {
            append_response_text(&mut text, value)?;
        }
    }
    if text.is_empty() {
        return Err(ExternalProviderError::MalformedResponse);
    }
    Ok(ParsedProviderResponse {
        text,
        usage: parse_usage(
            root,
            "usageMetadata",
            "promptTokenCount",
            "candidatesTokenCount",
            "totalTokenCount",
            false,
        )?,
        provider_model: optional_provider_model(root, "modelVersion")?,
    })
}

fn parse_provider_response(
    provider_id: ExternalProviderId,
    body: &[u8],
) -> Result<ParsedProviderResponse, ExternalProviderError> {
    match provider_id {
        ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => {
            parse_openai_response(body)
        }
        ExternalProviderId::Anthropic => parse_anthropic_response(body),
        ExternalProviderId::Gemini => parse_gemini_response(body),
    }
}

fn parse_provider_authority(authority: &str) -> Result<(String, u16), ExternalProviderError> {
    if authority.is_empty() {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (host, remainder) = rest
            .split_once(']')
            .ok_or(ExternalProviderError::InvalidConfiguration)?;
        let port = if remainder.is_empty() {
            443
        } else {
            remainder
                .strip_prefix(':')
                .ok_or(ExternalProviderError::InvalidConfiguration)?
                .parse::<u16>()
                .map_err(|_| ExternalProviderError::InvalidConfiguration)?
        };
        (host.to_owned(), port)
    } else if authority.matches(':').count() > 1 {
        return Err(ExternalProviderError::InvalidConfiguration);
    } else if let Some((host, port)) = authority.rsplit_once(':') {
        (
            host.to_owned(),
            port.parse::<u16>()
                .map_err(|_| ExternalProviderError::InvalidConfiguration)?,
        )
    } else {
        (authority.to_owned(), 443)
    };
    if port == 0 || host.is_empty() || host.len() > 253 || !valid_provider_host(&host) {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    Ok((host.to_ascii_lowercase(), port))
}

fn valid_provider_host(host: &str) -> bool {
    if host.contains(':') {
        return host.parse::<std::net::Ipv6Addr>().is_ok();
    }
    if host.parse::<std::net::Ipv4Addr>().is_ok() {
        return true;
    }
    if host.starts_with('.') || host.ends_with('.') || host.contains("..") {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn normalize_provider_path(path: &str) -> Result<String, ExternalProviderError> {
    if path.len() > MAX_PROVIDER_ENDPOINT_BYTES
        || path.split('/').any(|part| part == "." || part == "..")
        || path.as_bytes().windows(1).any(|window| window == [b'\\'])
    {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    Ok(path.trim_matches('/').to_owned())
}

fn provider_target(provider_id: ExternalProviderId) -> String {
    format!("Prompt Arena/{BYOK_ACCOUNT}/byok/{}", provider_id.as_str())
}

fn validate_model(model: &str) -> Result<String, ExternalProviderError> {
    let model = model.trim();
    if model.is_empty()
        || model.len() > MAX_PROVIDER_MODEL_BYTES
        || model
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    Ok(model.to_owned())
}

fn validate_api_key(value: &[u8]) -> Result<(), ExternalProviderError> {
    if value.is_empty()
        || value.len() > MAX_PROVIDER_API_KEY_BYTES
        || value.iter().any(|byte| !matches!(byte, 0x21..=0x7e))
    {
        return Err(ExternalProviderError::InvalidCredential);
    }
    Ok(())
}

fn validate_timeout(value: Option<u64>, default: u64) -> Result<u64, ExternalProviderError> {
    let value = value.unwrap_or(default);
    if !(1..=MAX_EXTERNAL_TIMEOUT_MS).contains(&value) {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    Ok(value)
}

fn validate_cost_policy(policy: &CostPolicy) -> Result<(), ExternalProviderError> {
    for value in [policy.confirmation_threshold_usd, policy.ceiling_usd]
        .into_iter()
        .flatten()
    {
        if !value.is_finite() || !(0.0..=MAX_EXTERNAL_BUDGET_USD).contains(&value) {
            return Err(ExternalProviderError::InvalidConfiguration);
        }
    }
    if let (Some(threshold), Some(ceiling)) =
        (policy.confirmation_threshold_usd, policy.ceiling_usd)
    {
        if threshold > ceiling {
            return Err(ExternalProviderError::InvalidConfiguration);
        }
    }
    Ok(())
}

fn validate_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let parse = |slice: &[u8]| {
        slice.iter().all(u8::is_ascii_digit).then(|| {
            slice
                .iter()
                .fold(0_u32, |number, digit| number * 10 + u32::from(digit - b'0'))
        })
    };
    let Some(year) = parse(&bytes[..4]) else {
        return false;
    };
    let Some(month) = parse(&bytes[5..7]) else {
        return false;
    };
    let Some(day) = parse(&bytes[8..]) else {
        return false;
    };
    if !(1..=12).contains(&month) || day == 0 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    day <= days
}

fn valid_token_count(value: u64) -> bool {
    value <= MAX_EXTERNAL_TOKEN_COUNT
}

pub fn estimate_external_cost(
    snapshot: Option<&PriceSnapshot>,
    provider_id: ExternalProviderId,
    model_id: &str,
    input_tokens: u64,
    output_tokens: u64,
) -> Result<CostBreakdown, CostFailure> {
    if !valid_token_count(input_tokens) || !valid_token_count(output_tokens) {
        return Err(CostFailure::InvalidUsage);
    }
    let Some(snapshot) = snapshot else {
        return Err(CostFailure::MissingPrice);
    };
    if snapshot.provider_id != provider_id
        || validate_model(&snapshot.model_id).is_err()
        || snapshot.model_id != model_id
        || snapshot.currency != "USD"
        || !validate_date(&snapshot.captured_on)
    {
        return Err(CostFailure::InvalidPrice);
    }
    let (Some(input_rate), Some(output_rate)) = (
        snapshot.input_usd_per_million_tokens,
        snapshot.output_usd_per_million_tokens,
    ) else {
        return Err(CostFailure::MissingPrice);
    };
    if ![input_rate, output_rate].into_iter().all(|value| {
        value.is_finite() && (0.0..=MAX_EXTERNAL_PRICE_USD_PER_MILLION_TOKENS).contains(&value)
    }) {
        return Err(CostFailure::InvalidPrice);
    }
    let input_cost_usd = (input_tokens as f64 / TOKENS_PER_MILLION) * input_rate;
    let output_cost_usd = (output_tokens as f64 / TOKENS_PER_MILLION) * output_rate;
    let total_cost_usd = input_cost_usd + output_cost_usd;
    if ![input_cost_usd, output_cost_usd, total_cost_usd]
        .into_iter()
        .all(f64::is_finite)
    {
        return Err(CostFailure::InvalidPrice);
    }
    Ok(CostBreakdown {
        input_tokens,
        output_tokens,
        input_cost_usd: round_usd(input_cost_usd),
        output_cost_usd: round_usd(output_cost_usd),
        total_cost_usd: round_usd(total_cost_usd),
    })
}

pub fn decide_external_cost(
    estimate: &CostBreakdown,
    policy: &CostPolicy,
    confirmed: bool,
) -> Result<CostDecision, ExternalProviderError> {
    validate_cost_policy(policy)?;
    if !valid_token_count(estimate.input_tokens) || !valid_token_count(estimate.output_tokens) {
        return Err(ExternalProviderError::InvalidUsage);
    }
    if ![
        estimate.input_cost_usd,
        estimate.output_cost_usd,
        estimate.total_cost_usd,
    ]
    .into_iter()
    .all(|value| value.is_finite() && value >= 0.0)
    {
        return Err(ExternalProviderError::InvalidPrice);
    }
    let component_total = estimate.input_cost_usd + estimate.output_cost_usd;
    if !component_total.is_finite()
        || (estimate.total_cost_usd - component_total).abs() > COST_ROUNDING_TOLERANCE_USD
    {
        return Err(ExternalProviderError::InvalidPrice);
    }
    let total_cost_usd = estimate.total_cost_usd.max(component_total);
    if policy
        .ceiling_usd
        .is_some_and(|ceiling| total_cost_usd > ceiling)
    {
        return Err(ExternalProviderError::BudgetCeilingExceeded);
    }
    if policy
        .confirmation_threshold_usd
        .is_some_and(|threshold| total_cost_usd >= threshold)
    {
        if !confirmed {
            return Err(ExternalProviderError::ConfirmationRequired);
        }
        return Ok(CostDecision::ConfirmationRequired);
    }
    Ok(CostDecision::Allow)
}

fn round_usd(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

#[derive(Debug)]
struct StoredProviderCredential {
    endpoint: String,
    model: String,
    connect_timeout_ms: u64,
    read_timeout_ms: u64,
    cost_policy: CostPolicy,
    api_key: SecretBytes,
}

fn encode_stored_credential(
    endpoint: &str,
    model: &str,
    connect_timeout_ms: u64,
    read_timeout_ms: u64,
    cost_policy: &CostPolicy,
    api_key: &[u8],
) -> Result<Vec<u8>, ExternalProviderError> {
    validate_api_key(api_key)?;
    validate_cost_policy(cost_policy)?;
    let endpoint = ProviderEndpoint::parse(endpoint)?;
    let model = validate_model(model)?;
    if connect_timeout_ms == 0
        || connect_timeout_ms > MAX_EXTERNAL_TIMEOUT_MS
        || read_timeout_ms == 0
        || read_timeout_ms > MAX_EXTERNAL_TIMEOUT_MS
    {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    let endpoint_bytes = endpoint.display().as_bytes();
    let model_bytes = model.as_bytes();
    if endpoint_bytes.len() > u16::MAX as usize
        || model_bytes.len() > u16::MAX as usize
        || api_key.len() > u16::MAX as usize
    {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    let mut encoded = SecretBytes::new(Vec::with_capacity(
        1 + 2
            + endpoint_bytes.len()
            + 2
            + model_bytes.len()
            + 8
            + 8
            + 1
            + 8
            + 1
            + 8
            + 2
            + api_key.len(),
    ));
    encoded.0.push(STORED_CREDENTIAL_VERSION);
    push_bytes(&mut encoded.0, endpoint_bytes);
    push_bytes(&mut encoded.0, model_bytes);
    encoded
        .0
        .extend_from_slice(&connect_timeout_ms.to_le_bytes());
    encoded.0.extend_from_slice(&read_timeout_ms.to_le_bytes());
    push_optional_f64(&mut encoded.0, cost_policy.confirmation_threshold_usd);
    push_optional_f64(&mut encoded.0, cost_policy.ceiling_usd);
    push_bytes(&mut encoded.0, api_key);
    if encoded.0.len() > CREDENTIAL_BLOB_MAX_BYTES {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    Ok(std::mem::take(&mut encoded.0))
}

fn decode_stored_credential(
    value: &[u8],
) -> Result<StoredProviderCredential, ExternalProviderError> {
    if value.len() > CREDENTIAL_BLOB_MAX_BYTES {
        return Err(ExternalProviderError::SecureStorageError);
    }
    let mut cursor = 0;
    if take_byte(value, &mut cursor)? != STORED_CREDENTIAL_VERSION {
        return Err(ExternalProviderError::SecureStorageError);
    }
    let endpoint = String::from_utf8(take_bytes(value, &mut cursor)?.to_vec())
        .map_err(|_| ExternalProviderError::SecureStorageError)?;
    let model = String::from_utf8(take_bytes(value, &mut cursor)?.to_vec())
        .map_err(|_| ExternalProviderError::SecureStorageError)?;
    let connect_timeout_ms = take_u64(value, &mut cursor)?;
    let read_timeout_ms = take_u64(value, &mut cursor)?;
    let cost_policy = CostPolicy {
        confirmation_threshold_usd: take_optional_f64(value, &mut cursor)?,
        ceiling_usd: take_optional_f64(value, &mut cursor)?,
    };
    let api_key = SecretBytes::new(take_bytes(value, &mut cursor)?.to_vec());
    if cursor != value.len() {
        return Err(ExternalProviderError::SecureStorageError);
    }
    let endpoint = ProviderEndpoint::parse(&endpoint)?.display().to_owned();
    let model = validate_model(&model)?;
    validate_api_key(api_key.as_slice())?;
    if !(1..=MAX_EXTERNAL_TIMEOUT_MS).contains(&connect_timeout_ms)
        || !(1..=MAX_EXTERNAL_TIMEOUT_MS).contains(&read_timeout_ms)
    {
        return Err(ExternalProviderError::SecureStorageError);
    }
    validate_cost_policy(&cost_policy)?;
    Ok(StoredProviderCredential {
        endpoint,
        model,
        connect_timeout_ms,
        read_timeout_ms,
        cost_policy,
        api_key,
    })
}

fn push_bytes(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&(value.len() as u16).to_le_bytes());
    output.extend_from_slice(value);
}

fn push_optional_f64(output: &mut Vec<u8>, value: Option<f64>) {
    output.push(u8::from(value.is_some()));
    if let Some(value) = value {
        output.extend_from_slice(&value.to_le_bytes());
    }
}

fn take_byte(value: &[u8], cursor: &mut usize) -> Result<u8, ExternalProviderError> {
    let byte = *value
        .get(*cursor)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    *cursor += 1;
    Ok(byte)
}

fn take_bytes<'a>(value: &'a [u8], cursor: &mut usize) -> Result<&'a [u8], ExternalProviderError> {
    let length_start = *cursor;
    let length_end = length_start
        .checked_add(2)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    let length_bytes = value
        .get(length_start..length_end)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    let length = u16::from_le_bytes([length_bytes[0], length_bytes[1]]) as usize;
    let value_start = length_end;
    let value_end = value_start
        .checked_add(length)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    let result = value
        .get(value_start..value_end)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    *cursor = value_end;
    Ok(result)
}

fn take_u64(value: &[u8], cursor: &mut usize) -> Result<u64, ExternalProviderError> {
    let end = cursor
        .checked_add(8)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    let bytes = value
        .get(*cursor..end)
        .ok_or(ExternalProviderError::SecureStorageError)?;
    *cursor = end;
    Ok(u64::from_le_bytes(bytes.try_into().expect("eight bytes")))
}

fn take_optional_f64(
    value: &[u8],
    cursor: &mut usize,
) -> Result<Option<f64>, ExternalProviderError> {
    if take_byte(value, cursor)? == 0 {
        return Ok(None);
    }
    let result = f64::from_le_bytes(take_u64(value, cursor)?.to_le_bytes());
    Ok(Some(result))
}

fn storage_error(error: SecureStorageError) -> ExternalProviderError {
    match error {
        SecureStorageError::UnsupportedPlatform => ExternalProviderError::UnsupportedPlatform,
        SecureStorageError::Unavailable => ExternalProviderError::SecureStorageError,
    }
}

fn metadata_from_record(
    provider_id: ExternalProviderId,
    record: Option<StoredProviderCredential>,
) -> ExternalProviderMetadata {
    match record {
        Some(record) => ExternalProviderMetadata {
            provider_id,
            label: provider_id.label(),
            kind: provider_id.kind(),
            default_endpoint: provider_id.default_endpoint(),
            configured: true,
            endpoint: Some(record.endpoint),
            model: Some(record.model),
            credential_source: CredentialSource::OsSecureStorage,
            storage_status: SecureStorageStatus::Available,
            identity_confidence: IdentityConfidence::Unverified,
            connect_timeout_ms: Some(record.connect_timeout_ms),
            read_timeout_ms: Some(record.read_timeout_ms),
            confirmation_threshold_usd: record.cost_policy.confirmation_threshold_usd,
            ceiling_usd: record.cost_policy.ceiling_usd,
        },
        None => ExternalProviderMetadata {
            provider_id,
            label: provider_id.label(),
            kind: provider_id.kind(),
            default_endpoint: provider_id.default_endpoint(),
            configured: false,
            endpoint: None,
            model: None,
            credential_source: CredentialSource::NotConfigured,
            storage_status: SecureStorageStatus::Available,
            identity_confidence: IdentityConfidence::Unverified,
            connect_timeout_ms: None,
            read_timeout_ms: None,
            confirmation_threshold_usd: None,
            ceiling_usd: None,
        },
    }
}

fn unavailable_metadata(
    provider_id: ExternalProviderId,
    status: SecureStorageStatus,
) -> ExternalProviderMetadata {
    ExternalProviderMetadata {
        provider_id,
        label: provider_id.label(),
        kind: provider_id.kind(),
        default_endpoint: provider_id.default_endpoint(),
        configured: false,
        endpoint: None,
        model: None,
        credential_source: CredentialSource::Unavailable,
        storage_status: status,
        identity_confidence: IdentityConfidence::Unverified,
        connect_timeout_ms: None,
        read_timeout_ms: None,
        confirmation_threshold_usd: None,
        ceiling_usd: None,
    }
}

fn read_record<B: CredentialBackend>(
    backend: &B,
    provider_id: ExternalProviderId,
) -> Result<Option<StoredProviderCredential>, ExternalProviderError> {
    let target = provider_target(provider_id);
    backend
        .read(&target)
        .map_err(storage_error)?
        .map(|value| {
            let value = SecretBytes::new(value);
            decode_stored_credential(value.as_slice())
        })
        .transpose()
}

fn map_cost_failure(error: CostFailure) -> ExternalProviderError {
    match error {
        CostFailure::MissingPrice => ExternalProviderError::MissingPrice,
        CostFailure::InvalidPrice => ExternalProviderError::InvalidPrice,
        CostFailure::InvalidUsage => ExternalProviderError::InvalidUsage,
    }
}

// No provider tokenizer is trusted for preflight, so each UTF-8 byte is a conservative token bound.
fn estimate_prompt_tokens(prompt: &str) -> Result<u64, ExternalProviderError> {
    if prompt.len() > MAX_EXTERNAL_PROMPT_BYTES {
        return Err(ExternalProviderError::RequestTooLarge);
    }
    u64::try_from(prompt.len()).map_err(|_| ExternalProviderError::RequestTooLarge)
}

fn execute_external_generation_with_transport<B: CredentialBackend, T: ExternalTransport>(
    backend: &B,
    transport: &T,
    request: ExternalGenerationRequest,
) -> Result<ExternalGenerationResult, ExternalProviderError> {
    if !request.network_consent {
        return Err(ExternalProviderError::NetworkConsentRequired);
    }
    if !(1..=MAX_EXTERNAL_TOKEN_COUNT).contains(&request.max_output_tokens) {
        return Err(ExternalProviderError::InvalidConfiguration);
    }
    let input_estimate = estimate_prompt_tokens(&request.prompt)?;
    let provider_id = request.provider_id;
    let record = read_record(backend, provider_id)?.ok_or(ExternalProviderError::NotConfigured)?;
    let price_snapshot = request
        .price_snapshot
        .as_ref()
        .ok_or(ExternalProviderError::MissingPrice)?;
    let estimated = estimate_external_cost(
        Some(price_snapshot),
        provider_id,
        &record.model,
        input_estimate,
        request.max_output_tokens,
    )
    .map_err(map_cost_failure)?;
    let preflight_decision =
        decide_external_cost(&estimated, &record.cost_policy, request.cost_confirmed)?;

    let transport_request = build_transport_request(
        provider_id,
        &record,
        &request.prompt,
        request.max_output_tokens,
    )?;
    let response = transport.send(&transport_request)?;
    if response.body.len() > MAX_EXTERNAL_RESPONSE_BYTES {
        return Err(ExternalProviderError::ResponseTooLarge);
    }
    if !(200..=299).contains(&response.status) {
        return Err(match response.status {
            401 | 403 => ExternalProviderError::Authentication,
            status => ExternalProviderError::Remote { status },
        });
    }
    let parsed = parse_provider_response(provider_id, &response.body)?;
    let actual = estimate_external_cost(
        Some(price_snapshot),
        provider_id,
        &record.model,
        parsed.usage.input_tokens,
        parsed.usage.output_tokens,
    )
    .map_err(map_cost_failure)?;
    let final_decision =
        decide_external_cost(&actual, &record.cost_policy, request.cost_confirmed)?;
    let identity_confidence = if parsed.provider_model.is_some() {
        IdentityConfidence::ProviderReported
    } else {
        IdentityConfidence::Unverified
    };
    Ok(ExternalGenerationResult {
        provider_id,
        requested_model: record.model.clone(),
        provider_model: parsed
            .provider_model
            .unwrap_or_else(|| record.model.clone()),
        identity_confidence,
        text: parsed.text,
        usage: parsed.usage,
        network_used: transport.network_used(),
        cost: ExternalCostEvidence {
            price_snapshot: price_snapshot.clone(),
            estimated,
            actual,
            preflight_decision,
            final_decision,
        },
    })
}

pub fn execute_external_generation(
    request: ExternalGenerationRequest,
) -> Result<ExternalGenerationResult, ExternalProviderError> {
    execute_external_generation_with_transport(&OsCredentialBackend, &HttpsTransport, request)
}

pub fn list_external_providers<B: CredentialBackend>(backend: &B) -> Vec<ExternalProviderMetadata> {
    ExternalProviderId::ALL
        .into_iter()
        .map(|provider_id| match read_record(backend, provider_id) {
            Ok(record) => metadata_from_record(provider_id, record),
            Err(ExternalProviderError::UnsupportedPlatform) => {
                unavailable_metadata(provider_id, SecureStorageStatus::Unsupported)
            }
            Err(_) => unavailable_metadata(provider_id, SecureStorageStatus::Error),
        })
        .collect()
}

pub fn get_external_provider<B: CredentialBackend>(
    backend: &B,
    provider_id: ExternalProviderId,
) -> ExternalProviderMetadata {
    match read_record(backend, provider_id) {
        Ok(record) => metadata_from_record(provider_id, record),
        Err(ExternalProviderError::UnsupportedPlatform) => {
            unavailable_metadata(provider_id, SecureStorageStatus::Unsupported)
        }
        Err(_) => unavailable_metadata(provider_id, SecureStorageStatus::Error),
    }
}

pub fn configure_external_provider<B: CredentialBackend>(
    backend: &B,
    request: ConfigureProviderRequest,
) -> Result<ExternalProviderMetadata, ExternalProviderError> {
    let endpoint = ProviderEndpoint::parse(&request.endpoint)?;
    let model = validate_model(&request.model)?;
    validate_api_key(request.api_key.as_bytes())?;
    let connect_timeout_ms = validate_timeout(
        request.connect_timeout_ms,
        DEFAULT_EXTERNAL_CONNECT_TIMEOUT_MS,
    )?;
    let read_timeout_ms =
        validate_timeout(request.read_timeout_ms, DEFAULT_EXTERNAL_READ_TIMEOUT_MS)?;
    let cost_policy = request.cost_policy.unwrap_or_default();
    let encoded = encode_stored_credential(
        endpoint.display(),
        &model,
        connect_timeout_ms,
        read_timeout_ms,
        &cost_policy,
        request.api_key.as_bytes(),
    )?;
    let encoded = SecretBytes::new(encoded);
    backend
        .write(&provider_target(request.provider_id), encoded.as_slice())
        .map_err(storage_error)?;
    Ok(metadata_from_record(
        request.provider_id,
        Some(StoredProviderCredential {
            endpoint: endpoint.display().to_owned(),
            model,
            connect_timeout_ms,
            read_timeout_ms,
            cost_policy,
            api_key: SecretBytes::new(Vec::new()),
        }),
    ))
}

pub fn update_external_cost_policy<B: CredentialBackend>(
    backend: &B,
    request: UpdateProviderCostPolicyRequest,
) -> Result<ExternalProviderMetadata, ExternalProviderError> {
    let record =
        read_record(backend, request.provider_id)?.ok_or(ExternalProviderError::NotConfigured)?;
    validate_cost_policy(&request.cost_policy)?;
    let encoded = encode_stored_credential(
        &record.endpoint,
        &record.model,
        record.connect_timeout_ms,
        record.read_timeout_ms,
        &request.cost_policy,
        record.api_key.as_slice(),
    )?;
    let encoded = SecretBytes::new(encoded);
    backend
        .write(&provider_target(request.provider_id), encoded.as_slice())
        .map_err(storage_error)?;
    Ok(metadata_from_record(
        request.provider_id,
        Some(StoredProviderCredential {
            endpoint: record.endpoint,
            model: record.model,
            connect_timeout_ms: record.connect_timeout_ms,
            read_timeout_ms: record.read_timeout_ms,
            cost_policy: request.cost_policy,
            api_key: SecretBytes::new(Vec::new()),
        }),
    ))
}

pub fn remove_external_provider<B: CredentialBackend>(
    backend: &B,
    provider_id: ExternalProviderId,
) -> Result<bool, ExternalProviderError> {
    backend
        .delete(&provider_target(provider_id))
        .map_err(storage_error)
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, sync::Mutex};

    use super::*;

    const TEST_CREDENTIAL_MARKER: &str = "fixture-credential-marker";

    #[derive(Default)]
    struct MemoryCredentialBackend {
        values: Mutex<BTreeMap<String, Vec<u8>>>,
    }

    impl MemoryCredentialBackend {
        fn stored(&self, target: &str) -> Option<Vec<u8>> {
            self.values
                .lock()
                .expect("memory credential backend lock")
                .get(target)
                .cloned()
        }
    }

    impl CredentialBackend for MemoryCredentialBackend {
        fn write(&self, target: &str, value: &[u8]) -> Result<(), SecureStorageError> {
            self.values
                .lock()
                .expect("memory credential backend lock")
                .insert(target.to_owned(), value.to_vec());
            Ok(())
        }

        fn read(&self, target: &str) -> Result<Option<Vec<u8>>, SecureStorageError> {
            Ok(self.stored(target))
        }

        fn delete(&self, target: &str) -> Result<bool, SecureStorageError> {
            Ok(self
                .values
                .lock()
                .expect("memory credential backend lock")
                .remove(target)
                .is_some())
        }
    }

    struct MockRequestEvidence {
        path: String,
        body: Vec<u8>,
        header_names: Vec<&'static str>,
    }

    struct MockTransport {
        responses: Mutex<Vec<TransportResponse>>,
        requests: Mutex<Vec<MockRequestEvidence>>,
    }

    impl MockTransport {
        fn new(body: Vec<u8>) -> Self {
            Self {
                responses: Mutex::new(vec![TransportResponse { status: 200, body }]),
                requests: Mutex::new(Vec::new()),
            }
        }

        fn request_count(&self) -> usize {
            self.requests
                .lock()
                .expect("mock transport requests lock")
                .len()
        }

        fn first_request(&self) -> MockRequestEvidence {
            let requests = self.requests.lock().expect("mock transport requests lock");
            let request = requests.first().expect("mock transport request");
            MockRequestEvidence {
                path: request.path.clone(),
                body: request.body.clone(),
                header_names: request.header_names.clone(),
            }
        }
    }

    impl ExternalTransport for MockTransport {
        fn send(
            &self,
            request: &TransportRequest,
        ) -> Result<TransportResponse, ExternalProviderError> {
            self.requests
                .lock()
                .expect("mock transport requests lock")
                .push(MockRequestEvidence {
                    path: request.path.clone(),
                    body: request.body.clone(),
                    header_names: request.headers.iter().map(|header| header.name).collect(),
                });
            self.responses
                .lock()
                .expect("mock transport responses lock")
                .pop()
                .ok_or(ExternalProviderError::Transport)
        }

        fn network_used(&self) -> bool {
            false
        }
    }

    #[derive(Debug, Default)]
    struct UnsupportedCredentialBackend;

    impl CredentialBackend for UnsupportedCredentialBackend {
        fn write(&self, _target: &str, _value: &[u8]) -> Result<(), SecureStorageError> {
            Err(SecureStorageError::UnsupportedPlatform)
        }

        fn read(&self, _target: &str) -> Result<Option<Vec<u8>>, SecureStorageError> {
            Err(SecureStorageError::UnsupportedPlatform)
        }

        fn delete(&self, _target: &str) -> Result<bool, SecureStorageError> {
            Err(SecureStorageError::UnsupportedPlatform)
        }
    }

    fn configure_request(
        endpoint: &str,
        model: &str,
        cost_policy: Option<CostPolicy>,
    ) -> ConfigureProviderRequest {
        configure_request_for(ExternalProviderId::OpenAi, endpoint, model, cost_policy)
    }

    fn configure_request_for(
        provider_id: ExternalProviderId,
        endpoint: &str,
        model: &str,
        cost_policy: Option<CostPolicy>,
    ) -> ConfigureProviderRequest {
        ConfigureProviderRequest {
            provider_id,
            endpoint: endpoint.to_owned(),
            model: model.to_owned(),
            api_key: SecretInput(TEST_CREDENTIAL_MARKER.as_bytes().to_vec()),
            connect_timeout_ms: None,
            read_timeout_ms: None,
            cost_policy,
        }
    }

    fn configured_backend(
        provider_id: ExternalProviderId,
        cost_policy: Option<CostPolicy>,
    ) -> MemoryCredentialBackend {
        let backend = MemoryCredentialBackend::default();
        configure_external_provider(
            &backend,
            configure_request_for(
                provider_id,
                "https://api.example.com/v1",
                "model-example",
                cost_policy,
            ),
        )
        .expect("provider configures");
        backend
    }

    fn price_snapshot(provider_id: ExternalProviderId, model_id: &str) -> PriceSnapshot {
        PriceSnapshot {
            provider_id,
            model_id: model_id.to_owned(),
            captured_on: "2026-08-20".to_owned(),
            currency: "USD".to_owned(),
            input_usd_per_million_tokens: Some(2.0),
            output_usd_per_million_tokens: Some(4.0),
        }
    }

    fn generation_request(
        provider_id: ExternalProviderId,
        snapshot: Option<PriceSnapshot>,
        network_consent: bool,
        cost_confirmed: bool,
    ) -> ExternalGenerationRequest {
        ExternalGenerationRequest {
            provider_id,
            prompt: "hello".to_owned(),
            max_output_tokens: 4,
            network_consent,
            cost_confirmed,
            price_snapshot: snapshot,
        }
    }

    fn success_response(provider_id: ExternalProviderId) -> Vec<u8> {
        let response = match provider_id {
            ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => {
                serde_json::json!({
                    "choices": [{"message": {"content": "provider text"}}],
                    "model": "served-model",
                    "usage": {
                        "prompt_tokens": 2,
                        "completion_tokens": 3,
                        "total_tokens": 5
                    }
                })
            }
            ExternalProviderId::Anthropic => serde_json::json!({
                "content": [{"type": "text", "text": "provider text"}],
                "model": "served-model",
                "usage": {"input_tokens": 2, "output_tokens": 3}
            }),
            ExternalProviderId::Gemini => serde_json::json!({
                "candidates": [{"content": {"parts": [{"text": "provider text"}]}}],
                "modelVersion": "served-model",
                "usageMetadata": {
                    "promptTokenCount": 2,
                    "candidatesTokenCount": 3,
                    "totalTokenCount": 5
                }
            }),
        };
        serde_json::to_vec(&response).expect("response serializes")
    }

    #[test]
    fn configuration_validates_normalizes_and_redacts_credentials() {
        let backend = MemoryCredentialBackend::default();
        let request = configure_request(
            "HTTPS://API.Example.COM:443/v1/",
            " model-example ",
            Some(CostPolicy {
                confirmation_threshold_usd: Some(4.0),
                ceiling_usd: Some(10.0),
            }),
        );
        let debug = format!("{request:?}");
        assert!(debug.contains("SecretInput(REDACTED)"));
        assert!(!debug.contains(TEST_CREDENTIAL_MARKER));

        let metadata = configure_external_provider(&backend, request).expect("provider configures");
        assert!(metadata.configured);
        assert_eq!(
            metadata.endpoint.as_deref(),
            Some("https://api.example.com/v1")
        );
        assert_eq!(metadata.model.as_deref(), Some("model-example"));
        assert_eq!(
            metadata.connect_timeout_ms,
            Some(DEFAULT_EXTERNAL_CONNECT_TIMEOUT_MS)
        );
        assert_eq!(
            metadata.read_timeout_ms,
            Some(DEFAULT_EXTERNAL_READ_TIMEOUT_MS)
        );
        assert_eq!(metadata.confirmation_threshold_usd, Some(4.0));
        assert_eq!(metadata.ceiling_usd, Some(10.0));

        let serialized = serde_json::to_string(&metadata).expect("metadata serializes");
        assert!(!serialized.contains("apiKey"));
        assert!(!serialized.contains(TEST_CREDENTIAL_MARKER));
        let encoded = backend
            .stored(&provider_target(ExternalProviderId::OpenAi))
            .expect("credential blob is stored");
        let decoded = decode_stored_credential(&encoded).expect("credential blob decodes");
        assert!(!format!("{decoded:?}").contains(TEST_CREDENTIAL_MARKER));

        let updated = update_external_cost_policy(
            &backend,
            UpdateProviderCostPolicyRequest {
                provider_id: ExternalProviderId::OpenAi,
                cost_policy: CostPolicy {
                    confirmation_threshold_usd: Some(6.0),
                    ceiling_usd: Some(12.0),
                },
            },
        )
        .expect("cost policy updates");
        assert_eq!(updated.confirmation_threshold_usd, Some(6.0));
        assert_eq!(updated.ceiling_usd, Some(12.0));
        assert!(
            remove_external_provider(&backend, ExternalProviderId::OpenAi)
                .expect("provider removes")
        );
        assert!(
            !remove_external_provider(&backend, ExternalProviderId::OpenAi)
                .expect("missing provider removes cleanly")
        );
    }

    #[test]
    fn invalid_configuration_and_credentials_are_rejected() {
        let backend = MemoryCredentialBackend::default();
        assert_eq!(
            configure_external_provider(
                &backend,
                configure_request("http://example.com", "model", None)
            )
            .unwrap_err(),
            ExternalProviderError::InvalidConfiguration
        );
        assert_eq!(
            configure_external_provider(
                &backend,
                configure_request("https://example.com", "model id", None)
            )
            .unwrap_err(),
            ExternalProviderError::InvalidConfiguration
        );
        let mut empty_credential = configure_request("https://example.com", "model", None);
        empty_credential.api_key = SecretInput(Vec::new());
        assert_eq!(
            configure_external_provider(&backend, empty_credential).unwrap_err(),
            ExternalProviderError::InvalidCredential
        );
        assert_eq!(
            configure_external_provider(
                &backend,
                configure_request(
                    "https://example.com",
                    "model",
                    Some(CostPolicy {
                        confirmation_threshold_usd: Some(11.0),
                        ceiling_usd: Some(10.0),
                    }),
                ),
            )
            .unwrap_err(),
            ExternalProviderError::InvalidConfiguration
        );
    }

    #[test]
    fn cost_estimation_and_policy_fail_closed() {
        let snapshot = PriceSnapshot {
            provider_id: ExternalProviderId::OpenAi,
            model_id: "model-example".to_owned(),
            captured_on: "2026-08-20".to_owned(),
            currency: "USD".to_owned(),
            input_usd_per_million_tokens: Some(2.0),
            output_usd_per_million_tokens: Some(4.0),
        };
        let estimate = estimate_external_cost(
            Some(&snapshot),
            ExternalProviderId::OpenAi,
            "model-example",
            1_500_000,
            500_000,
        )
        .expect("cost estimates");
        assert_eq!(estimate.input_cost_usd, 3.0);
        assert_eq!(estimate.output_cost_usd, 2.0);
        assert_eq!(estimate.total_cost_usd, 5.0);
        assert_eq!(
            estimate_external_cost(
                Some(&snapshot),
                ExternalProviderId::OpenAi,
                "model-example",
                MAX_EXTERNAL_TOKEN_COUNT + 1,
                0,
            ),
            Err(CostFailure::InvalidUsage)
        );
        assert_eq!(
            estimate_external_cost(None, ExternalProviderId::OpenAi, "model-example", 1, 1),
            Err(CostFailure::MissingPrice)
        );

        let policy = CostPolicy {
            confirmation_threshold_usd: Some(4.0),
            ceiling_usd: Some(10.0),
        };
        assert_eq!(
            decide_external_cost(&estimate, &policy, false),
            Err(ExternalProviderError::ConfirmationRequired)
        );
        assert_eq!(
            decide_external_cost(&estimate, &policy, true),
            Ok(CostDecision::ConfirmationRequired)
        );
        assert_eq!(
            decide_external_cost(
                &estimate,
                &CostPolicy {
                    confirmation_threshold_usd: None,
                    ceiling_usd: Some(4.0),
                },
                false,
            ),
            Err(ExternalProviderError::BudgetCeilingExceeded)
        );
        assert_eq!(
            decide_external_cost(
                &estimate,
                &CostPolicy {
                    confirmation_threshold_usd: Some(11.0),
                    ceiling_usd: Some(10.0),
                },
                false,
            ),
            Err(ExternalProviderError::InvalidConfiguration)
        );
        let mut inconsistent = estimate.clone();
        inconsistent.total_cost_usd = 0.0;
        assert_eq!(
            decide_external_cost(&inconsistent, &CostPolicy::default(), false),
            Err(ExternalProviderError::InvalidPrice)
        );
    }

    #[test]
    fn mock_transport_executes_and_parses_all_four_providers() {
        for provider_id in ExternalProviderId::ALL {
            let expected_path = match provider_id {
                ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => {
                    "/v1/chat/completions"
                }
                ExternalProviderId::Anthropic => "/v1/messages",
                ExternalProviderId::Gemini => "/v1/models/model-example:generateContent",
            };
            let expected_headers: &[&str] = match provider_id {
                ExternalProviderId::OpenAiCompatible | ExternalProviderId::OpenAi => {
                    &["Accept", "Content-Type", "Authorization"]
                }
                ExternalProviderId::Anthropic => {
                    &["Accept", "Content-Type", "anthropic-version", "x-api-key"]
                }
                ExternalProviderId::Gemini => &["Accept", "Content-Type", "x-goog-api-key"],
            };
            let backend = configured_backend(provider_id, None);
            let transport = MockTransport::new(success_response(provider_id));
            let result = execute_external_generation_with_transport(
                &backend,
                &transport,
                generation_request(
                    provider_id,
                    Some(price_snapshot(provider_id, "model-example")),
                    true,
                    false,
                ),
            )
            .expect("provider response parses");

            assert_eq!(result.provider_id, provider_id);
            assert_eq!(result.requested_model, "model-example");
            assert_eq!(result.provider_model, "served-model");
            assert_eq!(
                result.identity_confidence,
                IdentityConfidence::ProviderReported
            );
            assert_eq!(result.text, "provider text");
            assert_eq!(
                result.usage,
                ExternalUsage {
                    input_tokens: 2,
                    output_tokens: 3,
                    total_tokens: 5,
                }
            );
            assert!(!result.network_used);
            assert_eq!(result.cost.estimated.input_tokens, 5);
            assert_eq!(result.cost.estimated.output_tokens, 4);
            assert_eq!(result.cost.actual.input_tokens, 2);
            assert_eq!(result.cost.actual.output_tokens, 3);
            assert_eq!(result.cost.preflight_decision, CostDecision::Allow);
            assert_eq!(result.cost.final_decision, CostDecision::Allow);

            let request = transport.first_request();
            assert_eq!(request.path, expected_path);
            assert_eq!(request.header_names.as_slice(), expected_headers);
            let body = String::from_utf8(request.body).expect("request body is utf8");
            assert!(body.contains("hello"));
            assert!(!body.contains(TEST_CREDENTIAL_MARKER));
        }
    }

    #[test]
    fn successful_mock_generation_sanitizes_history_evidence() {
        let provider_id = ExternalProviderId::OpenAi;
        let backend = configured_backend(provider_id, None);
        let transport = MockTransport::new(success_response(provider_id));
        let result = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                provider_id,
                Some(price_snapshot(provider_id, "model-example")),
                true,
                false,
            ),
        )
        .expect("mock generation succeeds");
        let evidence = sanitized_external_generation_evidence("generation-1".to_owned(), &result)
            .expect("evidence sanitizes");
        let serialized = serde_json::to_string(&evidence).expect("evidence serializes");
        assert!(!serialized.contains("provider text"));
        assert!(!serialized.contains("hello"));
        assert!(!serialized.contains(TEST_CREDENTIAL_MARKER));
        assert!(!serialized.contains("headers"));

        let mut tampered = evidence;
        tampered.actual.output_tokens = 4;
        assert_eq!(
            validate_external_generation_evidence(&tampered),
            Err(ExternalProviderError::InvalidUsage)
        );
    }

    #[test]
    fn consent_and_cost_gates_block_before_mock_transport() {
        let backend = configured_backend(ExternalProviderId::OpenAi, None);
        let transport = MockTransport::new(success_response(ExternalProviderId::OpenAi));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                false,
                false,
            ),
        )
        .err()
        .expect("consent must be required");
        assert_eq!(error, ExternalProviderError::NetworkConsentRequired);
        assert_eq!(transport.request_count(), 0);

        let backend = configured_backend(
            ExternalProviderId::OpenAi,
            Some(CostPolicy {
                confirmation_threshold_usd: Some(0.00001),
                ceiling_usd: None,
            }),
        );
        let transport = MockTransport::new(success_response(ExternalProviderId::OpenAi));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                true,
                false,
            ),
        )
        .err()
        .expect("cost confirmation must be required");
        assert_eq!(error, ExternalProviderError::ConfirmationRequired);
        assert_eq!(transport.request_count(), 0);

        let backend = configured_backend(
            ExternalProviderId::OpenAi,
            Some(CostPolicy {
                confirmation_threshold_usd: None,
                ceiling_usd: Some(0.00002),
            }),
        );
        let transport = MockTransport::new(success_response(ExternalProviderId::OpenAi));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                true,
                false,
            ),
        )
        .err()
        .expect("budget ceiling must block the request");
        assert_eq!(error, ExternalProviderError::BudgetCeilingExceeded);
        assert_eq!(transport.request_count(), 0);

        let backend = configured_backend(ExternalProviderId::OpenAi, None);
        let transport = MockTransport::new(success_response(ExternalProviderId::OpenAi));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(ExternalProviderId::OpenAi, None, true, false),
        )
        .err()
        .expect("missing price must block the request");
        assert_eq!(error, ExternalProviderError::MissingPrice);
        assert_eq!(transport.request_count(), 0);
    }

    #[test]
    fn confirmed_cost_gate_and_actual_budget_gate_are_enforced() {
        let backend = configured_backend(
            ExternalProviderId::OpenAi,
            Some(CostPolicy {
                confirmation_threshold_usd: Some(0.00001),
                ceiling_usd: None,
            }),
        );
        let transport = MockTransport::new(success_response(ExternalProviderId::OpenAi));
        let result = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                true,
                true,
            ),
        )
        .expect("confirmed cost gate permits the request");
        assert_eq!(
            result.cost.preflight_decision,
            CostDecision::ConfirmationRequired
        );
        assert_eq!(
            result.cost.final_decision,
            CostDecision::ConfirmationRequired
        );
        assert_eq!(transport.request_count(), 1);

        let backend = configured_backend(
            ExternalProviderId::OpenAi,
            Some(CostPolicy {
                confirmation_threshold_usd: None,
                ceiling_usd: Some(0.003),
            }),
        );
        let response = serde_json::json!({
            "choices": [{"message": {"content": "provider text"}}],
            "model": "served-model",
            "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11}
        });
        let transport =
            MockTransport::new(serde_json::to_vec(&response).expect("response serializes"));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            ExternalGenerationRequest {
                provider_id: ExternalProviderId::OpenAi,
                prompt: "x".to_owned(),
                max_output_tokens: 1,
                network_consent: true,
                cost_confirmed: false,
                price_snapshot: Some(PriceSnapshot {
                    provider_id: ExternalProviderId::OpenAi,
                    model_id: "model-example".to_owned(),
                    captured_on: "2026-08-20".to_owned(),
                    currency: "USD".to_owned(),
                    input_usd_per_million_tokens: Some(1_000.0),
                    output_usd_per_million_tokens: Some(1_000.0),
                }),
            },
        )
        .err()
        .expect("actual cost must enforce the ceiling");
        assert_eq!(error, ExternalProviderError::BudgetCeilingExceeded);
        assert_eq!(transport.request_count(), 1);
    }

    #[test]
    fn malformed_provider_responses_and_usage_fail_closed() {
        for provider_id in ExternalProviderId::ALL {
            let backend = configured_backend(provider_id, None);
            let transport = MockTransport::new(b"{}".to_vec());
            let error = execute_external_generation_with_transport(
                &backend,
                &transport,
                generation_request(
                    provider_id,
                    Some(price_snapshot(provider_id, "model-example")),
                    true,
                    false,
                ),
            )
            .err()
            .expect("malformed response must fail");
            assert_eq!(error, ExternalProviderError::MalformedResponse);
            assert_eq!(transport.request_count(), 1);
        }

        let backend = configured_backend(ExternalProviderId::OpenAi, None);
        let response = serde_json::json!({
            "choices": [{"message": {"content": "provider text"}}]
        });
        let transport =
            MockTransport::new(serde_json::to_vec(&response).expect("response serializes"));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                true,
                false,
            ),
        )
        .err()
        .expect("missing usage must fail");
        assert_eq!(error, ExternalProviderError::MissingUsage);

        let response = serde_json::json!({
            "choices": [{"message": {"content": "provider text"}}],
            "usage": {"prompt_tokens": -1, "completion_tokens": 1, "total_tokens": 0}
        });
        let transport =
            MockTransport::new(serde_json::to_vec(&response).expect("response serializes"));
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                true,
                false,
            ),
        )
        .err()
        .expect("invalid usage must fail");
        assert_eq!(error, ExternalProviderError::InvalidUsage);

        let transport = MockTransport::new(vec![b' '; MAX_EXTERNAL_RESPONSE_BYTES + 1]);
        let error = execute_external_generation_with_transport(
            &backend,
            &transport,
            generation_request(
                ExternalProviderId::OpenAi,
                Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
                true,
                false,
            ),
        )
        .err()
        .expect("oversized response must fail");
        assert_eq!(error, ExternalProviderError::ResponseTooLarge);
    }

    #[test]
    fn execution_debug_and_results_do_not_reveal_credentials() {
        let backend = configured_backend(ExternalProviderId::OpenAi, None);
        let mut request = generation_request(
            ExternalProviderId::OpenAi,
            Some(price_snapshot(ExternalProviderId::OpenAi, "model-example")),
            true,
            false,
        );
        request.prompt = TEST_CREDENTIAL_MARKER.to_owned();
        let debug = format!("{request:?}");
        assert!(debug.contains("REDACTED"));
        assert!(!debug.contains(TEST_CREDENTIAL_MARKER));

        let transport = MockTransport::new(success_response(ExternalProviderId::OpenAi));
        let result = execute_external_generation_with_transport(&backend, &transport, request)
            .expect("provider response parses");
        let serialized = serde_json::to_string(&result).expect("result serializes");
        assert!(!serialized.contains(TEST_CREDENTIAL_MARKER));
        let record = read_record(&backend, ExternalProviderId::OpenAi)
            .expect("credential record reads")
            .expect("credential record exists");
        assert!(!format!("{record:?}").contains(TEST_CREDENTIAL_MARKER));
    }

    #[test]
    fn unsupported_credential_backend_fails_closed_without_metadata() {
        let backend = UnsupportedCredentialBackend;
        let providers = list_external_providers(&backend);
        assert_eq!(providers.len(), ExternalProviderId::ALL.len());
        assert!(providers.iter().all(|provider| {
            !provider.configured
                && provider.storage_status == SecureStorageStatus::Unsupported
                && provider.credential_source == CredentialSource::Unavailable
        }));
        assert_eq!(
            configure_external_provider(
                &backend,
                configure_request("https://example.com", "model", None)
            )
            .unwrap_err(),
            ExternalProviderError::UnsupportedPlatform
        );
        assert_eq!(
            update_external_cost_policy(
                &backend,
                UpdateProviderCostPolicyRequest {
                    provider_id: ExternalProviderId::OpenAi,
                    cost_policy: CostPolicy::default(),
                },
            )
            .unwrap_err(),
            ExternalProviderError::UnsupportedPlatform
        );
        assert_eq!(
            remove_external_provider(&backend, ExternalProviderId::OpenAi).unwrap_err(),
            ExternalProviderError::UnsupportedPlatform
        );
    }
}
