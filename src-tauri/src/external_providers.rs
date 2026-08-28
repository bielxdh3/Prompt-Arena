use std::fmt;

use serde::{de::Deserializer, Deserialize, Serialize};

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

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
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

#[derive(Debug, Clone, Serialize, PartialEq)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
        Ok(Self { display })
    }

    fn display(&self) -> &str {
        &self.display
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
        ConfigureProviderRequest {
            provider_id: ExternalProviderId::OpenAi,
            endpoint: endpoint.to_owned(),
            model: model.to_owned(),
            api_key: SecretInput(TEST_CREDENTIAL_MARKER.as_bytes().to_vec()),
            connect_timeout_ms: None,
            read_timeout_ms: None,
            cost_policy,
        }
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
